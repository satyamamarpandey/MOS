from sqlalchemy.orm import Session
from .db import SessionLocal
from .models import Stock
from .services.price_loader import refresh_recent


def refresh_all_watchlist(days: int = 7):
    db: Session = SessionLocal()
    try:
        watchlist = db.query(Stock.symbol).all()
        symbols = [r[0] for r in watchlist if r and r[0]]
        if not symbols:
            print("⚠️ No symbols found in watchlist")
            return 0

        print(f"✅ Refreshing watchlist prices in batch | symbols={len(symbols)} days={days}")

        n = refresh_recent(
            db,
            symbols,
            days=days,
            batch_size=20,   # keep moderate
            sleep_s=1.0,
        )

        print(f"✅ Done. Upserted rows={n}")
        return n

    finally:
        db.close()
