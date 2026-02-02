import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

export default function MarketStockPicker({
    market = "US",
    value,
    symbol,
    onChange,
    limit = 2000,
    autoPickFirst = true, // ✅ optional behavior
}) {
    const selected = value ?? symbol ?? "";
    const setSelected = typeof onChange === "function" ? onChange : () => { };

    const [query, setQuery] = useState("");
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);

    const tRef = useRef(null);
    const didAutoPickRef = useRef(false);

    useEffect(() => {
        if (tRef.current) clearTimeout(tRef.current);

        tRef.current = setTimeout(async () => {
            try {
                setLoading(true);
                const data = await api.fetchWatchlist(market, query, limit);
                setItems(Array.isArray(data) ? data : []);
            } finally {
                setLoading(false);
            }
        }, 250);

        return () => {
            if (tRef.current) clearTimeout(tRef.current);
        };
    }, [market, query, limit]);

    // ✅ Auto-pick first ONLY ONCE (initial load) — avoids symbol jumping while searching
    useEffect(() => {
        if (!autoPickFirst) return;
        if (didAutoPickRef.current) return;
        if (selected) return;
        if (!items.length) return;

        // only auto-pick when query is empty (first page load)
        if ((query || "").trim() !== "") return;

        didAutoPickRef.current = true;
        setSelected(items[0].symbol);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, autoPickFirst]);

    return (
        <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                Search (symbol or name)
            </div>

            <input
                style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.25)",
                    color: "white",
                    outline: "none",
                    marginBottom: 10,
                }}
                placeholder="Type e.g. AAPL, MSFT, RELIANCE"
                value={query}
                onChange={(e) => setQuery(e.target.value)} // ✅ only query changes while typing
            />

            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                Select stock
                <span style={{ float: "right", opacity: 0.7 }}>
                    {loading ? "Loading..." : `${items.length} found`}
                </span>
            </div>

            <select
                style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.25)",
                    color: "white",
                    outline: "none",
                }}
                value={selected || ""}
                onChange={(e) => setSelected(e.target.value)} // ✅ symbol changes only when user chooses
            >
                <option value="" disabled>
                    {items.length ? "Select a stock…" : "No results"}
                </option>

                {items.map((it) => (
                    <option key={it.symbol} value={it.symbol}>
                        {it.name ? `${it.symbol} (${it.name})` : it.symbol}
                    </option>
                ))}
            </select>
        </div>
    );
}
