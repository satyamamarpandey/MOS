# backend/app/watchlist_routes.py
from pathlib import Path
import sqlite3
from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["watchlist"])

def _db_path_for_market(market: str) -> Path:
    """
    Uses the same convention you already use:
    <repo>/backend/data/stockapp-us.db
    <repo>/backend/data/stockapp-in.db
    """
    m = (market or "").strip().upper()
    if m not in ("US", "IN"):
        raise HTTPException(status_code=400, detail="market must be US or IN")

    project_root = Path(__file__).resolve().parents[2]  # .../<repo>/
    data_dir = project_root / "backend" / "data"
    return data_dir / ("stockapp-us.db" if m == "US" else "stockapp-in.db")


@router.get("/watchlist")
def watchlist(market: str = "US", q: str = "", limit: int = 10000):
    """
    Returns a list of stocks for the picker dropdown.

    Expected frontend-friendly shape:
      { market, q, count, items: [{symbol, name}, ...] }
    """
    db_path = _db_path_for_market(market)

    if not db_path.exists():
        raise HTTPException(status_code=500, detail=f"DB not found: {db_path}")

    qn = (q or "").strip().upper()
    lim = max(1, min(int(limit or 10000), 20000))

    # ⚠️ Adjust these table/column names to match your DB.
    # Common patterns:
    #   - table: symbols / tickers / stocks / watchlist
    #   - cols: symbol, name (or shortname)
    sql = """
        SELECT symbol, COALESCE(name, '') AS name
        FROM symbols
        WHERE (? = '' OR UPPER(symbol) LIKE ? OR UPPER(name) LIKE ?)
        ORDER BY symbol
        LIMIT ?
    """

    like = f"%{qn}%"
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute(sql, (qn, like, like, lim))
        rows = cur.fetchall()
    except sqlite3.OperationalError as e:
        # This usually means table doesn't exist -> you must update table name above
        raise HTTPException(status_code=500, detail=f"SQLite error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    items = [{"symbol": r[0], "name": r[1]} for r in rows]
    return {"market": market.upper(), "q": q, "count": len(items), "items": items}
