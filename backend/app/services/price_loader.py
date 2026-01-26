from datetime import date, timedelta
import time
import random
import pandas as pd
import yfinance as yf

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy import func  # ✅ important (for updated_at)
from ..models import DailyBar


# --------------------------
# Helpers
# --------------------------
def _chunk(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def _to_yf_symbol(sym: str) -> str | None:
    if not sym:
        return None

    upper = sym.upper()

    # KEEP India suffixes unchanged (Yahoo uses .NS/.BO)
    if upper.endswith(".NS") or upper.endswith(".BO"):
        return sym

    # skip warrants/units/rights
    if upper.endswith(".W") or upper.endswith(".U") or upper.endswith(".R"):
        return None

    # US class shares: BRK.B -> BRK-B
    if "." in sym:
        parts = sym.split(".")
        if len(parts) == 2 and len(parts[1]) <= 2:
            sym = parts[0] + "-" + parts[1]

    # Preferred shares: BAC$K -> BAC-PK (best-effort)
    if "$" in sym:
        sym = sym.replace("$", "-P")

    return sym


def _build_yf_batch(original_symbols: list[str]):
    """
    Build (yf_symbols, mapping_yf_to_original).
    Skips symbols we can't/shouldn't fetch.
    """
    yf_syms = []
    yf_to_orig = {}

    for s in original_symbols:
        yf_s = _to_yf_symbol(s)
        if not yf_s:
            continue
        yf_syms.append(yf_s)
        yf_to_orig[yf_s] = s

    return yf_syms, yf_to_orig


def _yf_download_with_retry(tickers: list[str], start=None, end=None, max_tries: int = 6):
    """
    Robust download:
    - disable threads (threads trigger faster rate-limits)
    - retry with exponential backoff + jitter on rate-limit / 401-ish errors
    """
    if not tickers:
        return pd.DataFrame()

    last_err = None

    for attempt in range(1, max_tries + 1):
        try:
            df = yf.download(
                tickers=tickers,
                start=start,
                end=end,
                group_by="ticker",
                auto_adjust=False,
                threads=False,      # IMPORTANT: reduce rate limit pressure
                progress=False,
                actions=False,
            )
            return df

        except Exception as e:
            msg = str(e).lower()
            last_err = e

            # Backoff on rate-limit / crumb / unauthorized
            if "ratelimit" in msg or "too many requests" in msg or "crumb" in msg or "unauthorized" in msg or "401" in msg:
                base = min(20 * (2 ** (attempt - 1)), 600)  # 20s, 40s, 80s...
                jitter = random.uniform(0, 0.25 * base)
                sleep_s = base + jitter
                print(f"[yfinance] attempt {attempt}/{max_tries} blocked; sleeping {sleep_s:.1f}s ...")
                time.sleep(sleep_s)
                continue

            # Other errors: small backoff and retry a bit
            sleep_s = min(5 * attempt, 30)
            print(f"[yfinance] attempt {attempt}/{max_tries} error: {e}; sleeping {sleep_s}s ...")
            time.sleep(sleep_s)

    raise last_err


def _as_py_date(idx) -> date:
    """
    Convert pandas/numpy datetime-like index values to a real Python date.
    Works for pandas.Timestamp, numpy.datetime64, datetime/date.
    """
    try:
        # pandas.Timestamp, datetime64, etc.
        ts = pd.Timestamp(idx)
        return ts.date()
    except Exception:
        # fallback: try to use .date() if available
        if hasattr(idx, "date"):
            return idx.date()
        # last resort string parsing
        return pd.Timestamp(str(idx)[:10]).date()


def _normalize_yf_df(df: pd.DataFrame, yf_to_orig: dict[str, str]) -> list[dict]:
    """
    Normalize yfinance output into DB rows.

    Handles both MultiIndex orientations:
      1) (field, ticker)  -> ticker is level 1
      2) (ticker, field)  -> ticker is level 0 (common with group_by="ticker" for many tickers)
    """
    rows: list[dict] = []
    if df is None or df.empty:
        return rows

    def _row(orig_sym: str, d: date, r: pd.Series, cols) -> dict:
        return {
            "symbol": orig_sym,
            "date": d,  # ✅ Python date
            "open": float(r["Open"]) if "Open" in cols and pd.notna(r.get("Open")) else None,
            "high": float(r["High"]) if "High" in cols and pd.notna(r.get("High")) else None,
            "low": float(r["Low"]) if "Low" in cols and pd.notna(r.get("Low")) else None,
            "close": float(r["Close"]) if "Close" in cols and pd.notna(r.get("Close")) else None,
            "adj_close": float(r["Adj Close"]) if "Adj Close" in cols and pd.notna(r.get("Adj Close")) else None,
            "volume": int(r["Volume"]) if "Volume" in cols and pd.notna(r.get("Volume")) else None,
            "source": "yfinance",
        }

    # MultiIndex case
    if isinstance(df.columns, pd.MultiIndex):
        lvl0 = df.columns.get_level_values(0)
        lvl1 = df.columns.get_level_values(1)

        tickers = set(yf_to_orig.keys())
        tickers_in_lvl0 = len(tickers.intersection(set(lvl0))) > 0
        tickers_in_lvl1 = len(tickers.intersection(set(lvl1))) > 0

        # Case A: (field, ticker) => ticker in level 1
        if tickers_in_lvl1 and not tickers_in_lvl0:
            tickers_in_df = set(lvl1)
            for yf_sym, orig_sym in yf_to_orig.items():
                if yf_sym not in tickers_in_df:
                    continue
                sub = df.xs(yf_sym, axis=1, level=1, drop_level=True)  # columns become fields
                cols = sub.columns
                for idx, r in sub.iterrows():
                    d = _as_py_date(idx)
                    rows.append(_row(orig_sym, d, r, cols))
            return rows

        # Case B: (ticker, field) => ticker in level 0
        if tickers_in_lvl0:
            tickers_in_df = set(lvl0)
            for yf_sym, orig_sym in yf_to_orig.items():
                if yf_sym not in tickers_in_df:
                    continue
                sub = df.xs(yf_sym, axis=1, level=0, drop_level=True)  # columns become fields
                cols = sub.columns
                for idx, r in sub.iterrows():
                    d = _as_py_date(idx)
                    rows.append(_row(orig_sym, d, r, cols))
            return rows

        return rows

    # Non-MultiIndex: single ticker flat columns
    orig_sym = next(iter(yf_to_orig.values()), None)
    if not orig_sym:
        return rows

    cols = df.columns
    for idx, r in df.iterrows():
        d = _as_py_date(idx)
        rows.append(_row(orig_sym, d, r, cols))

    return rows


def upsert_daily_bars(db, rows: list[dict], batch_size: int = 500):
    """
    Batch upserts to avoid SQLite parameter limits.
    """
    if not rows:
        return 0

    total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]

        stmt = sqlite_insert(DailyBar).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "date"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "adj_close": stmt.excluded.adj_close,
                "volume": stmt.excluded.volume,
                "source": stmt.excluded.source,
                "updated_at": func.now(),  # ✅ FIX: real SQL timestamp, not a Python string
            }
        )
        db.execute(stmt)
        db.commit()
        total += len(chunk)

    return total


# --------------------------
# Public APIs
# --------------------------
def backfill_symbols(db, symbols: list[str], years: int = 10, batch_size: int = 5, sleep_s: float = 3.0):
    """
    Backfill N years for all symbols.
    batch_size kept small to reduce rate-limits.
    """
    start = date.today() - timedelta(days=365 * years)
    end = date.today() + timedelta(days=1)

    total_rows = 0

    for orig_batch in _chunk(symbols, batch_size):
        yf_batch, yf_to_orig = _build_yf_batch(orig_batch)
        if not yf_batch:
            continue

        try:
            df = _yf_download_with_retry(yf_batch, start=start, end=end)
            rows = _normalize_yf_df(df, yf_to_orig)
            total_rows += upsert_daily_bars(db, rows)
        except Exception as e:
            print(f"[backfill] batch failed ({len(yf_batch)} tickers): {e}")

        time.sleep(sleep_s)

    return total_rows


def refresh_recent(db, symbols: list[str], days: int = 7, batch_size: int = 50, sleep_s: float = 1.0):
    """
    Daily refresh: fetch last N calendar days; upsert into DB.
    """
    start = date.today() - timedelta(days=days)
    end = date.today() + timedelta(days=1)

    total_rows = 0

    for orig_batch in _chunk(symbols, batch_size):
        yf_batch, yf_to_orig = _build_yf_batch(orig_batch)
        if not yf_batch:
            continue

        try:
            df = _yf_download_with_retry(yf_batch, start=start, end=end)
            rows = _normalize_yf_df(df, yf_to_orig)
            total_rows += upsert_daily_bars(db, rows)
        except Exception as e:
            print(f"[daily] batch failed ({len(yf_batch)} tickers): {e}")

        time.sleep(sleep_s)

    return total_rows
