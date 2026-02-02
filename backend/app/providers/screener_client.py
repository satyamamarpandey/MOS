from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Optional, Dict, Tuple

import requests
from bs4 import BeautifulSoup

BASE = "https://www.screener.in"


@dataclass
class ScreenerSnapshot:
    code: str
    url: str
    currency: str = "INR"
    market_cap_inr: Optional[float] = None
    current_price_inr: Optional[float] = None
    book_value_inr: Optional[float] = None
    pe: Optional[float] = None
    pb: Optional[float] = None
    roe_pct: Optional[float] = None
    roce_pct: Optional[float] = None
    dividend_yield_pct: Optional[float] = None
    high_52w_inr: Optional[float] = None
    low_52w_inr: Optional[float] = None


# -----------------------------
# Symbol mapping
# RELIANCE.NS -> RELIANCE
# RELIANCE.BO -> RELIANCE
# -----------------------------
def screener_code_from_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if s.endswith(".NS"):
        return s[:-3]
    if s.endswith(".BO"):
        return s[:-3]
    return s


_num_re = re.compile(r"[-+]?\d*\.?\d+")


def _to_float(text: str) -> Optional[float]:
    if not text:
        return None
    t = text.replace(",", "").strip()
    m = _num_re.search(t)
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _parse_market_cap_to_inr(text: str) -> Optional[float]:
    """
    Example: "₹ 18,45,829 Cr." => 1845829 * 1e7 INR
    """
    if not text:
        return None
    t = text.replace(",", "").strip().upper()
    num = _to_float(t)
    if num is None:
        return None
    if "CR" in t:
        return num * 1e7
    return num


def _parse_high_low(text: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Example: "₹ 1,612 / 1,115" => (1612, 1115)
    """
    if not text:
        return (None, None)
    t = text.replace("₹", "").strip()
    parts = [p.strip() for p in t.split("/")]
    if len(parts) != 2:
        return (None, None)
    return (_to_float(parts[0]), _to_float(parts[1]))


def _get_html(url: str, timeout: int = 25) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/121.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": BASE,
        "Connection": "keep-alive",
    }
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r.text


def _parse_top_ratios(soup: BeautifulSoup) -> Dict[str, str]:
    """
    Screener usually exposes a list like ul#top-ratios with li/span label/value.
    This is the most stable way.
    """
    out: Dict[str, str] = {}
    ul = soup.select_one("ul#top-ratios")
    if not ul:
        return out

    for li in ul.select("li"):
        spans = li.select("span")
        if len(spans) >= 2:
            label = spans[0].get_text(" ", strip=True)
            value = spans[1].get_text(" ", strip=True)
            if label and value:
                out[label] = value
    return out


def fetch_screener_snapshot(symbol: str) -> ScreenerSnapshot:
    code = screener_code_from_symbol(symbol)

    url_cons = f"{BASE}/company/{code}/consolidated/"
    url_std = f"{BASE}/company/{code}/"

    # Try consolidated first; fallback to standard
    try:
        html = _get_html(url_cons)
        url_used = url_cons
    except Exception:
        html = _get_html(url_std)
        url_used = url_std

    # ✅ IMPORTANT: no lxml (Py3.13 safe)
    soup = BeautifulSoup(html, "html.parser")

    top = _parse_top_ratios(soup)
    snap = ScreenerSnapshot(code=code, url=url_used)

    # Keys seen on screener:
    # Market Cap, Current Price, High / Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE
    if "Market Cap" in top:
        snap.market_cap_inr = _parse_market_cap_to_inr(top["Market Cap"])

    if "Current Price" in top:
        snap.current_price_inr = _to_float(top["Current Price"])

    if "Book Value" in top:
        snap.book_value_inr = _to_float(top["Book Value"])

    if "Stock P/E" in top:
        snap.pe = _to_float(top["Stock P/E"])

    if "ROE" in top:
        snap.roe_pct = _to_float(top["ROE"])

    if "ROCE" in top:
        snap.roce_pct = _to_float(top["ROCE"])

    if "Dividend Yield" in top:
        snap.dividend_yield_pct = _to_float(top["Dividend Yield"])

    if "High / Low" in top:
        hi, lo = _parse_high_low(top["High / Low"])
        snap.high_52w_inr = hi
        snap.low_52w_inr = lo

    # Derived PB
    if snap.current_price_inr is not None and snap.book_value_inr not in (None, 0.0):
        snap.pb = snap.current_price_inr / snap.book_value_inr

    return snap


# -----------------------------
# Simple TTL cache to avoid hammering screener
# -----------------------------
_CACHE: Dict[str, Tuple[float, ScreenerSnapshot]] = {}
_TTL_SECONDS = 30 * 60  # 30 minutes


def get_screener_snapshot_cached(symbol: str, force_refresh: bool = False) -> ScreenerSnapshot:
    key = (symbol or "").upper().strip()
    now = time.time()

    if not force_refresh and key in _CACHE:
        ts, snap = _CACHE[key]
        if now - ts < _TTL_SECONDS:
            return snap

    snap = fetch_screener_snapshot(symbol)
    _CACHE[key] = (now, snap)
    return snap
