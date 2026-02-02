import os
import json
import time
import sqlite3
import datetime as dt
from typing import Any, Dict, Optional, Tuple, List
import threading
import random

import requests
import yfinance as yf

# ✅ NEW: Screener provider
from .providers.screener_client import get_screener_snapshot_cached


# ============================================================
# Single-flight + Yahoo cooldown + per-symbol soft fail cache
# ============================================================
_inflight_lock = threading.Lock()
_inflight: Dict[str, threading.Event] = {}
_inflight_result: Dict[str, Dict[str, Any]] = {}

_yahoo_block_until_lock = threading.Lock()
_yahoo_block_until_ts = 0.0  # epoch seconds

# Per-symbol soft fail cache (avoid hammering same symbol)
_yahoo_fail_lock = threading.Lock()
_yahoo_fail_until: Dict[str, float] = {}  # SYMBOL -> epoch seconds

YAHOO_MIN_DELAY = float(os.getenv("YAHOO_MIN_DELAY", "1.2"))  # seconds between Yahoo calls
_last_yahoo_call_ts = 0.0
_yahoo_call_lock = threading.Lock()

# If Yahoo 429 happens, block ALL Yahoo calls for this long (seconds)
YAHOO_COOLDOWN_SECONDS = int(os.getenv("YAHOO_COOLDOWN_SECONDS", "90"))

# If Yahoo fails for a symbol, don't retry it for N minutes
YAHOO_FAIL_SOFTCACHE_MINUTES = int(os.getenv("YAHOO_FAIL_SOFTCACHE_MINUTES", "30"))

# Allow heavy Yahoo `.info` only when force_refresh=True (default OFF)
YAHOO_ALLOW_INFO_ON_REFRESH_ONLY = os.getenv("YAHOO_ALLOW_INFO_ON_REFRESH_ONLY", "1") != "0"


def _yahoo_rate_limit():
    global _last_yahoo_call_ts
    with _yahoo_call_lock:
        now = time.time()
        wait = YAHOO_MIN_DELAY - (now - _last_yahoo_call_ts)
        if wait > 0:
            time.sleep(wait)
        _last_yahoo_call_ts = time.time()


def _yahoo_is_blocked() -> bool:
    global _yahoo_block_until_ts
    with _yahoo_block_until_lock:
        return time.time() < _yahoo_block_until_ts


def _yahoo_block_for(seconds: int) -> None:
    global _yahoo_block_until_ts
    with _yahoo_block_until_lock:
        _yahoo_block_until_ts = max(_yahoo_block_until_ts, time.time() + seconds)


def _yahoo_symbol_is_softblocked(symbol: str) -> bool:
    sym = (symbol or "").upper().strip()
    if not sym:
        return False
    with _yahoo_fail_lock:
        until = _yahoo_fail_until.get(sym)
        return bool(until and time.time() < until)


def _yahoo_symbol_softblock(symbol: str, minutes: int) -> None:
    sym = (symbol or "").upper().strip()
    if not sym:
        return
    with _yahoo_fail_lock:
        _yahoo_fail_until[sym] = max(_yahoo_fail_until.get(sym, 0.0), time.time() + minutes * 60)


def _singleflight_begin(key: str) -> Tuple[bool, threading.Event]:
    with _inflight_lock:
        ev = _inflight.get(key)
        if ev is None:
            ev = threading.Event()
            _inflight[key] = ev
            return True, ev
        return False, ev


def _singleflight_end(key: str, result: Dict[str, Any]) -> None:
    with _inflight_lock:
        _inflight_result[key] = result
        ev = _inflight.get(key)
        if ev:
            ev.set()
        _inflight.pop(key, None)


def _singleflight_wait(key: str, ev: threading.Event, timeout: float = 10.0) -> Optional[Dict[str, Any]]:
    ok = ev.wait(timeout=timeout)
    if not ok:
        return None
    with _inflight_lock:
        return _inflight_result.pop(key, None)


# ============================================================
# Config
# ============================================================
FUND_DB_PATH = os.getenv("FUND_DB_PATH", os.path.join("data", "fundamentals.db"))

SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "Fundsap/1.0 (contact@fundsap.local)")

CACHE_TTL_DAYS_US = int(os.getenv("FUND_CACHE_TTL_DAYS_US", "30"))
CACHE_TTL_DAYS_IN = int(os.getenv("FUND_CACHE_TTL_DAYS_IN", "30"))

SEC_MIN_DELAY = float(os.getenv("SEC_MIN_DELAY", "0.12"))
_last_sec_call_ts = 0.0


# ============================================================
# DB helpers
# ============================================================
def _db_connect() -> sqlite3.Connection:
    dirp = os.path.dirname(FUND_DB_PATH)
    if dirp:
        os.makedirs(dirp, exist_ok=True)
    con = sqlite3.connect(FUND_DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_fundamentals_db() -> None:
    con = _db_connect()
    cur = con.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS fundamentals_latest (
      market        TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      currency      TEXT,
      asof_date     TEXT,
      updated_at    TEXT NOT NULL,
      source        TEXT,

      market_cap    REAL,
      pe            REAL,
      pb            REAL,

      revenue_ttm    REAL,
      net_income_ttm REAL,
      fcf_ttm        REAL,

      debt_to_equity REAL,
      roe            REAL,

      raw_json      TEXT,
      PRIMARY KEY (market, symbol)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS sec_ticker_cik (
      symbol     TEXT PRIMARY KEY,
      cik10      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    """)

    con.commit()
    con.close()


def _now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _is_stale(updated_at_iso: Optional[str], ttl_days: int) -> bool:
    if not updated_at_iso:
        return True
    try:
        ts = dt.datetime.fromisoformat(updated_at_iso.replace("Z", "+00:00"))
        age = dt.datetime.now(dt.timezone.utc) - ts
        return age.total_seconds() > ttl_days * 86400
    except Exception:
        return True


def get_cached_fundamentals(market: str, symbol: str) -> Optional[Dict[str, Any]]:
    con = _db_connect()
    cur = con.cursor()
    row = cur.execute(
        "SELECT * FROM fundamentals_latest WHERE market=? AND symbol=?",
        (market.upper(), symbol.upper())
    ).fetchone()
    con.close()
    return dict(row) if row else None


def upsert_fundamentals(market: str, symbol: str, payload: Dict[str, Any]) -> None:
    con = _db_connect()
    cur = con.cursor()

    cols = [
        "market", "symbol", "currency", "asof_date", "updated_at", "source",
        "market_cap", "pe", "pb",
        "revenue_ttm", "net_income_ttm", "fcf_ttm",
        "debt_to_equity", "roe",
        "raw_json"
    ]

    values = [
        market.upper(),
        symbol.upper(),
        payload.get("currency"),
        payload.get("asof_date"),
        payload.get("updated_at", _now_iso()),
        payload.get("source"),
        payload.get("market_cap"),
        payload.get("pe"),
        payload.get("pb"),
        payload.get("revenue_ttm"),
        payload.get("net_income_ttm"),
        payload.get("fcf_ttm"),
        payload.get("debt_to_equity"),
        payload.get("roe"),
        payload.get("raw_json"),
    ]

    placeholders = ",".join(["?"] * len(cols))
    update_set = ",".join([f"{c}=excluded.{c}" for c in cols if c not in ("market", "symbol")])

    cur.execute(
        f"""
        INSERT INTO fundamentals_latest ({",".join(cols)})
        VALUES ({placeholders})
        ON CONFLICT(market, symbol) DO UPDATE SET {update_set}
        """,
        values
    )
    con.commit()
    con.close()


# ============================================================
# Utility
# ============================================================
def _to_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        if isinstance(x, bool):
            return None
        return float(x)
    except Exception:
        return None


# ============================================================
# ✅ Screener (India)
# ============================================================
def _screener_fetch_summary(symbol: str, force_refresh: bool) -> Dict[str, Any]:
    """
    Returns a yfinance-like summary dict so the merge logic stays simple.
    """
    snap = get_screener_snapshot_cached(symbol, force_refresh=force_refresh)

    roe_decimal = None
    if snap.roe_pct is not None:
        roe_decimal = float(snap.roe_pct) / 100.0

    out = {
        "currency": snap.currency,
        "market_cap": snap.market_cap_inr,
        "pe": snap.pe,
        "pb": snap.pb,
        "revenue_ttm": None,
        "net_income_ttm": None,
        "fcf_ttm": None,
        "debt_to_equity": None,
        "roe": roe_decimal,
        "raw_screener": {
            "code": snap.code,
            "url": snap.url,
            "current_price": snap.current_price_inr,
            "book_value": snap.book_value_inr,
            "dividend_yield_pct": snap.dividend_yield_pct,
            "roce_pct": snap.roce_pct,
            "high_52w": snap.high_52w_inr,
            "low_52w": snap.low_52w_inr,
        },
    }
    return out


# ============================================================
# Yahoo via yfinance (STRICT by default)
# ============================================================
def _yf_fetch_summary(symbol: str, allow_info: bool = False) -> Dict[str, Any]:
    sym = (symbol or "").upper().strip()

    if _yahoo_is_blocked() or _yahoo_symbol_is_softblocked(sym):
        return {"raw_yf": {}, "yf_skipped": True}

    t = yf.Ticker(sym)

    out: Dict[str, Any] = {
        "currency": None,
        "market_cap": None,
        "pe": None,
        "pb": None,
        "revenue_ttm": None,
        "net_income_ttm": None,
        "fcf_ttm": None,
        "debt_to_equity": None,
        "roe": None,
        "raw_yf": {},
    }

    # 1) cheap fast_info
    try:
        _yahoo_rate_limit()
        fi = getattr(t, "fast_info", None)
        if fi:
            out["currency"] = fi.get("currency")
            out["market_cap"] = _to_float(fi.get("market_cap") or fi.get("marketCap"))
    except Exception as e:
        out["fast_info_error"] = repr(e)

    # If we got market_cap OR we are not allowed to use heavy info => stop here
    if out["market_cap"] is not None or not allow_info:
        return out

    # 2) heavy .info (ONLY on refresh)
    backoffs = [1.0, 2.0, 4.0]
    last_err = None

    for base_sleep in backoffs:
        try:
            _yahoo_rate_limit()
            info = t.info or {}
            out["raw_yf"] = info

            out["market_cap"] = _to_float(info.get("marketCap")) or out["market_cap"]
            out["pe"] = _to_float(info.get("trailingPE") or info.get("forwardPE"))
            out["pb"] = _to_float(info.get("priceToBook"))
            out["currency"] = info.get("currency") or out["currency"]

            out["revenue_ttm"] = _to_float(info.get("totalRevenue"))
            out["net_income_ttm"] = _to_float(info.get("netIncomeToCommon"))
            out["roe"] = _to_float(info.get("returnOnEquity"))
            out["debt_to_equity"] = _to_float(info.get("debtToEquity"))
            out["fcf_ttm"] = _to_float(info.get("freeCashflow"))

            return out

        except Exception as e:
            last_err = e
            msg = str(e).lower()

            if "too many requests" in msg or "429" in msg or "expecting value" in msg:
                _yahoo_block_for(YAHOO_COOLDOWN_SECONDS)
                _yahoo_symbol_softblock(sym, YAHOO_FAIL_SOFTCACHE_MINUTES)
                time.sleep(base_sleep + random.random() * 0.35)
                continue

            _yahoo_symbol_softblock(sym, YAHOO_FAIL_SOFTCACHE_MINUTES)
            break

    out["yf_error"] = repr(last_err) if last_err else "unknown"
    return out


# ============================================================
# SEC XBRL (US primary)
# ============================================================
def _sec_rate_limit():
    global _last_sec_call_ts
    now = time.time()
    delta = now - _last_sec_call_ts
    if delta < SEC_MIN_DELAY:
        time.sleep(SEC_MIN_DELAY - delta)
    _last_sec_call_ts = time.time()


def _sec_get_ticker_map() -> Dict[str, str]:
    _sec_rate_limit()
    url = "https://www.sec.gov/files/company_tickers.json"
    headers = {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"}
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    data = r.json()

    out: Dict[str, str] = {}
    for _, rec in data.items():
        tik = (rec.get("ticker") or "").upper().strip()
        cik = str(rec.get("cik_str") or "").strip()
        if not tik or not cik:
            continue
        out[tik] = cik.zfill(10)
    return out


def _get_cik_for_symbol(symbol: str) -> Optional[str]:
    sym = symbol.upper().strip()
    con = _db_connect()
    cur = con.cursor()
    row = cur.execute("SELECT cik10, updated_at FROM sec_ticker_cik WHERE symbol=?", (sym,)).fetchone()

    if row and not _is_stale(row["updated_at"], 30):
        con.close()
        return row["cik10"]

    try:
        mp = _sec_get_ticker_map()
        cik10 = mp.get(sym)
        if cik10:
            cur.execute(
                """
                INSERT INTO sec_ticker_cik(symbol, cik10, updated_at)
                VALUES(?,?,?)
                ON CONFLICT(symbol) DO UPDATE SET cik10=excluded.cik10, updated_at=excluded.updated_at
                """,
                (sym, cik10, _now_iso())
            )
            con.commit()
        con.close()
        return cik10
    except Exception:
        con.close()
        return None


def _sec_fetch_companyfacts(cik10: str) -> Dict[str, Any]:
    _sec_rate_limit()
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"
    headers = {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"}
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def _pick_facts_series(cf: Dict[str, Any], taxonomy: str, tag: str, unit: str) -> List[Dict[str, Any]]:
    try:
        return cf["facts"][taxonomy][tag]["units"][unit]
    except Exception:
        return []


def _latest_by_end(items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    best = None
    best_end = None
    for it in items:
        end = it.get("end")
        if not end:
            continue
        if best_end is None or end > best_end:
            best = it
            best_end = end
    return best


def _last_n_quarters(items: List[Dict[str, Any]], n: int) -> List[Dict[str, Any]]:
    valid_forms = {"10-Q", "10-K", "20-F", "40-F"}
    quarter_fps = {"Q1", "Q2", "Q3", "Q4"}

    filtered = []
    for it in items:
        if (it.get("form") or "").upper() not in valid_forms:
            continue
        if (it.get("fp") or "").upper() not in quarter_fps:
            continue
        if not it.get("end"):
            continue
        filtered.append(it)

    filtered.sort(key=lambda x: x["end"], reverse=True)
    return filtered[:n]


def _sum_vals(items: List[Dict[str, Any]]) -> Optional[float]:
    vals = []
    for it in items:
        v = _to_float(it.get("val"))
        if v is not None:
            vals.append(v)
    if not vals:
        return None
    return float(sum(vals))


def _sec_compute_metrics(symbol: str) -> Dict[str, Any]:
    cik10 = _get_cik_for_symbol(symbol)
    if not cik10:
        return {"sec_ok": False}

    cf = _sec_fetch_companyfacts(cik10)

    rev = _pick_facts_series(cf, "us-gaap", "Revenues", "USD")
    if not rev:
        rev = _pick_facts_series(cf, "us-gaap", "SalesRevenueNet", "USD")

    ni = _pick_facts_series(cf, "us-gaap", "NetIncomeLoss", "USD")
    ocf = _pick_facts_series(cf, "us-gaap", "NetCashProvidedByUsedInOperatingActivities", "USD")
    capex = _pick_facts_series(cf, "us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment", "USD")

    equity = _pick_facts_series(cf, "us-gaap", "StockholdersEquity", "USD")
    if not equity:
        equity = _pick_facts_series(
            cf,
            "us-gaap",
            "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
            "USD"
        )

    debt_cur = _pick_facts_series(cf, "us-gaap", "DebtCurrent", "USD")
    debt_lt = _pick_facts_series(cf, "us-gaap", "LongTermDebtNoncurrent", "USD")
    liab = _pick_facts_series(cf, "us-gaap", "Liabilities", "USD")

    rev4 = _sum_vals(_last_n_quarters(rev, 4))
    ni4 = _sum_vals(_last_n_quarters(ni, 4))
    ocf4 = _sum_vals(_last_n_quarters(ocf, 4))
    cap4 = _sum_vals(_last_n_quarters(capex, 4))

    if rev4 is None:
        rev_latest = _latest_by_end([it for it in rev if (it.get("fp") or "").upper() == "FY"])
        rev4 = _to_float(rev_latest.get("val")) if rev_latest else None
    if ni4 is None:
        ni_latest = _latest_by_end([it for it in ni if (it.get("fp") or "").upper() == "FY"])
        ni4 = _to_float(ni_latest.get("val")) if ni_latest else None

    fcf4 = None
    if ocf4 is not None and cap4 is not None:
        fcf4 = ocf4 + cap4

    eq_latest_item = _latest_by_end(equity)
    eq_latest = _to_float(eq_latest_item.get("val")) if eq_latest_item else None
    asof_date = (eq_latest_item.get("end") if eq_latest_item else None)

    debt_latest = None
    dcur_latest_item = _latest_by_end(debt_cur)
    dlt_latest_item = _latest_by_end(debt_lt)
    if dcur_latest_item or dlt_latest_item:
        debt_latest = (_to_float(dcur_latest_item.get("val")) if dcur_latest_item else 0.0) + \
                      (_to_float(dlt_latest_item.get("val")) if dlt_latest_item else 0.0)
    else:
        liab_latest_item = _latest_by_end(liab)
        debt_latest = _to_float(liab_latest_item.get("val")) if liab_latest_item else None
        if asof_date is None and liab_latest_item:
            asof_date = liab_latest_item.get("end")

    debt_to_equity = None
    if debt_latest is not None and eq_latest not in (None, 0.0):
        debt_to_equity = debt_latest / eq_latest

    roe = None
    if ni4 is not None and eq_latest not in (None, 0.0):
        roe = ni4 / eq_latest

    return {
        "sec_ok": True,
        "asof_date": asof_date,
        "revenue_ttm": rev4,
        "net_income_ttm": ni4,
        "fcf_ttm": fcf4,
        "debt_to_equity": debt_to_equity,
        "roe": roe,
        "raw_sec": cf,
    }


# ============================================================
# Response formatting
# ============================================================
def _pick_source(market_u: str, sec_data: Dict[str, Any], yf_data: Dict[str, Any]) -> str:
    if market_u == "IN":
        return "screener"
    if sec_data.get("sec_ok") and (not yf_data.get("yf_skipped")):
        return "sec+yf"
    if sec_data.get("sec_ok"):
        return "sec"
    return "yf"


def _format_response(row: Dict[str, Any]) -> Dict[str, Any]:
    def f(x):
        return None if x is None else float(x)

    return {
        "market": row.get("market"),
        "symbol": row.get("symbol"),
        "updated_at": row.get("updated_at"),
        "asof_date": row.get("asof_date"),
        "currency": row.get("currency"),
        "source": row.get("source"),
        "ratios": {
            "pe": f(row.get("pe")),
            "pb": f(row.get("pb")),
            "roe": f(row.get("roe")),
            "debt_to_equity": f(row.get("debt_to_equity")),
        },
        "ttm": {
            "revenue": f(row.get("revenue_ttm")),
            "net_income": f(row.get("net_income_ttm")),
            "fcf": f(row.get("fcf_ttm")),
        },
        "market_cap": f(row.get("market_cap")),
    }


# ============================================================
# Public API: compute + cache fundamentals (with single-flight)
# ============================================================
def compute_and_cache_fundamentals(market: str, symbol: str, force_refresh: bool = False) -> Dict[str, Any]:
    init_fundamentals_db()

    market_u = (market or "US").upper().strip()
    symbol_u = (symbol or "").upper().strip()

    key = f"{market_u}:{symbol_u}:r{1 if force_refresh else 0}"

    is_leader, ev = _singleflight_begin(key)
    if not is_leader:
        shared = _singleflight_wait(key, ev, timeout=10.0)
        if shared:
            return shared

    try:
        ttl = CACHE_TTL_DAYS_US if market_u == "US" else CACHE_TTL_DAYS_IN
        cached = get_cached_fundamentals(market_u, symbol_u)

        if cached and (not force_refresh) and (not _is_stale(cached.get("updated_at"), ttl)):
            resp = _format_response(cached)
            _singleflight_end(key, resp)
            return resp

        # ✅ INDIA: use Screener, no Yahoo at all
        if market_u == "IN":
            sc = _screener_fetch_summary(symbol_u, force_refresh=force_refresh)

            merged = {
                "market": market_u,
                "symbol": symbol_u,
                "currency": sc.get("currency"),
                "asof_date": None,
                "updated_at": _now_iso(),
                "source": "screener",
                "market_cap": sc.get("market_cap"),
                "pe": sc.get("pe"),
                "pb": sc.get("pb"),
                "revenue_ttm": None,
                "net_income_ttm": None,
                "fcf_ttm": None,
                "debt_to_equity": None,
                "roe": sc.get("roe"),
            }

            merged["raw_json"] = json.dumps(
                {"debug": {"provider": "screener"}, "screener": sc.get("raw_screener", {})},
                separators=(",", ":"),
            )

            upsert_fundamentals(market_u, symbol_u, merged)
            final = get_cached_fundamentals(market_u, symbol_u) or merged
            resp = _format_response(final)

            _singleflight_end(key, resp)
            return resp

        # ✅ US: keep your exact current behavior
        if (not force_refresh) and cached and _yahoo_is_blocked():
            resp = _format_response(cached)
            _singleflight_end(key, resp)
            return resp

        sec_data = {"sec_ok": False}
        if market_u == "US":
            try:
                sec_data = _sec_compute_metrics(symbol_u)
            except Exception:
                sec_data = {"sec_ok": False}

        allow_info = bool(force_refresh and YAHOO_ALLOW_INFO_ON_REFRESH_ONLY)

        yf_data: Dict[str, Any] = {}
        try:
            yf_data = _yf_fetch_summary(symbol_u, allow_info=allow_info)
        except Exception as e:
            yf_data = {"yf_error": repr(e), "raw_yf": {}}

        merged = {
            "market": market_u,
            "symbol": symbol_u,
            "currency": yf_data.get("currency"),
            "asof_date": sec_data.get("asof_date") or None,
            "updated_at": _now_iso(),
            "source": _pick_source(market_u, sec_data, yf_data),

            "market_cap": yf_data.get("market_cap"),
            "pe": yf_data.get("pe"),
            "pb": yf_data.get("pb"),

            "revenue_ttm": sec_data.get("revenue_ttm") if sec_data.get("sec_ok") else yf_data.get("revenue_ttm"),
            "net_income_ttm": sec_data.get("net_income_ttm") if sec_data.get("sec_ok") else yf_data.get("net_income_ttm"),
            "fcf_ttm": sec_data.get("fcf_ttm") if sec_data.get("sec_ok") else yf_data.get("fcf_ttm"),
            "debt_to_equity": sec_data.get("debt_to_equity") if sec_data.get("sec_ok") else yf_data.get("debt_to_equity"),
            "roe": sec_data.get("roe") if sec_data.get("sec_ok") else yf_data.get("roe"),
        }

        debug = {
            "sec_ok": bool(sec_data.get("sec_ok")),
            "yf_skipped": bool(yf_data.get("yf_skipped")),
            "yf_error": yf_data.get("yf_error"),
            "cooldown_active": _yahoo_is_blocked(),
            "allow_info": allow_info,
        }
        merged["raw_json"] = json.dumps({"debug": debug}, separators=(",", ":"))

        upsert_fundamentals(market_u, symbol_u, merged)

        final = get_cached_fundamentals(market_u, symbol_u) or merged
        resp = _format_response(final)

        _singleflight_end(key, resp)
        return resp

    except Exception:
        _singleflight_end(key, {"market": market_u, "symbol": symbol_u, "error": "fundamentals_failed"})
        raise
