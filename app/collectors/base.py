import logging
from datetime import datetime, date
from typing import Optional

from sqlalchemy.orm import Session

from app.models.sync import SyncRun

logger = logging.getLogger(__name__)


class BaseCollector:
    """
    Shared scaffolding for all data collectors.
    Subclasses implement `_run(date_from, date_to)` and call
    `self._upsert(model_class, rows, conflict_columns)` to persist data.
    """

    source: str = "unknown"

    def __init__(self, session: Session, tenant_id: Optional[str] = None):
        self.session = session
        self.tenant_id = tenant_id
        self._sync_run: Optional[SyncRun] = None
        self._records_collected = 0

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def collect(self, date_from: date, date_to: date) -> int:
        """Run the collection and return the number of records persisted."""
        self._start_sync_run(date_from, date_to)
        try:
            self._run(date_from, date_to)
            self._finish_sync_run(status="success")
            logger.info(
                "[%s] Sync complete — %d records, %s → %s",
                self.source, self._records_collected, date_from, date_to,
            )
        except Exception as exc:
            logger.exception("[%s] Sync failed: %s", self.source, exc)
            self._finish_sync_run(status="error", error=str(exc))
            raise
        return self._records_collected

    # ------------------------------------------------------------------
    # To be implemented by subclasses
    # ------------------------------------------------------------------

    def _run(self, date_from: date, date_to: date) -> None:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Upsert helper — PostgreSQL INSERT … ON CONFLICT DO UPDATE
    # ------------------------------------------------------------------

    def _upsert(self, model_class, rows: list[dict], conflict_columns: list[str]) -> int:
        """
        Bulk-upsert `rows` into `model_class` table.
        Returns the number of rows processed.
        """
        if not rows:
            return 0

        from sqlalchemy.dialects.postgresql import insert as pg_insert

        table = model_class.__table__
        update_cols = [
            c.name for c in table.columns
            if c.name not in conflict_columns and c.name != "id"
        ]

        stmt = pg_insert(table).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=conflict_columns,
            set_={col: stmt.excluded[col] for col in update_cols},
        )
        self.session.execute(stmt)
        self.session.commit()
        self._records_collected += len(rows)
        return len(rows)

    # ------------------------------------------------------------------
    # Sync run tracking
    # ------------------------------------------------------------------

    def _inject_tenant(self, rows: list[dict]) -> list[dict]:
        """Add tenant_id to every row if set."""
        if not self.tenant_id:
            return rows
        return [{**row, "tenant_id": self.tenant_id} for row in rows]

    def _start_sync_run(self, date_from: date, date_to: date) -> None:
        run = SyncRun(
            source=self.source,
            started_at=datetime.utcnow(),
            date_from=str(date_from),
            date_to=str(date_to),
            tenant_id=self.tenant_id,
        )
        self.session.add(run)
        self.session.commit()
        self._sync_run = run
        logger.info("[%s] Starting sync %s → %s (run_id=%s)", self.source, date_from, date_to, run.id)

    def _finish_sync_run(self, status: str, error: Optional[str] = None) -> None:
        if self._sync_run:
            self._sync_run.finished_at = datetime.utcnow()
            self._sync_run.status = status
            self._sync_run.records_collected = self._records_collected
            self._sync_run.error_message = error
            self.session.commit()
