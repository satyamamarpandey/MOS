from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import delete, func, text
import pandas as pd

from .db import get_db_market
from .models import Stock, PriceDaily
from .services.price_service import (
    get_prices_from_db,
    download_prices,
    upsert_prices,
)
from .services.indicator_service import add_indicators
from .services.dcf_service import run_dcf

router = APIRouter()


def _table_exists(db: Session, table_name: str) -> bool:
    # SQLite-friendly table existence check
    row = db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
        {"t": table_name},
    ).fetchone()
    return row is not None


@router.get("/watchlist")
def watchlist(
    market: str = Query(default="US"),
    q: str = Query(default=""),
    limit: int = Query(default=2000),
    db: Session = Depends(get_db_market),
):
    """
    Return a large list of symbols for dropdown (not a tiny seeded list).
    - Uses symbols table if present + non-empty
    - Falls back to distinct symbols from daily_bars if symbols table is missing/empty
    """
    q = (q or "").strip().lower()
    limit = max(50, min(int(limit or 2000), 200000))

    # Prefer symbols table if it exists
    if _table_exists(db, "symbols"):
        base = db.query(Stock)

        # If Stock has 'market' column, filter it (safe)
        if hasattr(Stock, "market"):
            base = base.filter(func.lower(Stock.market) == market.strip().lower())

        if q:
            like = f"%{q}%"
            base = base.filter(
                func.lower(Stock.symbol).like(like)
                | func.lower(func.coalesce(Stock.name, "")).like(like)
            )

        rows = base.order_by(Stock.symbol.asc()).limit(limit).all()

        # If symbols table exists but is empty (common in India db), fall back:
        if rows:
            return [
                {
                    "symbol": r.symbol,
                    "name": r.name,
                    "market": getattr(r, "market", market),
                    "currency": getattr(r, "currency", None),
                }
                for r in rows
            ]

    # Fallback: derive symbols from daily_bars
    if _table_exists(db, "daily_bars"):
        sym_q = db.query(PriceDaily.symbol).distinct()
        if q:
            like = f"%{q}%"
            sym_q = sym_q.filter(func.lower(PriceDaily.symbol).like(like))
        syms = sym_q.order_by(PriceDaily.symbol.asc()).limit(limit).all()

        return [
            {"symbol": s[0], "name": None, "market": market, "currency": None}
            for s in syms
        ]

    return []


@router.post("/refresh")
def refresh(
    symbol: str,
    market: str = Query(default="US"),
    db: Session = Depends(get_db_market),
):
    df = download_prices(symbol)
    inserted = upsert_prices(db, symbol, df)
    return {"market": market, "symbol": symbol, "inserted_or_updated": inserted}


@router.post("/rebuild_prices")
def rebuild_prices(
    symbol: str,
    market: str = Query(default="US"),
    db: Session = Depends(get_db_market),
):
    db.execute(delete(PriceDaily).where(PriceDaily.symbol == symbol))
    db.commit()

    df = download_prices(symbol)
    count = upsert_prices(db, symbol, df)
    return {"market": market, "symbol": symbol, "reloaded_rows": count}


@router.get("/prices")
def prices(
    symbol: str,
    market: str = Query(default="US"),
    days: int = 380,
    db: Session = Depends(get_db_market),
):
    """
    days is treated as 'limit' here (1 row per day).
    """
    limit = max(5, min(int(days or 380), 5000))
    rows = get_prices_from_db(db, symbol, limit=limit)
    return {"market": market, "symbol": symbol, "rows": rows}


@router.get("/indicators")
def indicators(
    symbol: str,
    market: str = Query(default="US"),
    indicators: str = Query(default="rsi,macd,signal,sma20,sma50"),
    days: int = 800,
    db: Session = Depends(get_db_market),
):
    selected = [x.strip() for x in (indicators or "").split(",") if x.strip()]

    limit = max(50, min(int(days or 800), 5000))
    rows = get_prices_from_db(db, symbol, limit=limit)
    if not rows:
        return {"market": market, "symbol": symbol, "rows": []}

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])

    df = add_indicators(df, selected)

    # keep last ~400 points for UI
    df = df.tail(400)

    # Convert NaN -> None for JSON
    df = df.where(pd.notnull(df), None)

    out = df.to_dict(orient="records")
    for r in out:
        r["date"] = pd.to_datetime(r["date"]).date().isoformat()

    return {"market": market, "symbol": symbol, "rows": out}


@router.post("/dcf")
def dcf(payload: dict):
    return run_dcf(payload)
