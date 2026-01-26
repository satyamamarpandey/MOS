from sqlalchemy.orm import Session
from .db import SessionLocal
from .models import Stock
from .services.price_service import download_prices, upsert_prices

def refresh_all_watchlist():
    db: Session = SessionLocal()
    try:
        watchlist = db.query(Stock).all()
        for s in watchlist:
            df = download_prices(s.symbol)
            inserted = upsert_prices(db, s.symbol, df)
            print(f"✅ Refreshed {s.symbol} | inserted new rows: {inserted}")
    finally:
        db.close()
