const API_BASE =
    import.meta.env.VITE_API_BASE || "http://127.0.0.1:8001/api";

/**
 * If API_BASE is absolute (http...), use it.
 * If you want same-origin proxy, set VITE_API_BASE="/api"
 */
function buildUrl(pathWithQuery) {
    // If API_BASE already ends with /api, we just append /<route>?...
    // Example: API_BASE="http://127.0.0.1:8000/api"
    return `${API_BASE}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
}

async function getJson(url, { signal } = {}) {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

function normalizeMarket(market) {
    const m = (market || "US").toUpperCase();
    if (m === "INDIA") return "IN";
    return m;
}

/** Watchlist */
export function fetchWatchlist(market, q = "", limit = 2000, { signal } = {}) {
    const m = encodeURIComponent(normalizeMarket(market));
    const qq = encodeURIComponent(q || "");
    return getJson(
        buildUrl(`/watchlist?market=${m}&q=${qq}&limit=${limit}&_=${Date.now()}`),
        { signal }
    );
}

/** Prices */
export function fetchPrices({ market, symbol, days = 380, signal } = {}) {
    const m = encodeURIComponent(normalizeMarket(market));
    const s = encodeURIComponent(symbol);
    return getJson(
        buildUrl(`/prices?market=${m}&symbol=${s}&days=${days}&_=${Date.now()}`),
        { signal }
    );
}

/** Fundamentals */
export function fetchFundamentals({
    market,
    symbol,
    refresh = 0,
    signal,
} = {}) {
    const m = encodeURIComponent(normalizeMarket(market));
    const s = encodeURIComponent(symbol);
    const r = encodeURIComponent(String(refresh || 0));
    return getJson(
        buildUrl(`/fundamentals?market=${m}&symbol=${s}&refresh=${r}&_=${Date.now()}`),
        { signal }
    );
}

/** Backward compatible history */
export async function getHistory(arg1, arg2, arg3) {
    let market = "US";
    let symbol = "";
    let days = 380;

    if (typeof arg1 === "object" && arg1) {
        market = arg1.market ?? "US";
        symbol = arg1.symbol ?? "";
        days = arg1.days ?? 380;
    } else {
        market = arg1 ?? "US";
        symbol = arg2 ?? "";
        days = arg3 ?? 380;
    }

    if (!symbol) return [];

    const data = await fetchPrices({ market, symbol, days });
    return Array.isArray(data?.rows) ? data.rows : [];
}

export async function getPrices(arg1, arg2, arg3) {
    return getHistory(arg1, arg2, arg3);
}

export async function getSymbols(market = "US", q = "", limit = 2000) {
    return fetchWatchlist(market, q, limit);
}
export async function searchSymbols(market = "US", q = "", limit = 2000) {
    return fetchWatchlist(market, q, limit);
}

/** Fundamentals helper (object style) */
export async function getFundamentals({
    market = "US",
    symbol = "",
    refresh = 0,
    signal,
} = {}) {
    if (!symbol) return null;
    return fetchFundamentals({ market, symbol, refresh, signal });
}

export const api = {
    fetchWatchlist,
    fetchPrices,
    fetchFundamentals,
    getFundamentals,
    getHistory,
    getPrices,
    getSymbols,
    searchSymbols,
};

export default api;
