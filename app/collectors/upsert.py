"""
The one upsert every collector uses.

Two rules, each learned from a wrong number:

1. An upsert only touches the columns the incoming row carries. The old helper
   set every non-key column of the table to EXCLUDED.<col>, and EXCLUDED holds
   the column default for anything the row did not mention — so a backfill that
   wrote total_shipping was wiped back to NULL by the next ten-minute sync.

2. A row never changes owner. Several conflict keys are global (an order id, an
   ad id, an ad-day before the tenant-safe migration), and ON CONFLICT used to
   rewrite tenant_id to whoever synced last, which moved an ad's history from
   one store to another. When the conflict key does not include tenant_id, the
   update only applies to a row that already belongs to the same tenant.

Which conflict key to use is decided from the live schema: callers pass
candidates in order of preference (tenant-safe first), and the first one backed
by a unique index or constraint wins. That keeps the collector correct both
before and after the migration in frontend/migrate.js has run.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional, Sequence

from sqlalchemy import MetaData, inspect
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_TABLES: dict = {}
_UNIQUE_SETS: dict[str, list[frozenset[str]]] = {}

# Rows per INSERT statement: big enough to be fast, small enough that one bad
# row does not cost a whole day of ads and the statement stays under the
# server's parameter limit (32k) for the widest table (~35 columns).
BATCH = 500


# ── Pure helpers (unit-tested) ────────────────────────────────────────────────

def update_columns(row_keys: Iterable[str], conflict: Sequence[str], table_cols: Iterable[str]) -> list[str]:
    """Columns an upsert may overwrite: present in the row, real in the table,
    not part of the conflict key, never the surrogate id."""
    cols = set(table_cols)
    skip = set(conflict) | {"id"}
    return sorted(k for k in set(row_keys) if k in cols and k not in skip)


def choose_conflict(candidates: Sequence[Sequence[str]], unique_sets: Iterable[frozenset[str]]) -> Optional[list[str]]:
    """First candidate whose column set matches a unique index exactly."""
    sets = list(unique_sets)
    for cand in candidates:
        if frozenset(cand) in sets:
            return list(cand)
    return None


def group_by_keys(rows: Sequence[dict]) -> list[list[dict]]:
    """Multi-row VALUES needs one column list; rows that carry different
    columns are written in separate statements instead of padding with NULL
    (padding would be exactly the overwrite rule 1 forbids)."""
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault(tuple(sorted(r.keys())), []).append(r)
    return list(groups.values())


# ── Schema reflection (cached per process) ────────────────────────────────────

def _table(session: Session, name: str):
    if name not in _TABLES:
        meta = MetaData()
        meta.reflect(bind=session.get_bind(), only=[name])
        _TABLES[name] = meta.tables[name]
    return _TABLES[name]


def unique_sets(session: Session, name: str) -> list[frozenset[str]]:
    if name not in _UNIQUE_SETS:
        insp = inspect(session.get_bind())
        sets: list[frozenset[str]] = []
        pk = insp.get_pk_constraint(name).get("constrained_columns") or []
        if pk:
            sets.append(frozenset(pk))
        for uc in insp.get_unique_constraints(name):
            sets.append(frozenset(uc["column_names"]))
        for ix in insp.get_indexes(name):
            # Partial or expression indexes cannot arbitrate a plain ON CONFLICT.
            if ix.get("unique") and all(ix.get("column_names") or [None]) and not (ix.get("dialect_options") or {}).get("postgresql_where"):
                sets.append(frozenset(ix["column_names"]))
        _UNIQUE_SETS[name] = sets
    return _UNIQUE_SETS[name]


# ── The upsert ────────────────────────────────────────────────────────────────

def build_statement(table, chunk: Sequence[dict], conflict: Sequence[str], cols: Sequence[str],
                    keep: set, guard_owner: bool):
    """INSERT … ON CONFLICT for one batch (separate so it can be compiled in tests)."""
    from sqlalchemy import func
    stmt = pg_insert(table).values(list(chunk))
    if not cols:
        return stmt.on_conflict_do_nothing(index_elements=list(conflict))
    set_ = {c: (func.coalesce(stmt.excluded[c], table.c[c]) if c in keep else stmt.excluded[c]) for c in cols}
    where = table.c.tenant_id.is_not_distinct_from(stmt.excluded.tenant_id) if guard_owner else None
    return stmt.on_conflict_do_update(index_elements=list(conflict), set_=set_, where=where)


def upsert(
    session: Session,
    table_name: str,
    rows: Sequence[dict],
    conflict_candidates: Sequence[Sequence[str]],
    *,
    preserve_on_null: Iterable[str] = (),
    commit: bool = True,
) -> int:
    """Insert or update `rows`; returns how many rows were sent.

    preserve_on_null: columns where an incoming NULL keeps what is stored
    (Shopify stops returning the checkout fingerprint on old orders, so a
    re-sync must not blank it).
    """
    if not rows:
        return 0

    table = _table(session, table_name)
    col_names = {c.name for c in table.columns}
    conflict = choose_conflict(conflict_candidates, unique_sets(session, table_name))
    if conflict is None:
        raise RuntimeError(
            f"{table_name}: nenhuma chave única para {list(conflict_candidates)} — rode frontend/migrate.js"
        )
    keep = set(preserve_on_null)
    guard_owner = "tenant_id" not in conflict and "tenant_id" in col_names

    clean = [{k: v for k, v in r.items() if k in col_names} for r in rows]
    sent = 0
    for group in group_by_keys(clean):
        cols = update_columns(group[0].keys(), conflict, col_names)
        if guard_owner and "tenant_id" in cols:
            # The owner is part of the row's identity here: never rewrite it.
            cols.remove("tenant_id")
        for i in range(0, len(group), BATCH):
            chunk = group[i:i + BATCH]
            session.execute(build_statement(table, chunk, conflict, cols, keep, guard_owner))
            sent += len(chunk)
    if commit:
        session.commit()
    return sent
