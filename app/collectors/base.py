"""
What every collector shares: a sync_runs row that always ends.

A run is recorded before anything can fail (auth included), and closed in every
outcome. Three ways it used to stay 'running' forever or lie:
  - a failed statement left the session aborted, so the commit that closed the
    run raised a second error and hid the first (now: rollback first, and the
    close can never mask the original exception);
  - SIGTERM from the scheduler's kill timer ended the process mid-run (now:
    collect_recent.py turns the signal into an exception that lands here);
  - an auth failure returned before the collector existed (now: auth runs
    inside the recorded run).

Statuses: running | success | partial | error.
  partial  = the run's main data landed but a secondary part failed (only the
             Meta structure pass uses it: breakdowns that failed).
Warnings that do not fail a run (a missing scope, Shop Campaigns unreadable)
are kept in error_message of a 'success' row, so they are visible without
turning a good sync red.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.collectors.redact import redact
from app.collectors.upsert import _table

logger = logging.getLogger(__name__)


class Interrupted(BaseException):
    """Raised from the SIGTERM handler; BaseException so nothing swallows it."""


class BaseCollector:
    source: str = "unknown"

    def __init__(self, session: Session, tenant_id: Optional[str] = None,
                 account_id: Optional[str] = None, mode: Optional[str] = None):
        self.session = session
        self.tenant_id = tenant_id
        self.account_id = account_id
        self.mode = mode
        self.run_id: Optional[int] = None
        self.records = 0
        self.warnings: list[str] = []
        # Secondary parts that failed (e.g. one breakdown type). Non-empty
        # makes the run 'partial' when the collector allows it.
        self.failures: list[str] = []
        self.allow_partial = False

    # ── Entry point ─────────────────────────────────────────────────────────

    def collect(self, date_from: date, date_to: date) -> int:
        self._start(date_from, date_to)
        try:
            self._run(date_from, date_to)
        except BaseException as exc:  # noqa: BLE001 — recorded, then re-raised
            self._safe_rollback()
            msg = "interrompido (processo encerrado)" if isinstance(exc, Interrupted) else self.describe_error(exc)
            self._finish("error", msg)
            raise
        if self.failures and self.allow_partial:
            self._finish("partial", "; ".join(self.failures + self.warnings))
        else:
            self._finish("success", "; ".join(self.warnings) or None)
        logger.info("[%s] ok — %d registros, %s → %s", self.source, self.records, date_from, date_to)
        return self.records

    def _run(self, date_from: date, date_to: date) -> None:
        raise NotImplementedError

    def describe_error(self, exc: BaseException) -> str:
        """Short, safe text for the panel. Subclasses map known errors to
        Portuguese messages; the default keeps the exception text, redacted."""
        return redact(f"{type(exc).__name__}: {exc}")

    # ── Helpers for subclasses ──────────────────────────────────────────────

    def inject_tenant(self, rows: list[dict]) -> list[dict]:
        if not self.tenant_id:
            return rows
        return [{**r, "tenant_id": self.tenant_id} for r in rows]

    def warn(self, message: str) -> None:
        logger.warning("[%s] %s", self.source, message)
        self.warnings.append(redact(message, 200))

    # ── sync_runs ───────────────────────────────────────────────────────────

    def _run_columns(self) -> set[str]:
        try:
            return {c.name for c in _table(self.session, "sync_runs").columns}
        except Exception:  # noqa: BLE001 — never block a sync on reflection
            return set()

    def _start(self, date_from: date, date_to: date) -> None:
        cols = self._run_columns()
        values = {
            "tenant_id": self.tenant_id, "source": self.source, "status": "running",
            "date_from": str(date_from), "date_to": str(date_to),
        }
        # account_id / mode arrive with the v2 migration; until it has run the
        # row is written without them rather than failing the sync.
        if "account_id" in cols:
            values["account_id"] = self.account_id
        if "mode" in cols:
            values["mode"] = self.mode
        names = ", ".join(values)
        params = ", ".join(f":{k}" for k in values)
        self.run_id = self.session.execute(
            text(f"INSERT INTO sync_runs ({names}, started_at) VALUES ({params}, now()) RETURNING id"),
            values,
        ).scalar()
        self.session.commit()
        logger.info("[%s] run %s: %s → %s%s", self.source, self.run_id, date_from, date_to,
                    f" ({self.account_id})" if self.account_id else "")

    def _finish(self, status: str, message: Optional[str]) -> None:
        if self.run_id is None:
            return
        try:
            self.session.execute(
                text("UPDATE sync_runs SET status = :s, finished_at = now(), "
                     "records_collected = :n, error_message = :m WHERE id = :id"),
                {"s": status, "n": self.records, "m": redact(message) if message else None, "id": self.run_id},
            )
            self.session.commit()
        except Exception as e:  # noqa: BLE001 — must not hide the original error
            logger.error("[%s] could not close run %s: %s", self.source, self.run_id, redact(e))
            self._safe_rollback()
            self._finish_in_fresh_session(status, message)

    def _finish_in_fresh_session(self, status: str, message: Optional[str]) -> None:
        """Last resort when this session's connection is gone."""
        try:
            from app.database import SessionLocal
            with SessionLocal() as s:
                s.execute(
                    text("UPDATE sync_runs SET status = :s, finished_at = now(), "
                         "records_collected = :n, error_message = :m WHERE id = :id"),
                    {"s": status, "n": self.records, "m": redact(message) if message else None, "id": self.run_id},
                )
                s.commit()
        except Exception as e:  # noqa: BLE001
            # The scheduler's sweeper closes it after 20 minutes.
            logger.error("[%s] run %s left open: %s", self.source, self.run_id, redact(e))

    def _safe_rollback(self) -> None:
        try:
            self.session.rollback()
        except Exception:  # noqa: BLE001
            pass


def record_failed_run(session: Session, tenant_id: str, source: str, message: str,
                      date_from: Optional[date] = None, date_to: Optional[date] = None,
                      account_id: Optional[str] = None, mode: Optional[str] = None) -> None:
    """A run that failed before any collector could start (credentials
    missing, store unknown). Written so the failure is visible, not silent."""
    c = BaseCollector(session, tenant_id, account_id=account_id, mode=mode)
    c.source = source
    try:
        c._start(date_from or date.today(), date_to or date.today())
        c._finish("error", message)
    except Exception as e:  # noqa: BLE001
        logger.error("could not record failed %s run for %s: %s", source, tenant_id, redact(e))
