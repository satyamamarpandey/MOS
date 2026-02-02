import { useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";

function fmtNum(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    const n = Number(x);
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(2);
}
function fmtRatio(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    return Number(x).toFixed(2);
}
function fmtPct(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    return (Number(x) * 100).toFixed(2) + "%";
}

export default function FundamentalIndicatorsPanel({ market, symbol }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    // Cache: key = "US:MSFT" or "IN:RELIANCE.NS"
    const cacheRef = useRef(new Map());

    // Track what user last analyzed (separate from selection)
    const [analyzedKey, setAnalyzedKey] = useState("");

    // Abort inflight request when switching or re-analyzing
    const abortRef = useRef(null);

    const selKey = useMemo(() => {
        const m = (market || "").toUpperCase();
        const s = (symbol || "").toUpperCase();
        return m && s ? `${m}:${s}` : "";
    }, [market, symbol]);

    // When selection changes: clear visible fundamentals immediately (avoid confusion)
    useEffect(() => {
        // Abort anything running
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = null;

        setLoading(false);
        setErr("");
        setData(null);

        // Note: cache stays intact in cacheRef (so switching back is instant)
    }, [selKey]);

    async function runFetch({ refresh = 0 } = {}) {
        if (!selKey) return;

        // If cached and not refresh, show instantly and skip network
        if (!refresh && cacheRef.current.has(selKey)) {
            setData(cacheRef.current.get(selKey));
            setErr("");
            setLoading(false);
            setAnalyzedKey(selKey);
            return;
        }

        // Abort previous
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setErr("");

        try {
            const d = await api.getFundamentals({
                market,
                symbol,
                refresh,
                signal: controller.signal,
            });

            cacheRef.current.set(selKey, d);
            setData(d);
            setAnalyzedKey(selKey);
        } catch (e) {
            // Ignore abort
            if (e?.name === "AbortError") return;

            setErr(e?.message || "Failed to load fundamentals");
            setData(null);
        } finally {
            // Only stop loading if this request is still the latest
            if (abortRef.current === controller) {
                setLoading(false);
                abortRef.current = null;
            }
        }
    }

    const rows = useMemo(() => {
        const r = data?.ratios || {};
        const t = data?.ttm || {};
        return [
            { k: "Market Cap", v: data?.market_cap, f: fmtNum },
            { k: "P/E", v: r.pe, f: fmtRatio },
            { k: "P/B", v: r.pb, f: fmtRatio },
            { k: "Revenue (TTM)", v: t.revenue, f: fmtNum },
            { k: "Net Income (TTM)", v: t.net_income, f: fmtNum },
            { k: "FCF (TTM)", v: t.fcf, f: fmtNum },
            { k: "Debt/Equity", v: r.debt_to_equity, f: fmtRatio },
            { k: "ROE", v: r.roe, f: fmtPct },
        ];
    }, [data]);

    const canAnalyze = Boolean(selKey);

    return (
        <div
            style={{
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.22)",
                backdropFilter: "blur(10px)",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Fundamental Indicators</div>
                <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: "nowrap" }}>
                    {loading ? "Loading..." : err ? "—" : (data?.source ? `Source: ${data.source}` : "")}
                </div>
            </div>

            {/* Analyze button inside panel */}
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <button
                    onClick={() => runFetch({ refresh: 0 })}
                    disabled={!canAnalyze}
                    style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: canAnalyze ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                        color: "white",
                        cursor: canAnalyze ? "pointer" : "not-allowed",
                        fontWeight: 800,
                    }}
                >
                    Analyze Fundamentals
                </button>

                <button
                    onClick={() => runFetch({ refresh: 1 })}
                    disabled={!canAnalyze}
                    title="Force refresh (may hit Yahoo)"
                    style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: canAnalyze ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)",
                        color: "white",
                        cursor: canAnalyze ? "pointer" : "not-allowed",
                        fontWeight: 700,
                        opacity: 0.9,
                    }}
                >
                    Refresh
                </button>
            </div>

            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                {market && symbol ? (
                    <>
                        <span style={{ opacity: 0.95 }}>{symbol}</span>{" "}
                        <span style={{ opacity: 0.55 }}>({market})</span>
                        {analyzedKey && analyzedKey !== selKey ? (
                            <span style={{ marginLeft: 10, opacity: 0.55 }}>
                                (Select changed — click Analyze)
                            </span>
                        ) : null}
                        {data?.updated_at ? (
                            <span style={{ marginLeft: 10, opacity: 0.55 }}>Updated: {data.updated_at}</span>
                        ) : null}
                    </>
                ) : (
                    "Pick a stock to view fundamentals."
                )}
            </div>

            {err ? (
                <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>{err}</div>
            ) : !canAnalyze ? (
                <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
                    Select a market and stock to load fundamentals.
                </div>
            ) : !data ? (
                <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
                    Click <b>Analyze Fundamentals</b> to load data. (Results are cached for fast re-open.)
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {rows.map((it) => (
                        <div
                            key={it.k}
                            style={{
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 14,
                                padding: 10,
                                background: "rgba(255,255,255,0.03)",
                            }}
                        >
                            <div style={{ fontSize: 12, opacity: 0.7 }}>{it.k}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                                {it.f(it.v)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
