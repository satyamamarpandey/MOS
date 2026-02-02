// frontend/src/components/StockChart.jsx
import { useEffect, useMemo, useRef } from "react";
import {
    createChart,
    CandlestickSeries,
    LineSeries,
    HistogramSeries,
    LineStyle,
} from "lightweight-charts";
import TimeRangePills from "./TimeRangePills";
import {
    computeIndicator,
    INDICATOR_REGISTRY,
    normalizeIndicatorConfig,
} from "../utils/indicators";

/* -----------------------------
   Helpers: time + row normalize
------------------------------ */
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

        // keep volume if present (needed for VWAP/OBV/MFI)
        const volRaw = r.volume ?? r.vol ?? r.v;
        const volume = volRaw == null ? undefined : Number(volRaw);

        out.push({ time: t, open: o, high: h, low: l, close: c, volume });
    }
    return out;
}

function toSeriesData(candles, values, shift = 0) {
    // shift > 0 moves values forward in time (Ichimoku spans)
    const out = [];
    for (let i = 0; i < candles.length; i++) {
        const v = values?.[i];
        if (v == null || !Number.isFinite(v)) continue;

        const j = i + (shift || 0);
        if (j < 0 || j >= candles.length) continue;

        out.push({ time: candles[j].time, value: v });
    }
    return out;
}

/* -----------------------------
   Color + style system
------------------------------ */

// palette you can tweak
const PALETTE = [
    "#F4C75A", // gold
    "#60A5FA", // blue
    "#A78BFA", // purple
    "#22C55E", // green
    "#F97316", // orange
    "#F472B6", // pink
    "#38BDF8", // cyan
    "#E2E8F0", // silver
];

function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

// If you want specific indicator colors, map them here.
const IND_COLOR_HINTS = {
    SMA: "#F4C75A",
    EMA: "#22C55E",
    WMA: "#A78BFA",
    VWAP: "#60A5FA",
    RSI: "#F97316",
    MACD: "#38BDF8",
    STOCH: "#F472B6",
};

function bbColorFor(lineKey) {
    const k = (lineKey || "").toLowerCase();
    if (k.includes("upper") || k === "u" || k === "up") return "#38BDF8";
    if (k.includes("lower") || k === "l" || k === "low") return "#38BDF8";
    if (k.includes("mid") || k.includes("middle") || k === "m") return "#F4C75A";
    return "#38BDF8";
}

function stochColorFor(lineKey) {
    const k = (lineKey || "").toLowerCase();
    if (k === "d" || k.includes("%d") || k.includes("slow") || k.includes("signal"))
        return "#A78BFA";
    return "#F472B6"; // K
}

function ichimokuColorFor(lineKey) {
    const k = (lineKey || "").toLowerCase();
    if (k.includes("tenkan") || k.includes("conv")) return "#F472B6";
    if (k.includes("kijun") || k.includes("base")) return "#60A5FA";
    if (k.includes("chikou") || k.includes("lag")) return "#E2E8F0";
    if (k.includes("spana") || k.includes("lead a") || k.includes("senkou a")) return "#22C55E";
    if (k.includes("spanb") || k.includes("lead b") || k.includes("senkou b")) return "#EF4444";
    return "#A78BFA";
}

function colorForLine(indType, lineKey) {
    const t = (indType || "").toUpperCase();
    if (t === "BB" || t === "BOLL" || t === "BOLLINGER") return bbColorFor(lineKey);
    if (t === "STOCH" || t === "STOCHASTIC") return stochColorFor(lineKey);
    if (t === "ICHIMOKU") return ichimokuColorFor(lineKey);

    if (IND_COLOR_HINTS[t]) return IND_COLOR_HINTS[t];
    return hashColor(`${t}:${lineKey || "L"}`);
}

function styleFor(indType, lineKey) {
    const t = (indType || "").toUpperCase();
    const k = (lineKey || "").toUpperCase();

    // examples
    if (t === "WMA") return { lineStyle: LineStyle.Dashed, lineWidth: 2 };
    if (t === "VWAP") return { lineStyle: LineStyle.Dotted, lineWidth: 2 };

    // Stoch: D dashed to differentiate
    if ((t === "STOCH" || t === "STOCHASTIC") && k === "D")
        return { lineStyle: LineStyle.Dashed, lineWidth: 2 };

    // BB: mid dotted, bands solid
    if (t === "BB" || t === "BOLL" || t === "BOLLINGER") {
        const lk = (lineKey || "").toLowerCase();
        if (lk.includes("mid") || lk.includes("middle") || lk === "m") {
            return { lineStyle: LineStyle.Dotted, lineWidth: 2 };
        }
        return { lineStyle: LineStyle.Solid, lineWidth: 2 };
    }

    // Ichimoku: cloud spans solid, conversion/base slightly thinner
    if (t === "ICHIMOKU") {
        const lk = (lineKey || "").toLowerCase();
        if (lk.includes("spana") || lk.includes("spanb") || lk.includes("senkou"))
            return { lineStyle: LineStyle.Solid, lineWidth: 2 };
        if (lk.includes("chikou") || lk.includes("lag"))
            return { lineStyle: LineStyle.Dotted, lineWidth: 2 };
        return { lineStyle: LineStyle.Solid, lineWidth: 2 };
    }

    return { lineStyle: LineStyle.Solid, lineWidth: 2 };
}

export default function StockChart({
    market,
    symbol,
    rows,
    days,
    setDays,
    error,
    indicators = [],
}) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleRef = useRef(null);

    // id -> { seriesList: [{ key, series, color }], kind }
    const indSeriesRef = useRef(new Map());

    // v5: keep a ref for the osc host series (registers custom scale)
    const oscHostRef = useRef(null);

    // volume series ref (histogram)
    const volumeRef = useRef(null);

    // legend ref
    const legendRef = useRef(null);

    // overlay canvas behind chart canvases (BB band + Ichimoku cloud)
    const overlayCanvasRef = useRef(null);
    const overlayRAFRef = useRef(0);
    // id -> layer object
    const overlayLayersRef = useRef(new Map());

    const candles = useMemo(() => normalizeRows(rows), [rows]);

    /* -----------------------------
       Overlay drawing helpers
    ------------------------------ */
    function bumpChartChildrenAboveOverlay(el) {
        // Ensure the chart DOM sits above our overlay canvas
        // (lightweight-charts creates children under el)
        Array.from(el.children || []).forEach((child) => {
            if (child === overlayCanvasRef.current) return;
            if (!child.style) return;
            if (!child.style.position) child.style.position = "relative";
            child.style.zIndex = "1";
        });
    }

    function ensureOverlayCanvas(el) {
        if (!el) return null;

        const pos = getComputedStyle(el).position;
        if (pos === "static" || !pos) el.style.position = "relative";

        if (!overlayCanvasRef.current) {
            const c = document.createElement("canvas");
            c.style.position = "absolute";
            c.style.inset = "0";
            c.style.width = "100%";
            c.style.height = "100%";
            c.style.pointerEvents = "none";
            c.style.zIndex = "0"; // behind chart canvases
            el.insertBefore(c, el.firstChild);
            overlayCanvasRef.current = c;
        }

        bumpChartChildrenAboveOverlay(el);
        return overlayCanvasRef.current;
    }

    function resizeOverlayCanvas() {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));

        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    function scheduleOverlayDraw() {
        if (overlayRAFRef.current) cancelAnimationFrame(overlayRAFRef.current);
        overlayRAFRef.current = requestAnimationFrame(() => {
            overlayRAFRef.current = 0;
            drawOverlay();
        });
    }

    function drawFilledBetween(ctx, chart, layer) {
        const { upperSeries, lowerSeries, points, fill } = layer;
        if (!upperSeries || !lowerSeries || !points?.length) return;

        const ts = chart.timeScale();
        const dpr = window.devicePixelRatio || 1;

        ctx.save();
        ctx.scale(dpr, dpr);

        const upper = [];
        const lower = [];

        for (const p of points) {
            const x = ts.timeToCoordinate(p.time);
            if (x == null) continue;

            const yU = upperSeries.priceToCoordinate(p.upper);
            const yL = lowerSeries.priceToCoordinate(p.lower);
            if (yU == null || yL == null) continue;

            upper.push([x, yU]);
            lower.push([x, yL]);
        }

        if (upper.length < 2 || lower.length < 2) {
            ctx.restore();
            return;
        }

        ctx.beginPath();
        ctx.moveTo(upper[0][0], upper[0][1]);
        for (let i = 1; i < upper.length; i++) ctx.lineTo(upper[i][0], upper[i][1]);
        for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i][0], lower[i][1]);
        ctx.closePath();

        ctx.fillStyle = fill || "rgba(56,189,248,0.12)";
        ctx.fill();

        ctx.restore();
    }

    function drawIchimokuCloud(ctx, chart, layer) {
        const { spanASeries, spanBSeries, points, fillUp, fillDown } = layer;
        if (!spanASeries || !spanBSeries || !points?.length) return;

        const ts = chart.timeScale();
        const dpr = window.devicePixelRatio || 1;

        ctx.save();
        ctx.scale(dpr, dpr);

        let run = [];
        let runIsUp = null;

        const flushRun = () => {
            if (run.length < 2) {
                run = [];
                return;
            }

            const top = [];
            const bot = [];

            for (const p of run) {
                const x = ts.timeToCoordinate(p.time);
                if (x == null) continue;

                const yA = spanASeries.priceToCoordinate(p.a);
                const yB = spanBSeries.priceToCoordinate(p.b);
                if (yA == null || yB == null) continue;

                const yTop = runIsUp ? yA : yB;
                const yBot = runIsUp ? yB : yA;

                top.push([x, yTop]);
                bot.push([x, yBot]);
            }

            if (top.length < 2 || bot.length < 2) {
                run = [];
                return;
            }

            ctx.beginPath();
            ctx.moveTo(top[0][0], top[0][1]);
            for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
            for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
            ctx.closePath();

            ctx.fillStyle = runIsUp
                ? fillUp || "rgba(34,197,94,0.10)"
                : fillDown || "rgba(239,68,68,0.08)";
            ctx.fill();

            run = [];
        };

        for (const p of points) {
            const isUp = p.a >= p.b;

            if (runIsUp == null) {
                runIsUp = isUp;
                run.push(p);
                continue;
            }

            if (isUp !== runIsUp) {
                flushRun();
                runIsUp = isUp;
                run.push(p);
                continue;
            }

            run.push(p);
        }

        flushRun();
        ctx.restore();
    }

    function drawOverlay() {
        const chart = chartRef.current;
        const canvas = overlayCanvasRef.current;
        if (!chart || !canvas) return;

        resizeOverlayCanvas();
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        overlayLayersRef.current.forEach((layer) => {
            if (!layer) return;
            if (layer.kind === "band") drawFilledBetween(ctx, chart, layer);
            if (layer.kind === "cloud") drawIchimokuCloud(ctx, chart, layer);
        });
    }

    /* -----------------------------
       Chart init
    ------------------------------ */
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        // TradingView-ish dark palette
        const BG = "#0B0F19";
        const GRID = "rgba(255,255,255,0.06)";
        const GRID_SOFT = "rgba(255,255,255,0.04)";
        const TEXT = "rgba(255,255,255,0.86)";
        const BORDER = "rgba(255,255,255,0.10)";
        const LABEL_BG = "#1F2937";

        const chart = createChart(el, {
            height: 520,
            autoSize: true,

            layout: {
                background: { type: "solid", color: BG },
                textColor: TEXT,
                fontFamily:
                    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial',
                fontSize: 12,
            },

            grid: {
                vertLines: { color: GRID_SOFT },
                horzLines: { color: GRID },
            },

            rightPriceScale: {
                borderColor: BORDER,
                textColor: TEXT,
                scaleMargins: { top: 0.08, bottom: 0.28 }, // reserve bottom space for osc pane
            },

            timeScale: {
                borderColor: BORDER,
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 8,
                barSpacing: 10,
                fixLeftEdge: true,
                fixRightEdge: true,
                lockVisibleTimeRangeOnResize: true,
            },

            crosshair: {
                mode: 1,
                vertLine: {
                    color: "rgba(255,255,255,0.18)",
                    width: 1,
                    style: 2,
                    labelBackgroundColor: LABEL_BG,
                },
                horzLine: {
                    color: "rgba(255,255,255,0.18)",
                    width: 1,
                    style: 2,
                    labelBackgroundColor: LABEL_BG,
                },
            },
        });

        // Create overlay canvas behind chart canvases
        ensureOverlayCanvas(el);
        scheduleOverlayDraw();

        // Candles
        const candlesSeries = chart.addSeries(CandlestickSeries, {});
        candlesSeries.applyOptions({
            upColor: "#22C55E",
            downColor: "#EF4444",
            borderUpColor: "#22C55E",
            borderDownColor: "#EF4444",
            wickUpColor: "rgba(34,197,94,0.95)",
            wickDownColor: "rgba(239,68,68,0.95)",
            priceLineVisible: true,
            lastValueVisible: true,
        });

        // Volume (translucent histogram at bottom)
        const volSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: "volume" },
            priceScaleId: "", // separate scale
            lastValueVisible: false,
            priceLineVisible: false,
            scaleMargins: { top: 0.80, bottom: 0.02 },
        });
        volSeries.applyOptions({
            color: "rgba(148,163,184,0.35)",
        });
        volumeRef.current = volSeries;

        // v5: create an "osc" price scale by attaching a host series first
        const oscHost = chart.addSeries(LineSeries, {
            priceScaleId: "osc",
            lastValueVisible: false,
            priceLineVisible: false,
            lineWidth: 1,
        });
        oscHost.applyOptions({ color: "rgba(0,0,0,0)" }); // invisible
        oscHostRef.current = oscHost;

        // Now scale exists; apply options safely
        chart.priceScale("osc").applyOptions({
            borderColor: BORDER,
            textColor: TEXT,
            scaleMargins: { top: 0.72, bottom: 0.02 }, // bottom pane effect
        });

        chartRef.current = chart;
        candleRef.current = candlesSeries;

        // Legend updater (custom overlay) — IMPORTANT:
        // show each indicator ONCE (not per line), using the first series as representative.
        const legendEl = legendRef.current;
        const updateLegend = (param) => {
            if (!legendEl) return;

            const parts = [];

            const candleData = param?.seriesData?.get(candlesSeries);
            if (candleData?.close != null) {
                parts.push(
                    `<span style="
            display:inline-flex;align-items:center;gap:6px;
            padding:6px 8px;border-radius:999px;
            border:1px solid rgba(226,232,240,0.12);
            background:rgba(0,0,0,0.25);
          ">
            <span style="width:8px;height:8px;border-radius:999px;background:#E2E8F0;display:inline-block;"></span>
            <span>Price: ${Number(candleData.close).toFixed(2)}</span>
          </span>`
                );
            }

            indSeriesRef.current.forEach((entry, id) => {
                const baseName = String(id).split("_")[0];

                // representative = first series
                const first = entry.seriesList?.[0];
                if (!first) return;

                const sd = param?.seriesData?.get(first.series);
                const v = sd?.value ?? sd?.close ?? "";
                const val = v !== "" && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "";

                parts.push(
                    `<span style="
            display:inline-flex;align-items:center;gap:6px;
            padding:6px 8px;border-radius:999px;
            border:1px solid rgba(226,232,240,0.12);
            background:rgba(0,0,0,0.25);
          ">
            <span style="width:8px;height:8px;border-radius:999px;background:${first.color};display:inline-block;"></span>
            <span>${baseName}${val ? `: ${val}` : ""}</span>
          </span>`
                );
            });

            legendEl.innerHTML = parts.join("");
        };

        chart.subscribeCrosshairMove(updateLegend);

        // Redraw overlay on zoom/scroll
        let unsubRange = null;
        try {
            const ts = chart.timeScale();
            if (ts?.subscribeVisibleTimeRangeChange) {
                const fn = () => scheduleOverlayDraw();
                ts.subscribeVisibleTimeRangeChange(fn);
                unsubRange = () => ts.unsubscribeVisibleTimeRangeChange(fn);
            }
        } catch { }

        // Resize observer
        const ro = new ResizeObserver(() => {
            // keep lightweight-charts happy
            chart.timeScale().fitContent();
            // keep overlay crisp
            scheduleOverlayDraw();
        });
        ro.observe(el);

        return () => {
            ro.disconnect();

            try {
                chart.unsubscribeCrosshairMove(updateLegend);
            } catch { }

            try {
                unsubRange?.();
            } catch { }

            // remove any indicator series
            indSeriesRef.current.forEach((entry) => {
                entry.seriesList.forEach(({ series }) => {
                    try {
                        chart.removeSeries(series);
                    } catch { }
                });
            });
            indSeriesRef.current.clear();

            // overlay cleanup
            overlayLayersRef.current.clear();
            if (overlayRAFRef.current) cancelAnimationFrame(overlayRAFRef.current);
            overlayRAFRef.current = 0;
            try {
                if (overlayCanvasRef.current?.parentNode) {
                    overlayCanvasRef.current.parentNode.removeChild(overlayCanvasRef.current);
                }
            } catch { }
            overlayCanvasRef.current = null;

            // remove osc host
            try {
                if (oscHostRef.current) chart.removeSeries(oscHostRef.current);
            } catch { }
            oscHostRef.current = null;

            // remove volume
            try {
                if (volumeRef.current) chart.removeSeries(volumeRef.current);
            } catch { }
            volumeRef.current = null;

            chart.remove();
            chartRef.current = null;
            candleRef.current = null;
        };
    }, []);

    /* -----------------------------
       Candles + volume updates
    ------------------------------ */
    useEffect(() => {
        if (!candleRef.current) return;

        candleRef.current.setData(candles);

        // Update volume histogram (translucent green/red)
        if (volumeRef.current) {
            const volData = candles
                .filter((c) => Number.isFinite(c.volume))
                .map((c) => ({
                    time: c.time,
                    value: c.volume,
                    color:
                        c.close >= c.open
                            ? "rgba(34,197,94,0.30)" // translucent green
                            : "rgba(239,68,68,0.30)", // translucent red
                }));
            volumeRef.current.setData(volData);
        }

        chartRef.current?.timeScale().fitContent();
        scheduleOverlayDraw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candles]);

    /* -----------------------------
       Indicators: create/update
       + Better rendering:
         - MACD histogram colored by sign
         - RSI/Stoch: guide lines in osc pane
         - BB: filled band between upper/lower
         - Ichimoku: cloud fill between SpanA/SpanB
    ------------------------------ */
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        // Clear all indicator series if no candles
        if (!candles.length) {
            indSeriesRef.current.forEach((entry) => {
                entry.seriesList.forEach(({ series }) => {
                    try {
                        chart.removeSeries(series);
                    } catch { }
                });
            });
            indSeriesRef.current.clear();
            overlayLayersRef.current.clear();
            scheduleOverlayDraw();
            return;
        }

        const desired = (indicators || []).map(normalizeIndicatorConfig);

        // 1) remove series not present anymore
        const keepIds = new Set(desired.map((d) => d.id));
        for (const [id, entry] of indSeriesRef.current.entries()) {
            if (!keepIds.has(id)) {
                entry.seriesList.forEach(({ series }) => {
                    try {
                        chart.removeSeries(series);
                    } catch { }
                });
                indSeriesRef.current.delete(id);

                overlayLayersRef.current.delete(id);
            }
        }

        // 2) add/update desired series
        for (const ind of desired) {
            const def = INDICATOR_REGISTRY[ind.type];
            if (!def) continue;

            // if disabled -> remove series if exists
            if (!ind.enabled) {
                const existing = indSeriesRef.current.get(ind.id);
                if (existing) {
                    existing.seriesList.forEach(({ series }) => {
                        try {
                            chart.removeSeries(series);
                        } catch { }
                    });
                    indSeriesRef.current.delete(ind.id);
                }
                overlayLayersRef.current.delete(ind.id);
                continue;
            }

            const result = computeIndicator(ind.type, candles, ind.params);

            // If cannot compute (e.g., volume missing), remove if exists
            if (result?.error) {
                const existing = indSeriesRef.current.get(ind.id);
                if (existing) {
                    existing.seriesList.forEach(({ series }) => {
                        try {
                            chart.removeSeries(series);
                        } catch { }
                    });
                    indSeriesRef.current.delete(ind.id);
                }
                overlayLayersRef.current.delete(ind.id);
                continue;
            }

            const kind = def.kind; // overlay or osc

            // remove existing series for this id (safe/simple)
            const prev = indSeriesRef.current.get(ind.id);
            if (prev) {
                prev.seriesList.forEach(({ series }) => {
                    try {
                        chart.removeSeries(series);
                    } catch { }
                });
                indSeriesRef.current.delete(ind.id);
            }
            overlayLayersRef.current.delete(ind.id);

            const seriesList = [];

            for (const line of result.lines || []) {
                const renderAs = line.renderAs || "line";

                // For osc, use the custom scale. For overlays, omit scale id (default right scale).
                const seriesOpts =
                    kind === "osc"
                        ? {
                            priceScaleId: "osc",
                            lastValueVisible: false,
                            priceLineVisible: false,
                        }
                        : { lastValueVisible: false, priceLineVisible: false };

                const lineKey = line.key || line.name || "L";
                const color = colorForLine(ind.type, lineKey);

                let s;

                // Better histogram handling (MACD)
                if (renderAs === "hist") {
                    s = chart.addSeries(HistogramSeries, {
                        ...seriesOpts,
                        // default (overridden per bar below if we choose)
                        color: "rgba(148,163,184,0.35)",
                    });

                    const shift = line.shift || 0;

                    const data = [];
                    for (let i = 0; i < candles.length; i++) {
                        const v = line.values?.[i];
                        if (v == null || !Number.isFinite(v)) continue;

                        const j = i + (shift || 0);
                        if (j < 0 || j >= candles.length) continue;

                        data.push({
                            time: candles[j].time,
                            value: v,
                            // MACD histogram: green above 0, red below 0
                            color:
                                String(ind.type || "").toUpperCase() === "MACD"
                                    ? v >= 0
                                        ? "rgba(34,197,94,0.28)"
                                        : "rgba(239,68,68,0.28)"
                                    : "rgba(148,163,184,0.35)",
                        });
                    }
                    s.setData(data);
                } else {
                    const st = styleFor(ind.type, lineKey);
                    s = chart.addSeries(LineSeries, {
                        ...seriesOpts,
                        color,
                        lineWidth: st.lineWidth,
                        lineStyle: st.lineStyle,
                    });

                    const shift = line.shift || 0;
                    const data = toSeriesData(candles, line.values, shift);
                    s.setData(data);
                }

                seriesList.push({ key: lineKey, series: s, color });
            }

            indSeriesRef.current.set(ind.id, { kind, seriesList });

            /* -----------------------------
               Overlay fills: BB band + Ichimoku cloud
            ------------------------------ */
            const typeU = String(ind.type || "").toUpperCase();

            const findLine = (needle) => {
                const n = String(needle || "").toLowerCase();
                return (result.lines || []).find((l) =>
                    String(l.key || l.name || "").toLowerCase().includes(n)
                );
            };

            const findSeriesByLineKey = (needle) => {
                const n = String(needle || "").toLowerCase();
                return seriesList.find(({ key }) => String(key || "").toLowerCase().includes(n))
                    ?.series;
            };

            // Bollinger band fill
            if (typeU === "BB" || typeU === "BOLL" || typeU === "BOLLINGER") {
                const upperLine = findLine("upper") || findLine("up") || findLine("u");
                const lowerLine = findLine("lower") || findLine("low") || findLine("l");

                const upperSeries = findSeriesByLineKey("upper") || findSeriesByLineKey("up");
                const lowerSeries = findSeriesByLineKey("lower") || findSeriesByLineKey("low");

                if (upperLine?.values && lowerLine?.values && upperSeries && lowerSeries) {
                    const pts = [];
                    for (let i = 0; i < candles.length; i++) {
                        const u = upperLine.values[i];
                        const l = lowerLine.values[i];
                        if (u == null || l == null) continue;
                        if (!Number.isFinite(u) || !Number.isFinite(l)) continue;
                        pts.push({ time: candles[i].time, upper: u, lower: l });
                    }

                    overlayLayersRef.current.set(ind.id, {
                        kind: "band",
                        upperSeries,
                        lowerSeries,
                        points: pts,
                        fill: "rgba(56,189,248,0.12)",
                    });
                }
            }

            // Ichimoku cloud fill (Span A vs Span B)
            if (typeU === "ICHIMOKU") {
                const spanALine =
                    findLine("spana") || findLine("span a") || findLine("senkoua") || findLine("lead a");
                const spanBLine =
                    findLine("spanb") || findLine("span b") || findLine("senkoub") || findLine("lead b");

                const spanASeries =
                    findSeriesByLineKey("spana") ||
                    findSeriesByLineKey("span a") ||
                    findSeriesByLineKey("senkoua") ||
                    findSeriesByLineKey("lead a");

                const spanBSeries =
                    findSeriesByLineKey("spanb") ||
                    findSeriesByLineKey("span b") ||
                    findSeriesByLineKey("senkoub") ||
                    findSeriesByLineKey("lead b");

                if (
                    spanALine?.values &&
                    spanBLine?.values &&
                    spanASeries &&
                    spanBSeries
                ) {
                    const pts = [];

                    // Respect shift if provided (common in Ichimoku)
                    const shift = spanALine.shift || 0;

                    for (let i = 0; i < candles.length; i++) {
                        const a = spanALine.values[i];
                        const b = spanBLine.values[i];
                        if (a == null || b == null) continue;
                        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

                        const j = i + (shift || 0);
                        if (j < 0 || j >= candles.length) continue;

                        pts.push({ time: candles[j].time, a, b });
                    }

                    overlayLayersRef.current.set(ind.id, {
                        kind: "cloud",
                        spanASeries,
                        spanBSeries,
                        points: pts,
                        fillUp: "rgba(34,197,94,0.10)",
                        fillDown: "rgba(239,68,68,0.08)",
                    });
                }
            }

            /* -----------------------------
               Oscillator guide lines (RSI/Stoch)
               Drawn as price lines on the first osc series.
            ------------------------------ */
            const t = String(ind.type || "").toUpperCase();
            if (kind === "osc" && seriesList.length) {
                const host = seriesList[0].series;

                // Create guide lines where applicable
                try {
                    if (t === "RSI") {
                        host.createPriceLine({
                            price: 70,
                            color: "rgba(226,232,240,0.18)",
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            axisLabelVisible: false,
                            title: "",
                        });
                        host.createPriceLine({
                            price: 30,
                            color: "rgba(226,232,240,0.18)",
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            axisLabelVisible: false,
                            title: "",
                        });
                        host.createPriceLine({
                            price: 50,
                            color: "rgba(226,232,240,0.10)",
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            axisLabelVisible: false,
                            title: "",
                        });
                    }

                    if (t === "STOCH" || t === "STOCHASTIC") {
                        host.createPriceLine({
                            price: 80,
                            color: "rgba(226,232,240,0.18)",
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            axisLabelVisible: false,
                            title: "",
                        });
                        host.createPriceLine({
                            price: 20,
                            color: "rgba(226,232,240,0.18)",
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            axisLabelVisible: false,
                            title: "",
                        });
                    }
                } catch { }
            }
        }

        scheduleOverlayDraw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candles, indicators]);

    const title = symbol ? `${symbol} (${market}) Chart` : "Chart";

    return (
        <div
            style={{
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.18)",
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

            {/* Chart + Legend overlay */}
            <div style={{ position: "relative" }}>
                <div
                    ref={legendRef}
                    style={{
                        position: "absolute",
                        top: 10,
                        left: 10,
                        zIndex: 20,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        pointerEvents: "none",
                        fontSize: 12,
                        fontWeight: 800,
                        color: "rgba(226,232,240,0.9)",
                    }}
                />
                <div
                    ref={containerRef}
                    style={{
                        width: "100%",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.10)",
                        overflow: "hidden",
                        background: "#0B0F19",
                    }}
                />
            </div>
        </div>
    );
}
