import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session
from ..models import PriceDaily


def _clean_col(c):
    """
    Handles tuple / MultiIndex columns returned by yfinance.
    Converts ('Close','AAPL') -> close_aapl
    """
    if isinstance(c, tuple):
        c = "_".join([str(x) for x in c if x and str(x) != "nan"])
    return str(c).strip().lower().replace(" ", "_")


def _to_float(x):
    """Convert values to float, return None if NaN/None/bad."""
    if x is None:
        return None
    try:
        if pd.isna(x):
            return None
        return float(x)
    except Exception:
        return None


def download_prices(symbol: str) -> pd.DataFrame:
    df = yf.download(symbol, period="max", interval="1d", progress=False)

    if df is None or df.empty:
        return pd.DataFrame()

    df = df.reset_index()
    df.columns = [_clean_col(c) for c in df.columns]

    # Normalize date column
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"]).dt.date
    elif "datetime" in df.columns:
        df = df.rename(columns={"datetime": "date"})
        df["date"] = pd.to_datetime(df["date"]).dt.date

    # Ensure we have these columns
    # yfinance sometimes returns close_aapl etc. if multiindex flattened
    # We'll map them back to open/high/low/close/volume if needed
    def pick(col_base: str):
        if col_base in df.columns:
            return col_base
        # try matching like close_aapl / close_msft etc.
        matches = [c for c in df.columns if c.startswith(col_base + "_")]
        return matches[0] if matches else None

    open_col = pick("open")
    high_col = pick("high")
    low_col = pick("low")
    close_col = pick("close")
    vol_col = pick("volume")

    # If close not found, give up
    if not close_col:
        return pd.DataFrame()

    # Build a clean dataframe with expected names
    clean = pd.DataFrame()
    clean["date"] = df["date"]
    clean["open"] = df[open_col] if open_col else None
    clean["high"] = df[high_col] if high_col else None
    clean["low"] = df[low_col] if low_col else None
    clean["close"] = df[close_col]
    clean["volume"] = df[vol_col] if vol_col else None

    # Drop rows where close is missing
    clean = clean.dropna(subset=["close"])

    return clean


def upsert_prices(db: Session, symbol: str, df: pd.DataFrame) -> int:
    if df is None or df.empty:
        return 0

    inserted_or_updated = 0

    for row in df.to_dict(orient="records"):
        d = row.get("date")
        if d is None:
            continue

        new_open = _to_float(row.get("open"))
        new_high = _to_float(row.get("high"))
        new_low = _to_float(row.get("low"))
        new_close = _to_float(row.get("close"))
        new_vol = _to_float(row.get("volume"))

        # If close is missing, skip
        if new_close is None:
            continue

        existing = (
            db.query(PriceDaily)
            .filter(PriceDaily.symbol == symbol, PriceDaily.date == d)
            .first()
        )

        if not existing:
            db.add(
                PriceDaily(
                    symbol=symbol,
                    date=d,
                    open=new_open,
                    high=new_high,
                    low=new_low,
                    close=new_close,
                    volume=new_vol,
                )
            )
            inserted_or_updated += 1

        else:
            # Update broken rows that had NaN/None
            changed = False

            def need_fix(v):
                return v is None or (isinstance(v, float) and pd.isna(v))

            if need_fix(existing.open) and new_open is not None:
                existing.open = new_open
                changed = True
            if need_fix(existing.high) and new_high is not None:
                existing.high = new_high
                changed = True
            if need_fix(existing.low) and new_low is not None:
                existing.low = new_low
                changed = True
            if need_fix(existing.close) and new_close is not None:
                existing.close = new_close
                changed = True
            if need_fix(existing.volume) and new_vol is not None:
                existing.volume = new_vol
                changed = True

            if changed:
                inserted_or_updated += 1

    db.commit()
    return inserted_or_updated


def get_prices_from_db(db: Session, symbol: str, limit: int = 1000):
    rows = (
        db.query(PriceDaily)
        .filter(PriceDaily.symbol == symbol)
        .order_by(PriceDaily.date.desc())
        .limit(limit)
        .all()
    )
    rows = list(reversed(rows))

    def clean(x):
        if x is None:
            return None
        if isinstance(x, float) and pd.isna(x):
            return None
        return x

    return [
        {
            "date": r.date.isoformat(),
            "open": clean(r.open),
            "high": clean(r.high),
            "low": clean(r.low),
            "close": clean(r.close),
            "volume": clean(r.volume),
        }
        for r in rows
    ]
