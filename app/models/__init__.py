"""
The SQLAlchemy ORM models were removed: they no longer matched the production
schema (no tenant_id, wrong unique keys) and `create_tables.py` would have
created tables from them. The schema lives in frontend/migrate.js; the
collectors write with SQL through app/collectors/upsert.py.
"""

raise ImportError(
    "app.models foi removido: o schema vive em frontend/migrate.js "
    "(os modelos ORM nao batiam com o banco de producao)."
)
