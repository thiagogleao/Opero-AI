from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from contextlib import contextmanager

from app.config import settings


# psycopg3 requires the +psycopg dialect prefix; handle both postgres:// and postgresql://
_raw = settings.database_url
if _raw.startswith("postgres://"):
    _raw = "postgresql" + _raw[8:]
_db_url = _raw.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    _db_url,
    pool_pre_ping=True,   # detect stale connections
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


@contextmanager
def get_db() -> Session:
    """Context manager for a database session."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
