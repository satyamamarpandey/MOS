const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/api";

async function getJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

/** New */
export function fetchWatchlist(market, q = "", limit = 2000) {
    const m = encodeURIComponent(market);
    const qq = encodeURIComponent(q || "");
    return getJson(`${API_BASE}/watchlist?market=${m}&q=${qq}&limit=${limit}&_=${Date.now()}`);
}

export function fetchPrices({ market, symbol, days = 380 }) {
    const m = encodeURIComponent(market);
    const s = encodeURIComponent(symbol);
    return getJson(`${API_BASE}/prices?market=${m}&symbol=${s}&days=${days}&_=${Date.now()}`);
}

/** Backward compatible */
export async function getHistory(arg1, arg2, arg3) {
    // supports:
    // getHistory({ market, symbol, days })
    // getHistory(market, symbol, days)
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

export const api = {
    fetchWatchlist,
    fetchPrices,
    getHistory,
    getPrices,
    getSymbols,
    searchSymbols,
};

export default api;
