const BASE =
    import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

function qs(obj) {
    const u = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        u.set(k, String(v));
    });
    return u.toString();
}

async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status} for ${url}`);
    }
    return res.json();
}

/**
 * Normalize backend price rows into lightweight-charts OHLCV:
 * [{ time: 'YYYY-MM-DD', open, high, low, close, volume }]
 *
 * Supports common backend shapes:
 * - time/date/dt
 * - open/high/low/close
 * - OHLC in nested objects
 * - If only "close" exists, we synthesize OHLC from close (still charts well).
 */
function normalizeToOHLCV(rawRows) {
    const rows = Array.isArray(rawRows) ? rawRows : [];

    const out = rows
        .map((r) => {
            // time
            const t =
                r.time ??
                r.date ??
                r.dt ??
                r.day ??
                r.timestamp ??
                r.t ??
                null;

            // try ohlc direct
            let open = r.open ?? r.o ?? (r.ohlc?.open ?? r.ohlc?.o);
            let high = r.high ?? r.h ?? (r.ohlc?.high ?? r.ohlc?.h);
            let low = r.low ?? r.l ?? (r.ohlc?.low ?? r.ohlc?.l);
            let close = r.close ?? r.c ?? (r.ohlc?.close ?? r.ohlc?.c);

            // if backend gives `price` or `adjClose` etc.
            if (close == null) close = r.price ?? r.adjClose ?? r.adj_close ?? r.last;

            // volume
            const volume = Number(r.volume ?? r.v ?? r.vol ?? 0);

            // If we only have close → synth OHLC
            if (open == null && close != null) open = close;
            if (high == null && close != null) high = close;
            if (low == null && close != null) low = close;

            const O = Number(open);
            const H = Number(high);
            const L = Number(low);
            const C = Number(close);

            if (!t || !Number.isFinite(C)) return null;

            // lightweight-charts accepts 'YYYY-MM-DD' as time
            const time =
                typeof t === "string" && t.length >= 10 ? t.slice(0, 10) : t;

            return {
                time,
                open: Number.isFinite(O) ? O : C,
                high: Number.isFinite(H) ? H : C,
                low: Number.isFinite(L) ? L : C,
                close: C,
                volume: Number.isFinite(volume) ? volume : 0,
            };
        })
        .filter(Boolean);

    return out;
}

export const api = {
    async getHistory({ market, symbol, days }) {
        // ✅ Your real endpoint
        const url = `${BASE}/api/prices?${qs({ market, symbol, days })}`;
        const res = await getJson(url);

        // backend may return:
        // 1) { data:[...] }
        // 2) { rows:[...] }
        // 3) [...] directly
        const raw =
            Array.isArray(res) ? res :
                Array.isArray(res?.data) ? res.data :
                    Array.isArray(res?.rows) ? res.rows :
                        Array.isArray(res?.items) ? res.items :
                            [];

        const data = normalizeToOHLCV(raw);

        return {
            meta: res?.meta || {},
            data,
        };
    },

    async searchSymbols({ market, q, regex }) {
        // keep your previous logic or connect to your backend search route if you have one
        // fallback simple list:
        const defaults =
            market === "India"
                ? [
                    { symbol: "RELIANCE.NS", name: "Reliance Industries" },
                    { symbol: "TCS.NS", name: "Tata Consultancy Services" },
                    { symbol: "INFY.NS", name: "Infosys" },
                ]
                : [
                    { symbol: "AAPL", name: "Apple" },
                    { symbol: "MSFT", name: "Microsoft" },
                    { symbol: "NVDA", name: "NVIDIA" },
                ];

        if (!q) return defaults;
        const s = q.toLowerCase();
        return defaults.filter(
            (x) => x.symbol.toLowerCase().includes(s) || x.name.toLowerCase().includes(s)
        );
    },
};
