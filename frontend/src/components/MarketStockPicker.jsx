import { useEffect, useMemo, useRef, useState } from "react";

const STOCKS = {
    US: [
        { symbol: "AAPL", name: "Apple" },
        { symbol: "MSFT", name: "Microsoft" },
        { symbol: "NVDA", name: "NVIDIA" },
        { symbol: "AMZN", name: "Amazon" },
        { symbol: "GOOGL", name: "Alphabet" },
        { symbol: "META", name: "Meta" },
        { symbol: "TSLA", name: "Tesla" },
    ],
    India: [
        { symbol: "RELIANCE.NS", name: "Reliance Industries" },
        { symbol: "TCS.NS", name: "Tata Consultancy Services" },
        { symbol: "INFY.NS", name: "Infosys" },
        { symbol: "HDFCBANK.NS", name: "HDFC Bank" },
        { symbol: "ICICIBANK.NS", name: "ICICI Bank" },
        { symbol: "ITC.NS", name: "ITC" },
    ],
};

export default function MarketStockPicker({
    market = "India",
    symbol,
    setSymbol,
    regex = false,
    onFoundCount,
}) {
    const [q, setQ] = useState("");
    const debounceRef = useRef(null);

    const all = STOCKS[market] || [];

    const filtered = useMemo(() => {
        const query = (q || "").trim();
        if (!query) return all;

        let rx = null;
        if (regex) {
            try {
                rx = new RegExp(query, "i");
            } catch {
                rx = null;
            }
        }

        const match = (s) => {
            const hay = `${s.symbol} ${s.name}`.toLowerCase();
            if (rx) return rx.test(`${s.symbol} ${s.name}`);
            return hay.includes(query.toLowerCase());
        };

        let results = all.filter(match);

        // ✅ CRITICAL FIX: keep currently selected symbol always visible/selectable
        const selected = all.find((x) => x.symbol === symbol);
        if (selected && !results.some((x) => x.symbol === symbol)) {
            results = [selected, ...results];
        }

        return results;
    }, [q, regex, all, symbol]);

    // expose found count (for UI chip "x found")
    useEffect(() => {
        if (typeof onFoundCount === "function") {
            const cnt = (q || "").trim() ? Math.max(filtered.length - 0, 0) : all.length;
            // count true matches (excluding the injected selected item if it doesn't match)
            // simple: if query exists, compute matches only
            if ((q || "").trim()) {
                let countMatches = 0;
                const query = (q || "").trim();
                let rx = null;
                if (regex) {
                    try { rx = new RegExp(query, "i"); } catch { rx = null; }
                }
                const match = (s) => {
                    if (rx) return rx.test(`${s.symbol} ${s.name}`);
                    return `${s.symbol} ${s.name}`.toLowerCase().includes(query.toLowerCase());
                };
                countMatches = all.filter(match).length;
                onFoundCount(countMatches);
            } else {
                onFoundCount(all.length);
            }
        }
    }, [q, regex, filtered, all, onFoundCount]);

    // ✅ Auto-select ONLY when exactly 1 true match exists
    useEffect(() => {
        const query = (q || "").trim();
        if (!query) return;

        let rx = null;
        if (regex) {
            try { rx = new RegExp(query, "i"); } catch { rx = null; }
        }
        const match = (s) => {
            if (rx) return rx.test(`${s.symbol} ${s.name}`);
            return `${s.symbol} ${s.name}`.toLowerCase().includes(query.toLowerCase());
        };

        const trueMatches = all.filter(match);

        if (trueMatches.length === 1 && trueMatches[0].symbol !== symbol) {
            // small debounce to avoid jitter while typing
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                setSymbol(trueMatches[0].symbol);
            }, 250);
        }

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [q, regex, all, symbol, setSymbol]);

    const onEnterPickTop = (e) => {
        if (e.key !== "Enter") return;
        const query = (q || "").trim();
        if (!query) return;
        // pick first in filtered (which includes selected at top sometimes)
        // better: pick first "true match" from all
        let rx = null;
        if (regex) {
            try { rx = new RegExp(query, "i"); } catch { rx = null; }
        }
        const match = (s) => {
            if (rx) return rx.test(`${s.symbol} ${s.name}`);
            return `${s.symbol} ${s.name}`.toLowerCase().includes(query.toLowerCase());
        };
        const top = all.find(match);
        if (top) setSymbol(top.symbol);
    };

    return (
        <>
            <div className="fieldBlock">
                <div className="fieldLabel">Search (symbol or name)</div>
                <div className="fieldRow">
                    <input
                        className="input"
                        placeholder="Type e.g. AAPL, MSFT, RELIANCE"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={onEnterPickTop}
                    />
                    {!!q && (
                        <button
                            className="chip"
                            type="button"
                            onClick={() => setQ("")}
                            title="Clear search"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            <div className="fieldBlock">
                <div className="fieldLabel">Select stock</div>
                <select
                    className="select"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                >
                    {filtered.map((s) => (
                        <option key={s.symbol} value={s.symbol}>
                            {s.symbol} ({s.name})
                        </option>
                    ))}
                </select>
            </div>
        </>
    );
}
