from .db import SessionLocal
from .services.universe_loader import load_us_universe, load_india_universe, upsert_symbols


def refresh_universe_all():
    db = SessionLocal()
    try:
        us = load_us_universe()
        india = load_india_universe()

        n1 = upsert_symbols(db, us)
        n2 = upsert_symbols(db, india)

        print(f"[universe] upserted US={n1}, INDIA={n2}")
    finally:
        db.close()
