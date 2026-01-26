# backend/app/jobs_universe.py

from __future__ import annotations

from datetime import datetime
from urllib.request import urlopen

from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import Symbol


NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"


def _fetch_text(url: str) -> str:
    with urlopen(url) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _should_skip_security(name: str) -> bool:
    """
    Keep universe practical for yfinance:
    skip warrants/rights/units/preferred/etc.
    (You already skip many of these later in price_loader too.)
    """
    if not name:
        return True
    n = name.lower()
    bad = [
        "warrant", "unit", "right",
        "preferred", "depositary", "debenture",
        "notes", "bond", "trust",
        "when issued", "wi",
    ]
    return any(k in n for k in bad)


def _map_exchange(code: str) -> str | None:
    """
    NasdaqTrader codes in otherlisted.txt:
      N = NYSE
      A = NYSE American
      P = NYSE Arca
      Z = Cboe BZX (commonly)
    """
    c = (code or "").strip().upper()
    return {
        "N": "NYSE",
        "A": "NYSEAMERICAN",
        "P": "NYSEARCA",
        "Z": "BZX",
    }.get(c, c or None)


def _parse_nasdaqlisted(txt: str) -> list[dict]:
    rows = []
    for line in txt.splitlines():
        if not line or line.startswith("Symbol|"):
            continue
        if line.startswith("File Creation Time"):
            break

        parts = line.split("|")
        if len(parts) < 3:
            continue

        sym = parts[0].strip()
        name = parts[1].strip()
        test_issue = parts[3].strip() if len(parts) > 3 else "N"

        if not sym or sym == "":  # safety
            continue
        if test_issue != "N":
            continue
        if _should_skip_security(name):
            continue

        rows.append({
            "symbol": sym,
            "name": name,
            "market": "US",
            "exchange": "NASDAQ",
            "currency": "USD",
            "is_active": True,
            "source": "nasdaqtrader",
            "updated_at": datetime.utcnow(),
        })
    return rows


def _parse_otherlisted(txt: str) -> list[dict]:
    rows = []
    for line in txt.splitlines():
        if not line or line.startswith("ACT Symbol|"):
            continue
        if line.startswith("File Creation Time"):
            break

        parts = line.split("|")
        if len(parts) < 4:
            continue

        sym = parts[0].strip()          # ACT Symbol
        name = parts[1].strip()         # Security Name
        exch_code = parts[2].strip()    # Exchange
        test_issue = parts[6].strip() if len(parts) > 6 else "N"

        if not sym:
            continue
        if test_issue != "N":
            continue
        if _should_skip_security(name):
            continue

        rows.append({
            "symbol": sym,
            "name": name,
            "market": "US",
            "exchange": _map_exchange(exch_code),
            "currency": "USD",
            "is_active": True,
            "source": "nasdaqtrader",
            "updated_at": datetime.utcnow(),
        })
    return rows


def _upsert_symbols(db, rows: list[dict], chunk_size: int = 500) -> int:
    """
    Chunked upsert to avoid SQLite "too many SQL variables" errors.
    """
    if not rows:
        return 0

    total = 0
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
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
            },
        )
        db.execute(stmt)
        db.commit()
        total += len(chunk)

    return total


def load_universe(db, market: str = "US") -> int:
    """
    Load stock universe into symbols table.
    Currently supports US via NasdaqTrader.

    market: "US" supported here.
    """
    m = (market or "US").upper()
    if m != "US":
        raise ValueError("jobs_universe.load_universe currently supports only market='US'")

    txt1 = _fetch_text(NASDAQ_LISTED_URL)
    txt2 = _fetch_text(OTHER_LISTED_URL)

    rows = []
    rows += _parse_nasdaqlisted(txt1)
    rows += _parse_otherlisted(txt2)

    # de-dupe (same symbol can appear; keep last)
    dedup = {}
    for r in rows:
        dedup[r["symbol"]] = r
    final_rows = list(dedup.values())

    n = _upsert_symbols(db, final_rows, chunk_size=500)
    print(f"[universe] US rows upserted={n}")
    return n
