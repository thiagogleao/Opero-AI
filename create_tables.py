"""
Initialize the PostgreSQL database.
Run once before first use: python create_tables.py
"""

from dotenv import load_dotenv

load_dotenv()

from app.database import engine, Base  # noqa: E402 — must be after load_dotenv
import app.models  # noqa: F401 — import all models so they register on Base.metadata


def main():
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)
    table_names = sorted(Base.metadata.tables.keys())
    for name in table_names:
        print(f"  ✓ {name}")
    print(f"\n{len(table_names)} tables ready.")


if __name__ == "__main__":
    main()
