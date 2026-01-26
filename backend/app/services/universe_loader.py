import csv
import io
import requests
from datetime import datetime
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ..models import Symbol

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
OTHER_LISTED_URL  = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"
NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"


def _download_text(url: str, timeout=30) -> str:
    r = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    return r.text


def _parse_pipe_file(text: str):
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # remove trailer/header noise
    lines = [ln for ln in lines if not ln.startswith("File Creation Time")]
    lines = [ln for ln in lines if ln != "EOF"]
    reader = csv.reader(lines, delimiter="|")
    rows = list(reader)
    return rows[0], rows[1:]


def load_us_universe():
    now = datetime.utcnow()
    out = []

    bad_words = ["warrant", "unit", "right", "preferred", "depositary", "notes", "bond", "fund", "trust"]

    # NASDAQ listed
    nas_text = _download_text(NASDAQ_LISTED_URL)
    header, rows = _parse_pipe_file(nas_text)
    idx = {col: i for i, col in enumerate(header)}

    for r in rows:
        sym = (r[idx["Symbol"]] or "").strip()
        name = (r[idx["Security Name"]] or "").strip()
        test_issue = (r[idx["Test Issue"]] or "").strip()
        etf = (r[idx["ETF"]] or "").strip()

        if not sym or sym == "Symbol":
            continue
        if test_issue != "N":
            continue
        if etf != "N":
            continue

        nm = name.lower()
        if any(w in nm for w in bad_words):
            continue

        out.append({
            "symbol": sym,
            "name": name,
            "market": "US",
            "exchange": "NASDAQ",
            "currency": "USD",
            "is_active": True,
            "source": "nasdaqtrader",
            "updated_at": now
        })

    # Other listed (NYSE/AMEX/etc)
    oth_text = _download_text(OTHER_LISTED_URL)
    header, rows = _parse_pipe_file(oth_text)
    idx = {col: i for i, col in enumerate(header)}

    for r in rows:
        sym = (r[idx["ACT Symbol"]] or "").strip()
        name = (r[idx["Security Name"]] or "").strip()
        exch = (r[idx["Exchange"]] or "").strip()
        etf = (r[idx["ETF"]] or "").strip()
        test_issue = (r[idx["Test Issue"]] or "").strip()

        if not sym or sym == "ACT Symbol":
            continue
        if test_issue != "N":
            continue
        if etf != "N":
            continue

        nm = name.lower()
        if any(w in nm for w in bad_words):
            continue

        out.append({
            "symbol": sym,
            "name": name,
            "market": "US",
            "exchange": exch,
            "currency": "USD",
            "is_active": True,
            "source": "nasdaqtrader",
            "updated_at": now
        })

    # dedupe by symbol
    dedup = {}
    for row in out:
        dedup[row["symbol"]] = row
    return list(dedup.values())


def load_india_universe():
    now = datetime.utcnow()
    csv_text = _download_text(NSE_EQUITY_LIST_URL)

    f = io.StringIO(csv_text)
    reader = csv.DictReader(f)

    out = []
    for row in reader:
        sym = (row.get("SYMBOL") or "").strip()
        name = (row.get("NAME OF COMPANY") or "").strip()
        series = (row.get(" SERIES") or row.get("SERIES") or "").strip()

        if not sym:
            continue
        if series and series != "EQ":
            continue

        out.append({
            "symbol": f"{sym}.NS",
            "name": name,
            "market": "INDIA",
            "exchange": "NSE",
            "currency": "INR",
            "is_active": True,
            "source": "nse",
            "updated_at": now
        })

    return out


def upsert_symbols(db, rows: list[dict], batch_size: int = 200):
    """
    SQLite has a limit on variables per statement, so we must insert/upsert in chunks.
    batch_size=200 is safe for 7-8 columns.
    """
    if not rows:
        return 0

    total = 0

    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]

        stmt = sqlite_insert(Symbol).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol"],
            set_={
                "name": stmt.excluded.name,
                "market": stmt.excluded.market,
                "exchange": stmt.excluded.exchange,
                "currency": stmt.excluded.currency,
                "is_active": stmt.excluded.is_active,
                "source": stmt.excluded.source,
                "updated_at": stmt.excluded.updated_at,
            }
        )

        db.execute(stmt)
        db.commit()
        total += len(chunk)

    return total
