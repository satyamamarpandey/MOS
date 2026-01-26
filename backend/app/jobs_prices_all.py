# backend/app/jobs_prices_all.py

from sqlalchemy import select
from .models import Symbol
from .services.price_loader import backfill_symbols, refresh_recent


def _get_active_symbols(db, market: str, limit: int | None = None, offset: int = 0) -> list[str]:
    q = (
        select(Symbol.symbol)
        .where(Symbol.market == market)
        .where(Symbol.is_active == True)  # noqa: E712
        .order_by(Symbol.symbol.asc())
    )

    if limit is not None:
        q = q.limit(limit).offset(offset)

    rows = db.execute(q).all()
    return [r[0] for r in rows]


def run_backfill(db, market: str, years: int = 10, limit: int | None = None, offset: int = 0):
    symbols = _get_active_symbols(db, market=market, limit=limit, offset=offset)
    print(f"[backfill] market={market} symbols={len(symbols)} years={years} offset={offset} limit={limit}")

    n = backfill_symbols(
        db,
        symbols,
        years=years,
        batch_size=5,     # keep small for yfinance
        sleep_s=2.0,      # tune if rate-limited
    )

    print(f"[backfill] upserted rows={n}")
    return n


def run_daily_refresh(db, market: str, days: int = 7, limit: int | None = None, offset: int = 0):
    symbols = _get_active_symbols(db, market=market, limit=limit, offset=offset)
    print(f"[daily] market={market} symbols={len(symbols)} days={days} offset={offset} limit={limit}")

    n = refresh_recent(
        db,
        symbols,
        days=days,
        batch_size=30,    # daily can be larger than backfill
        sleep_s=1.0,
    )

    print(f"[daily] upserted rows={n}")
    return n
