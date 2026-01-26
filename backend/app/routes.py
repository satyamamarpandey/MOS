from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import delete
import pandas as pd

from .db import get_db
from .models import Stock, PriceDaily
from .services.price_service import (
    get_prices_from_db,
    download_prices,
    upsert_prices,
)
from .services.indicator_service import add_indicators
from .services.dcf_service import run_dcf

router = APIRouter()


@router.get("/watchlist")
def watchlist(db: Session = Depends(get_db)):
    rows = db.query(Stock).all()
    return [
        {
            "symbol": r.symbol,
            "name": r.name,
            "market": r.market,
            "currency": r.currency,
        }
        for r in rows
    ]


@router.post("/refresh")
def refresh(symbol: str, db: Session = Depends(get_db)):
    df = download_prices(symbol)
    inserted = upsert_prices(db, symbol, df)
    return {"symbol": symbol, "inserted_or_updated": inserted}


@router.post("/rebuild_prices")
def rebuild_prices(symbol: str, db: Session = Depends(get_db)):
    # delete old broken data for this symbol
    db.execute(delete(PriceDaily).where(PriceDaily.symbol == symbol))
    db.commit()

    # reload clean data
    df = download_prices(symbol)
    count = upsert_prices(db, symbol, df)
    return {"symbol": symbol, "reloaded_rows": count}


@router.get("/prices")
def prices(symbol: str, limit: int = 1000, db: Session = Depends(get_db)):
    rows = get_prices_from_db(db, symbol, limit=limit)
    return {"symbol": symbol, "rows": rows}


@router.get("/indicators")
def indicators(
    symbol: str,
    indicators: str = Query(default="rsi,macd,signal,sma20,sma50"),
    limit: int = 800,
    db: Session = Depends(get_db),
):
    selected = [x.strip() for x in indicators.split(",") if x.strip()]

    rows = get_prices_from_db(db, symbol, limit=limit)
    if not rows:
        return {"symbol": symbol, "rows": []}

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])

    df = add_indicators(df, selected)

    # ✅ IMPORTANT: do NOT dropna() (indicator warm-up causes NAs)
    df = df.tail(400)

    # ✅ Convert NaN -> None so JSON is clean
    df = df.where(pd.notnull(df), None)

    out = df.to_dict(orient="records")
    for r in out:
        r["date"] = pd.to_datetime(r["date"]).date().isoformat()

    return {"symbol": symbol, "rows": out}


@router.post("/dcf")
def dcf(payload: dict):
    return run_dcf(payload)
