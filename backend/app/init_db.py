# backend/app/init_db.py

from .db import Base, engine_us, SessionLocalUS
from .models import Symbol  # ✅ use Symbol, not Stock

# Optional: seed a tiny US starter list into symbols table
DEFAULT_US_SYMBOLS = [
    {"symbol": "AAPL", "name": "Apple Inc", "market": "US", "currency": "USD", "exchange": "NASDAQ"},
    {"symbol": "MSFT", "name": "Microsoft", "market": "US", "currency": "USD", "exchange": "NASDAQ"},
]

def main():
    # ✅ Create tables only in US DB
    Base.metadata.create_all(bind=engine_us)

    db = SessionLocalUS()
    try:
        for s in DEFAULT_US_SYMBOLS:
            exists = db.query(Symbol).filter(Symbol.symbol == s["symbol"]).first()
            if not exists:
                db.add(Symbol(**s))
        db.commit()
        print("✅ US DB initialized and (optional) starter symbols seeded: stockapp-us.db")
    finally:
        db.close()

if __name__ == "__main__":
    main()
