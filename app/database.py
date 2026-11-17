from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# psycopg3 needs the +psycopg dialect; accept postgres:// and postgresql://.
_raw = settings.database_url
if _raw.startswith("postgres://"):
    _raw = "postgresql" + _raw[8:]
_db_url = _raw.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    # One collector process uses one connection, plus one per breakdown thread.
    pool_size=5,
    max_overflow=5,
    # Every timestamp is written as an aware UTC datetime or now(); pin the
    # session zone so a naive value can never be read in some other zone.
    connect_args={"options": "-c timezone=UTC -c statement_timeout=120000"},
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    """Kept for root scripts that import it; the collectors use no ORM."""


@contextmanager
def get_db() -> Session:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
