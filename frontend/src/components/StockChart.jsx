import { useEffect, useMemo, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import TimeRangePills from "./TimeRangePills";

function toTime(v) {
    if (!v) return null;

    if (typeof v === "string") {
        return v.length >= 10 ? v.slice(0, 10) : v; // "YYYY-MM-DD"
    }

    if (typeof v === "number") {
        return v > 10_000_000_000 ? Math.floor(v / 1000) : v; // ms -> sec if needed
    }

    return null;
}

function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];

    const out = [];
    for (const r of rows) {
        const t = toTime(r.time ?? r.date ?? r.datetime ?? r.ts);
        if (!t) continue;

        const o = Number(r.open);
        const h = Number(r.high);
        const l = Number(r.low);
        const c = Number(r.close ?? r.adj_close ?? r.adjClose);

        if (![o, h, l, c].every((x) => Number.isFinite(x))) continue;

        out.push({ time: t, open: o, high: h, low: l, close: c });
    }
    return out;
}

export default function StockChart({ market, symbol, rows, days, setDays, error }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleRef = useRef(null);

    const candles = useMemo(() => normalizeRows(rows), [rows]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const chart = createChart(el, {
            height: 520,
            layout: {
                background: { color: "transparent" },
                textColor: "rgba(255,255,255,0.85)",
            },
            grid: {
                vertLines: { color: "rgba(255,255,255,0.06)" },
                horzLines: { color: "rgba(255,255,255,0.06)" },
            },
            rightPriceScale: { borderColor: "rgba(255,255,255,0.10)" },
            timeScale: { borderColor: "rgba(255,255,255,0.10)" },
            crosshair: {
                vertLine: { color: "rgba(255,255,255,0.15)" },
                horzLine: { color: "rgba(255,255,255,0.15)" },
            },
        });

        // ✅ v5 API:
        const candlesSeries = chart.addSeries(CandlestickSeries, {});

        chartRef.current = chart;
        candleRef.current = candlesSeries;

        const ro = new ResizeObserver(() => {
            const w = el.clientWidth || 800;
            chart.applyOptions({ width: w });
            chart.timeScale().fitContent();
        });
        ro.observe(el);

        return () => {
            ro.disconnect();
            chart.remove();
            chartRef.current = null;
            candleRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!candleRef.current) return;
        candleRef.current.setData(candles);
        chartRef.current?.timeScale().fitContent();
    }, [candles]);

    const title = symbol ? `${symbol} (${market}) Chart` : "Chart";

    return (
        <div
            style={{
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.22)",
                backdropFilter: "blur(10px)",
                minHeight: 640,
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                        {error
                            ? `Error: ${error}`
                            : candles.length
                                ? `${candles.length} candles loaded`
                                : "No data"}
                    </div>
                </div>

                <div style={{ textAlign: "right", fontSize: 12, opacity: 0.75 }}>
                    Range: {days} days
                </div>
            </div>

            <div style={{ marginTop: 12, marginBottom: 12 }}>
                <TimeRangePills range={days} setRange={setDays} />
            </div>

            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    borderRadius: 14,
                    border: "1px dashed rgba(255,255,255,0.10)",
                    overflow: "hidden",
                    background: "rgba(0,0,0,0.18)",
                }}
            />
        </div>
    );
}
