import { useEffect, useMemo, useRef } from "react";
import {
    createChart,
    CandlestickSeries,
    LineSeries,
    LineStyle,
} from "lightweight-charts";

function fmtMoney(v, currency) {
    if (v == null || !Number.isFinite(v)) return "--";
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: currency || "USD",
            maximumFractionDigits: 2,
        }).format(v);
    } catch {
        return `${currency || ""} ${Number(v).toFixed(2)}`;
    }
}

function fmtPct(v) {
    if (v == null || !Number.isFinite(v)) return "--";
    const s = v >= 0 ? "+" : "";
    return `${s}${v.toFixed(2)}%`;
}

function hasOHLC(rows) {
    if (!rows || rows.length === 0) return false;
    const r = rows[0];
    return (
        typeof r.open === "number" &&
        typeof r.high === "number" &&
        typeof r.low === "number" &&
        typeof r.close === "number"
    );
}

/* =========================
   INDICATORS
========================= */
function sma(rows, period) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < rows.length; i++) {
        sum += rows[i].close;
        if (i >= period) sum -= rows[i - period].close;
        if (i >= period - 1) out.push({ time: rows[i].time, value: sum / period });
    }
    return out;
}

function ema(rows, period) {
    const out = [];
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < rows.length; i++) {
        const c = rows[i].close;
        prev = prev == null ? c : c * k + prev * (1 - k);
        if (i >= period - 1) out.push({ time: rows[i].time, value: prev });
    }
    return out;
}

function wma(rows, period) {
    const out = [];
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < rows.length; i++) {
        let num = 0;
        for (let j = 0; j < period; j++) num += rows[i - j].close * (period - j);
        out.push({ time: rows[i].time, value: num / denom });
    }
    return out;
}

function vwap(rows) {
    const out = [];
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < rows.length; i++) {
        const tp = (rows[i].high + rows[i].low + rows[i].close) / 3;
        const vol = rows[i].volume ?? 0;
        cumPV += tp * vol;
        cumV += vol;
        if (cumV > 0) out.push({ time: rows[i].time, value: cumPV / cumV });
    }
    return out;
}

function stddev(arr) {
    const n = arr.length;
    if (!n) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return Math.sqrt(v);
}

function bollinger(rows, period, mult) {
    const mid = sma(rows, period);
    const upper = [];
    const lower = [];
    for (let i = period - 1; i < rows.length; i++) {
        const window = rows.slice(i - period + 1, i + 1).map((x) => x.close);
        const m = mid[i - (period - 1)].value;
        const sd = stddev(window);
        upper.push({ time: rows[i].time, value: m + mult * sd });
        lower.push({ time: rows[i].time, value: m - mult * sd });
    }
    return { mid, upper, lower };
}

function donchian(rows, period) {
    const upper = [];
    const lower = [];
    for (let i = period - 1; i < rows.length; i++) {
        const window = rows.slice(i - period + 1, i + 1);
        const hi = Math.max(...window.map((x) => x.high));
        const lo = Math.min(...window.map((x) => x.low));
        upper.push({ time: rows[i].time, value: hi });
        lower.push({ time: rows[i].time, value: lo });
    }
    return { upper, lower };
}

function trueRange(curr, prevClose) {
    const a = curr.high - curr.low;
    const b = Math.abs(curr.high - prevClose);
    const c = Math.abs(curr.low - prevClose);
    return Math.max(a, b, c);
}

function atr(rows, period) {
    const out = [];
    const trs = [];
    for (let i = 0; i < rows.length; i++) {
        const prevClose = i === 0 ? rows[i].close : rows[i - 1].close;
        trs.push(trueRange(rows[i], prevClose));
    }
    for (let i = period - 1; i < trs.length; i++) {
        const window = trs.slice(i - period + 1, i + 1);
        const avg = window.reduce((a, b) => a + b, 0) / period;
        out.push({ time: rows[i].time, value: avg });
    }
    return out;
}

function keltner(rows, period, mult) {
    const mid = ema(rows, period);
    const a = atr(rows, period);
    const upper = [];
    const lower = [];
    const offset = rows.length - a.length;
    for (let i = 0; i < a.length; i++) {
        const t = a[i].time;
        const m = mid[i]?.value ?? mid[mid.length - 1]?.value;
        const av = a[i].value;
        upper.push({ time: t, value: m + mult * av });
        lower.push({ time: t, value: m - mult * av });
    }
    return { mid: mid.slice(offset), upper, lower };
}

/* =========================
   STYLE MAP (legend + lines)
========================= */
const STYLE = {
    SMA: { color: "rgba(56,189,248,0.95)", width: 2, dash: LineStyle.Solid },
    EMA: { color: "rgba(59,130,246,0.95)", width: 2, dash: LineStyle.Solid },
    WMA: { color: "rgba(14,165,233,0.95)", width: 2, dash: LineStyle.Dotted },
    VWAP: { color: "rgba(245,158,11,0.95)", width: 2, dash: LineStyle.Dotted },

    BB_MID: { color: "rgba(147,197,253,0.85)", width: 2, dash: LineStyle.Solid },
    BB_BAND: { color: "rgba(59,130,246,0.35)", width: 1, dash: LineStyle.Solid },

    DON: { color: "rgba(52,211,153,0.35)", width: 1, dash: LineStyle.Solid },
    KEL: { color: "rgba(168,85,247,0.35)", width: 1, dash: LineStyle.Solid },
};

export default function StockChart({
    symbol,
    range,
    setRange,
    indicators,
    meta,
    data,
    loading,
    error,
}) {
    const containerRef = useRef(null);

    const chartRef = useRef(null);
    const candleRef = useRef(null);
    const lineRef = useRef(null);
    const overlayRefs = useRef([]); // created line series
    const aliveRef = useRef(false);

    const currency = meta?.currency || "USD";
    const rangeBtns = useMemo(() => ["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"], []);

    // Legend based on enabled indicators
    const legendItems = useMemo(() => {
        const enabled = (indicators || []).filter((x) => x.enabled);
        const items = [];

        for (const ind of enabled) {
            if (ind.type === "SMA") items.push({ label: `SMA(${ind.period || 20})`, color: STYLE.SMA.color });
            if (ind.type === "EMA") items.push({ label: `EMA(${ind.period || 20})`, color: STYLE.EMA.color });
            if (ind.type === "WMA") items.push({ label: `WMA(${ind.period || 20})`, color: STYLE.WMA.color });
            if (ind.type === "VWAP") items.push({ label: "VWAP", color: STYLE.VWAP.color });

            if (ind.type === "BB") {
                items.push({ label: `BB Mid`, color: STYLE.BB_MID.color });
                items.push({ label: `BB Bands`, color: STYLE.BB_BAND.color });
            }
            if (ind.type === "DONCHIAN") items.push({ label: `Donchian(${ind.period || 20})`, color: STYLE.DON.color });
            if (ind.type === "KELTNER") items.push({ label: `Keltner(${ind.period || 20})`, color: STYLE.KEL.color });
        }

        return items.slice(0, 10); // keep UI clean
    }, [indicators]);

    // Create chart ONCE
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        aliveRef.current = true;

        const chart = createChart(el, {
            autoSize: true,
            layout: {
                background: { color: "transparent" },
                textColor: "rgba(248,250,252,0.85)",
                fontFamily:
                    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
            },
            grid: {
                vertLines: { color: "rgba(255,255,255,0.06)" },
                horzLines: { color: "rgba(255,255,255,0.06)" },
            },
            rightPriceScale: { borderColor: "rgba(255,255,255,0.10)" },
            timeScale: {
                borderColor: "rgba(255,255,255,0.10)",
                rightOffset: 6,
                barSpacing: 8,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            crosshair: {
                vertLine: { color: "rgba(255,255,255,0.18)" },
                horzLine: { color: "rgba(255,255,255,0.18)" },
            },
        });

        chartRef.current = chart;

        candleRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "rgba(34,197,94,1)",
            downColor: "rgba(239,68,68,1)",
            borderUpColor: "rgba(34,197,94,1)",
            borderDownColor: "rgba(239,68,68,1)",
            wickUpColor: "rgba(34,197,94,1)",
            wickDownColor: "rgba(239,68,68,1)",
        });

        lineRef.current = chart.addSeries(LineSeries, {
            lineWidth: 2,
            priceLineVisible: true,
            color: "rgba(148,163,184,0.90)",
        });

        const ro = new ResizeObserver(() => {
            if (!aliveRef.current) return;
            try {
                chart.timeScale().fitContent();
            } catch { }
        });
        ro.observe(el);

        return () => {
            aliveRef.current = false;
            try { ro.disconnect(); } catch { }
            try { chart.remove(); } catch { }
            chartRef.current = null;
            candleRef.current = null;
            lineRef.current = null;
            overlayRefs.current = [];
        };
    }, []);

    // Update data + overlays
    useEffect(() => {
        const chart = chartRef.current;
        const candle = candleRef.current;
        const line = lineRef.current;
        if (!aliveRef.current || !chart || !candle || !line) return;

        // remove old overlays
        overlayRefs.current.forEach((s) => {
            try { chart.removeSeries(s); } catch { }
        });
        overlayRefs.current = [];

        if (!data || data.length === 0) {
            try { candle.setData([]); line.setData([]); } catch { }
            return;
        }

        const useCandles = hasOHLC(data);

        try {
            if (useCandles) {
                candle.setData(data);
                line.setData([]);
            } else {
                candle.setData([]);
                line.setData(data.map((d) => ({ time: d.time, value: d.close })));
            }
        } catch {
            return;
        }

        // helper to add line series
        const addLine = (seriesData, style) => {
            const s = chart.addSeries(LineSeries, {
                color: style.color,
                lineWidth: style.width,
                lineStyle: style.dash,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            s.setData(seriesData);
            overlayRefs.current.push(s);
        };

        const enabled = (indicators || []).filter((x) => x.enabled);

        for (const ind of enabled) {
            try {
                if (ind.type === "SMA") addLine(sma(data, Number(ind.period || 20)), STYLE.SMA);
                if (ind.type === "EMA") addLine(ema(data, Number(ind.period || 20)), STYLE.EMA);
                if (ind.type === "WMA") addLine(wma(data, Number(ind.period || 20)), STYLE.WMA);
                if (ind.type === "VWAP") addLine(vwap(data), STYLE.VWAP);

                if (ind.type === "BB") {
                    const p = Number(ind.period || 20);
                    const m = Number(ind.mult || 2);
                    const bb = bollinger(data, p, m);
                    addLine(bb.mid, STYLE.BB_MID);
                    addLine(bb.upper, STYLE.BB_BAND);
                    addLine(bb.lower, STYLE.BB_BAND);
                }

                if (ind.type === "DONCHIAN") {
                    const p = Number(ind.period || 20);
                    const dc = donchian(data, p);
                    addLine(dc.upper, STYLE.DON);
                    addLine(dc.lower, STYLE.DON);
                }

                if (ind.type === "KELTNER") {
                    const p = Number(ind.period || 20);
                    const m = Number(ind.mult || 2);
                    const kc = keltner(data, p, m);
                    addLine(kc.mid, { ...STYLE.KEL, color: "rgba(168,85,247,0.70)", width: 2 });
                    addLine(kc.upper, STYLE.KEL);
                    addLine(kc.lower, STYLE.KEL);
                }
            } catch {
                // ignore bad params
            }
        }

        try { chart.timeScale().fitContent(); } catch { }
    }, [data, indicators]);

    return (
        <div className="chartWrap">
            <div className="chartHeader">
                <div>
                    <div className="chartTitle">{symbol} Chart</div>
                    <div className="chartMeta">
                        Last: {fmtMoney(meta?.last, currency)}{" "}
                        <span className="muted">
                            Change: {fmtMoney(meta?.change, currency)} ({fmtPct(meta?.changePct)}) •{" "}
                            {meta?.points ?? "--"} points
                        </span>
                    </div>
                </div>

                <div className="rangeRow">
                    {rangeBtns.map((r) => (
                        <button
                            key={r}
                            className={`rangeBtn ${range === r ? "active" : ""}`}
                            onClick={() => setRange(r)}
                            type="button"
                        >
                            {r}
                        </button>
                    ))}
                </div>

                {legendItems.length > 0 && (
                    <div className="legendBar">
                        {legendItems.map((it) => (
                            <div className="legendItem" key={it.label}>
                                <span className="legendSwatch" style={{ background: it.color }} />
                                {it.label}
                            </div>
                        ))}
                    </div>
                )}

                <div className="chartHint">
                    BB bands are lighter lines; dotted overlays (WMA/VWAP) help separate signals.
                </div>
            </div>

            <div className="chartBody">
                <div ref={containerRef} className="chartCanvas" />

                {loading && <div className="overlayMsg">Loading…</div>}
                {!loading && error && <div className="overlayMsg error">{String(error)}</div>}
                {!loading && !error && (!data || data.length === 0) && (
                    <div className="overlayMsg">No data</div>
                )}
            </div>
        </div>
    );
}
