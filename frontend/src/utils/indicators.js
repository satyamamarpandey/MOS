// frontend/src/utils/indicators.js
// Lightweight, dependency-free indicator engine for lightweight-charts (v5).

/**
 * Candle shape expected:
 * { time: "YYYY-MM-DD" | unixSec, open, high, low, close, volume? }
 */

function isNum(x) {
    return Number.isFinite(x);
}

function clamp(v, min, max) {
    if (!isNum(v)) return undefined;
    return Math.max(min, Math.min(max, v));
}

function toInt(v, fallback) {
    const n = Number(v);
    if (!isNum(n)) return fallback;
    const x = Math.floor(n);
    return x > 0 ? x : fallback;
}

function toFloat(v, fallback) {
    const n = Number(v);
    return isNum(n) ? n : fallback;
}

function pickSource(c, source) {
    switch (source) {
        case "open":
            return c.open;
        case "high":
            return c.high;
        case "low":
            return c.low;
        case "hl2":
            return (c.high + c.low) / 2;
        case "hlc3":
            return (c.high + c.low + c.close) / 3;
        case "ohlc4":
            return (c.open + c.high + c.low + c.close) / 4;
        case "close":
        default:
            return c.close;
    }
}

/** SMA on arbitrary value series */
function sma(values, period) {
    const p = toInt(period, 20);
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!isNum(v)) {
            out[i] = null;
            continue;
        }
        sum += v;
        if (i >= p) sum -= values[i - p];
        if (i >= p - 1) out[i] = sum / p;
    }
    return out;
}

/** EMA on arbitrary value series */
function ema(values, period) {
    const p = toInt(period, 20);
    const out = new Array(values.length).fill(null);
    const k = 2 / (p + 1);
    let prev = null;

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!isNum(v)) {
            out[i] = null;
            continue;
        }

        if (prev == null) {
            // seed with SMA when enough points exist
            if (i >= p - 1) {
                const slice = values.slice(i - p + 1, i + 1);
                if (slice.every(isNum)) {
                    prev = slice.reduce((a, b) => a + b, 0) / p;
                    out[i] = prev;
                }
            }
        } else {
            prev = v * k + prev * (1 - k);
            out[i] = prev;
        }
    }
    return out;
}

/** WMA on arbitrary value series */
function wma(values, period) {
    const p = toInt(period, 20);
    const out = new Array(values.length).fill(null);
    const denom = (p * (p + 1)) / 2;

    for (let i = 0; i < values.length; i++) {
        if (i < p - 1) continue;
        let ok = true;
        let num = 0;
        for (let j = 0; j < p; j++) {
            const v = values[i - (p - 1) + j];
            if (!isNum(v)) {
                ok = false;
                break;
            }
            num += v * (j + 1);
        }
        out[i] = ok ? num / denom : null;
    }
    return out;
}

/** True Range */
function trueRange(c, prevClose) {
    const tr1 = c.high - c.low;
    const tr2 = prevClose != null ? Math.abs(c.high - prevClose) : tr1;
    const tr3 = prevClose != null ? Math.abs(c.low - prevClose) : tr1;
    return Math.max(tr1, tr2, tr3);
}

/** ATR (Wilder's smoothing) */
function atr(candles, period = 14) {
    const p = toInt(period, 14);
    const out = new Array(candles.length).fill(null);

    let prevClose = null;
    const trs = candles.map((c) => {
        const tr = trueRange(c, prevClose);
        prevClose = c.close;
        return tr;
    });

    // seed with SMA of TR
    let seed = null;
    for (let i = 0; i < trs.length; i++) {
        if (i >= p - 1) {
            const slice = trs.slice(i - p + 1, i + 1);
            seed = slice.reduce((a, b) => a + b, 0) / p;
            out[i] = seed;
            // Wilder smoothing thereafter
            for (let j = i + 1; j < trs.length; j++) {
                seed = (seed * (p - 1) + trs[j]) / p;
                out[j] = seed;
            }
            break;
        }
    }
    return out;
}

/** RSI (Wilder) */
function rsi(candles, period = 14, source = "close") {
    const p = toInt(period, 14);
    const out = new Array(candles.length).fill(null);

    const vals = candles.map((c) => pickSource(c, source));
    let gain = 0;
    let loss = 0;

    for (let i = 1; i < vals.length; i++) {
        const diff = vals[i] - vals[i - 1];
        const g = diff > 0 ? diff : 0;
        const l = diff < 0 ? -diff : 0;

        if (i <= p) {
            gain += g;
            loss += l;
            if (i === p) {
                gain /= p;
                loss /= p;
                const rs = loss === 0 ? Infinity : gain / loss;
                out[i] = 100 - 100 / (1 + rs);
            }
        } else {
            gain = (gain * (p - 1) + g) / p;
            loss = (loss * (p - 1) + l) / p;
            const rs = loss === 0 ? Infinity : gain / loss;
            out[i] = 100 - 100 / (1 + rs);
        }
    }
    return out;
}

/** MACD */
function macd(candles, fast = 12, slow = 26, signal = 9, source = "close") {
    const vals = candles.map((c) => pickSource(c, source));
    const fastE = ema(vals, fast);
    const slowE = ema(vals, slow);

    const macdLine = vals.map((_, i) =>
        isNum(fastE[i]) && isNum(slowE[i]) ? fastE[i] - slowE[i] : null
    );
    const signalLine = ema(macdLine.map((x) => (x == null ? NaN : x)), signal);
    const hist = macdLine.map((m, i) =>
        isNum(m) && isNum(signalLine[i]) ? m - signalLine[i] : null
    );

    return { macdLine, signalLine, hist };
}

/** Stochastic */
function stochastic(candles, kPeriod = 14, dPeriod = 3, smooth = 3) {
    const kP = toInt(kPeriod, 14);
    const dP = toInt(dPeriod, 3);
    const sm = toInt(smooth, 3);

    const rawK = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
        if (i < kP - 1) continue;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - kP + 1; j <= i; j++) {
            hh = Math.max(hh, candles[j].high);
            ll = Math.min(ll, candles[j].low);
        }
        const denom = hh - ll;
        rawK[i] = denom === 0 ? 0 : ((candles[i].close - ll) / denom) * 100;
    }

    const smoothK = sma(rawK.map((x) => (x == null ? NaN : x)), sm);
    const d = sma(smoothK.map((x) => (x == null ? NaN : x)), dP);

    return { k: smoothK, d };
}

/** Donchian Channels */
function donchian(candles, period = 20) {
    const p = toInt(period, 20);
    const upper = new Array(candles.length).fill(null);
    const lower = new Array(candles.length).fill(null);
    const mid = new Array(candles.length).fill(null);

    for (let i = 0; i < candles.length; i++) {
        if (i < p - 1) continue;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - p + 1; j <= i; j++) {
            hh = Math.max(hh, candles[j].high);
            ll = Math.min(ll, candles[j].low);
        }
        upper[i] = hh;
        lower[i] = ll;
        mid[i] = (hh + ll) / 2;
    }
    return { upper, lower, mid };
}

/** Bollinger Bands */
function bollinger(candles, length = 20, mult = 2, source = "close") {
    const len = toInt(length, 20);
    const m = toFloat(mult, 2);

    const vals = candles.map((c) => pickSource(c, source));
    const basis = sma(vals, len);
    const upper = new Array(candles.length).fill(null);
    const lower = new Array(candles.length).fill(null);

    for (let i = 0; i < candles.length; i++) {
        if (i < len - 1) continue;
        const slice = vals.slice(i - len + 1, i + 1);
        if (!slice.every(isNum)) continue;
        const mean = basis[i];
        const variance =
            slice.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / len;
        const sd = Math.sqrt(variance);
        upper[i] = mean + m * sd;
        lower[i] = mean - m * sd;
    }
    return { basis, upper, lower };
}

/** Keltner Channels: EMA(hlc3) +/- mult * ATR */
function keltner(candles, length = 20, mult = 2) {
    const len = toInt(length, 20);
    const m = toFloat(mult, 2);

    const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
    const mid = ema(tp, len);
    const a = atr(candles, len);

    const upper = mid.map((x, i) => (isNum(x) && isNum(a[i]) ? x + m * a[i] : null));
    const lower = mid.map((x, i) => (isNum(x) && isNum(a[i]) ? x - m * a[i] : null));
    return { mid, upper, lower };
}

/** ROC */
function roc(candles, period = 12, source = "close") {
    const p = toInt(period, 12);
    const vals = candles.map((c) => pickSource(c, source));
    const out = new Array(candles.length).fill(null);
    for (let i = 0; i < vals.length; i++) {
        if (i < p) continue;
        const prev = vals[i - p];
        const cur = vals[i];
        if (!isNum(prev) || !isNum(cur) || prev === 0) continue;
        out[i] = ((cur - prev) / prev) * 100;
    }
    return out;
}

/** Momentum (MOM) */
function mom(candles, period = 10, source = "close") {
    const p = toInt(period, 10);
    const vals = candles.map((c) => pickSource(c, source));
    const out = new Array(candles.length).fill(null);
    for (let i = 0; i < vals.length; i++) {
        if (i < p) continue;
        const prev = vals[i - p];
        const cur = vals[i];
        if (!isNum(prev) || !isNum(cur)) continue;
        out[i] = cur - prev;
    }
    return out;
}

/** OBV (needs volume) */
function obv(candles) {
    const out = new Array(candles.length).fill(null);
    let acc = 0;
    for (let i = 0; i < candles.length; i++) {
        const v = candles[i]?.volume;
        if (!isNum(v)) return null; // cannot compute
        if (i === 0) {
            out[i] = 0;
            continue;
        }
        if (candles[i].close > candles[i - 1].close) acc += v;
        else if (candles[i].close < candles[i - 1].close) acc -= v;
        out[i] = acc;
    }
    return out;
}

/** MFI (needs volume) */
function mfi(candles, period = 14) {
    const p = toInt(period, 14);
    // typical price
    const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
    const mf = candles.map((c, i) => {
        const v = c.volume;
        if (!isNum(v)) return null;
        return tp[i] * v;
    });
    if (mf.some((x) => x == null)) return null;

    const out = new Array(candles.length).fill(null);
    for (let i = 1; i < candles.length; i++) {
        if (i < p) continue;
        let pos = 0;
        let neg = 0;
        for (let j = i - p + 1; j <= i; j++) {
            if (tp[j] > tp[j - 1]) pos += mf[j];
            else if (tp[j] < tp[j - 1]) neg += mf[j];
        }
        const mr = neg === 0 ? Infinity : pos / neg;
        out[i] = 100 - 100 / (1 + mr);
    }
    return out;
}

/** Williams %R */
function williamsR(candles, period = 14) {
    const p = toInt(period, 14);
    const out = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
        if (i < p - 1) continue;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - p + 1; j <= i; j++) {
            hh = Math.max(hh, candles[j].high);
            ll = Math.min(ll, candles[j].low);
        }
        const denom = hh - ll;
        out[i] = denom === 0 ? 0 : ((hh - candles[i].close) / denom) * -100;
    }
    return out;
}

/** ADX (Wilder) */
function adx(candles, period = 14) {
    const p = toInt(period, 14);
    const out = new Array(candles.length).fill(null);

    const trArr = new Array(candles.length).fill(null);
    const plusDM = new Array(candles.length).fill(null);
    const minusDM = new Array(candles.length).fill(null);

    for (let i = 1; i < candles.length; i++) {
        const upMove = candles[i].high - candles[i - 1].high;
        const downMove = candles[i - 1].low - candles[i].low;

        plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

        trArr[i] = trueRange(candles[i], candles[i - 1].close);
    }

    // Wilder smoothing
    function wildersSmooth(arr) {
        const sm = new Array(arr.length).fill(null);
        let sum = 0;
        for (let i = 1; i < arr.length; i++) {
            if (i <= p) {
                sum += arr[i] ?? 0;
                if (i === p) {
                    sm[i] = sum;
                    for (let j = i + 1; j < arr.length; j++) {
                        sm[j] = (sm[j - 1] * (p - 1) + (arr[j] ?? 0)) / p;
                    }
                    break;
                }
            }
        }
        return sm;
    }

    const smTR = wildersSmooth(trArr);
    const smPlus = wildersSmooth(plusDM);
    const smMinus = wildersSmooth(minusDM);

    const dx = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
        if (!isNum(smTR[i]) || smTR[i] === 0) continue;
        const pdi = (100 * (smPlus[i] ?? 0)) / smTR[i];
        const mdi = (100 * (smMinus[i] ?? 0)) / smTR[i];
        const denom = pdi + mdi;
        dx[i] = denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
    }

    const adxArr = wildersSmooth(dx.map((x) => (x == null ? 0 : x)));
    for (let i = 0; i < candles.length; i++) {
        out[i] = adxArr[i];
    }
    return out;
}

/** CCI */
function cci(candles, period = 20) {
    const p = toInt(period, 20);
    const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
    const smaTp = sma(tp, p);
    const out = new Array(candles.length).fill(null);

    for (let i = 0; i < candles.length; i++) {
        if (i < p - 1) continue;
        const slice = tp.slice(i - p + 1, i + 1);
        const mean = smaTp[i];
        if (!isNum(mean)) continue;
        const md = slice.reduce((acc, v) => acc + Math.abs(v - mean), 0) / p;
        if (md === 0) continue;
        out[i] = (tp[i] - mean) / (0.015 * md);
    }
    return out;
}

/** VWAP (needs volume) - rolling cumulative */
function vwap(candles, source = "hlc3") {
    let cumPV = 0;
    let cumV = 0;
    const out = new Array(candles.length).fill(null);

    for (let i = 0; i < candles.length; i++) {
        const v = candles[i]?.volume;
        if (!isNum(v)) return null;
        const price = pickSource(candles[i], source);
        cumPV += price * v;
        cumV += v;
        out[i] = cumV === 0 ? null : cumPV / cumV;
    }
    return out;
}

/** PSAR (simplified standard) */
function psar(candles, step = 0.02, maxStep = 0.2) {
    const afStep = clamp(Number(step), 0.001, 1) ?? 0.02;
    const afMax = clamp(Number(maxStep), afStep, 1) ?? 0.2;

    const out = new Array(candles.length).fill(null);
    if (candles.length < 2) return out;

    let isUp = candles[1].close >= candles[0].close;
    let af = afStep;
    let ep = isUp ? candles[0].high : candles[0].low;
    let sar = isUp ? candles[0].low : candles[0].high;

    out[0] = null;

    for (let i = 1; i < candles.length; i++) {
        sar = sar + af * (ep - sar);

        // clamp SAR to prior 2 lows/highs
        if (isUp) {
            const low1 = candles[i - 1].low;
            const low2 = i >= 2 ? candles[i - 2].low : low1;
            sar = Math.min(sar, low1, low2);
        } else {
            const high1 = candles[i - 1].high;
            const high2 = i >= 2 ? candles[i - 2].high : high1;
            sar = Math.max(sar, high1, high2);
        }

        // reversal?
        if (isUp) {
            if (candles[i].low < sar) {
                isUp = false;
                sar = ep;
                ep = candles[i].low;
                af = afStep;
            } else {
                if (candles[i].high > ep) {
                    ep = candles[i].high;
                    af = Math.min(af + afStep, afMax);
                }
            }
        } else {
            if (candles[i].high > sar) {
                isUp = true;
                sar = ep;
                ep = candles[i].high;
                af = afStep;
            } else {
                if (candles[i].low < ep) {
                    ep = candles[i].low;
                    af = Math.min(af + afStep, afMax);
                }
            }
        }

        out[i] = sar;
    }

    return out;
}

/** Supertrend */
function supertrend(candles, atrPeriod = 10, mult = 3) {
    const p = toInt(atrPeriod, 10);
    const m = toFloat(mult, 3);
    const a = atr(candles, p);

    const hl2 = candles.map((c) => (c.high + c.low) / 2);
    const upperBasic = hl2.map((x, i) => (isNum(x) && isNum(a[i]) ? x + m * a[i] : null));
    const lowerBasic = hl2.map((x, i) => (isNum(x) && isNum(a[i]) ? x - m * a[i] : null));

    const upper = new Array(candles.length).fill(null);
    const lower = new Array(candles.length).fill(null);
    const st = new Array(candles.length).fill(null);
    const dir = new Array(candles.length).fill(null);

    for (let i = 0; i < candles.length; i++) {
        if (upperBasic[i] == null || lowerBasic[i] == null) continue;

        if (i === 0) {
            upper[i] = upperBasic[i];
            lower[i] = lowerBasic[i];
            st[i] = null;
            dir[i] = null;
            continue;
        }

        // final bands
        upper[i] =
            upperBasic[i] < upper[i - 1] || candles[i - 1].close > upper[i - 1]
                ? upperBasic[i]
                : upper[i - 1];

        lower[i] =
            lowerBasic[i] > lower[i - 1] || candles[i - 1].close < lower[i - 1]
                ? lowerBasic[i]
                : lower[i - 1];

        // direction
        if (st[i - 1] == null) {
            dir[i] = candles[i].close >= upper[i] ? 1 : candles[i].close <= lower[i] ? -1 : 1;
        } else if (st[i - 1] === upper[i - 1]) {
            dir[i] = candles[i].close > upper[i] ? 1 : -1;
        } else {
            dir[i] = candles[i].close < lower[i] ? -1 : 1;
        }

        st[i] = dir[i] === 1 ? lower[i] : upper[i];
    }

    return { supertrend: st, direction: dir, upper, lower };
}

/** Ichimoku (standard 9,26,52) */
function ichimoku(candles, conv = 9, base = 26, spanB = 52) {
    const cP = toInt(conv, 9);
    const bP = toInt(base, 26);
    const sP = toInt(spanB, 52);

    function midHighLow(i, p) {
        if (i < p - 1) return null;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - p + 1; j <= i; j++) {
            hh = Math.max(hh, candles[j].high);
            ll = Math.min(ll, candles[j].low);
        }
        return (hh + ll) / 2;
    }

    const conversion = candles.map((_, i) => midHighLow(i, cP));
    const baseline = candles.map((_, i) => midHighLow(i, bP));
    const spanA = candles.map((_, i) =>
        isNum(conversion[i]) && isNum(baseline[i]) ? (conversion[i] + baseline[i]) / 2 : null
    );
    const spanBLine = candles.map((_, i) => midHighLow(i, sP));

    // shift span A/B forward by base period (26 typically)
    // We'll keep same length by placing future values on future time labels (best-effort).
    return { conversion, baseline, spanA, spanB: spanBLine, displacement: bP };
}

/** Registry: defaults + param schemas + compute functions */
export const INDICATOR_REGISTRY = {
    SMA: {
        kind: "overlay",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 20 }],
        compute: (candles, p) => {
            const vals = candles.map((c) => c.close);
            return { lines: [{ key: "SMA", values: sma(vals, p.period) }] };
        },
    },
    EMA: {
        kind: "overlay",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 20 }],
        compute: (candles, p) => {
            const vals = candles.map((c) => c.close);
            return { lines: [{ key: "EMA", values: ema(vals, p.period) }] };
        },
    },
    WMA: {
        kind: "overlay",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 20 }],
        compute: (candles, p) => {
            const vals = candles.map((c) => c.close);
            return { lines: [{ key: "WMA", values: wma(vals, p.period) }] };
        },
    },
    VWAP: {
        kind: "overlay",
        params: [], // cumulative VWAP (needs volume)
        compute: (candles) => {
            const v = vwap(candles, "hlc3");
            if (!v) return { error: "VWAP needs volume (not present in data)" };
            return { lines: [{ key: "VWAP", values: v }] };
        },
    },
    BB: {
        kind: "overlay",
        params: [
            { key: "length", label: "Length", type: "int", min: 1, step: 1, default: 20 },
            { key: "mult", label: "StdDev", type: "float", min: 0.1, step: 0.1, default: 2 },
        ],
        compute: (candles, p) => {
            const bb = bollinger(candles, p.length, p.mult, "close");
            return {
                lines: [
                    { key: "BB_basis", values: bb.basis },
                    { key: "BB_upper", values: bb.upper },
                    { key: "BB_lower", values: bb.lower },
                ],
            };
        },
    },
    Donchian: {
        kind: "overlay",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 20 }],
        compute: (candles, p) => {
            const d = donchian(candles, p.period);
            return {
                lines: [
                    { key: "Donch_upper", values: d.upper },
                    { key: "Donch_mid", values: d.mid },
                    { key: "Donch_lower", values: d.lower },
                ],
            };
        },
    },
    Keltner: {
        kind: "overlay",
        params: [
            { key: "length", label: "Length", type: "int", min: 1, step: 1, default: 20 },
            { key: "mult", label: "ATR Mult", type: "float", min: 0.1, step: 0.1, default: 2 },
        ],
        compute: (candles, p) => {
            const k = keltner(candles, p.length, p.mult);
            return {
                lines: [
                    { key: "KC_mid", values: k.mid },
                    { key: "KC_upper", values: k.upper },
                    { key: "KC_lower", values: k.lower },
                ],
            };
        },
    },

    // Oscillators (rendered in lower section via separate priceScale)
    RSI: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 14 }],
        compute: (candles, p) => ({ lines: [{ key: "RSI", values: rsi(candles, p.period) }] }),
        oscBounds: { min: 0, max: 100 },
    },
    MACD: {
        kind: "osc",
        params: [
            { key: "fast", label: "Fast", type: "int", min: 1, step: 1, default: 12 },
            { key: "slow", label: "Slow", type: "int", min: 1, step: 1, default: 26 },
            { key: "signal", label: "Signal", type: "int", min: 1, step: 1, default: 9 },
        ],
        compute: (candles, p) => {
            const m = macd(candles, p.fast, p.slow, p.signal);
            return {
                lines: [
                    { key: "MACD", values: m.macdLine },
                    { key: "MACD_signal", values: m.signalLine },
                    { key: "MACD_hist", values: m.hist, renderAs: "hist" },
                ],
            };
        },
    },
    Stochastic: {
        kind: "osc",
        params: [
            { key: "k", label: "%K", type: "int", min: 1, step: 1, default: 14 },
            { key: "d", label: "%D", type: "int", min: 1, step: 1, default: 3 },
            { key: "smooth", label: "Smooth", type: "int", min: 1, step: 1, default: 3 },
        ],
        compute: (candles, p) => {
            const s = stochastic(candles, p.k, p.d, p.smooth);
            return { lines: [{ key: "Stoch_K", values: s.k }, { key: "Stoch_D", values: s.d }] };
        },
        oscBounds: { min: 0, max: 100 },
    },
    ATR: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 14 }],
        compute: (candles, p) => ({ lines: [{ key: "ATR", values: atr(candles, p.period) }] }),
    },
    ADX: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 14 }],
        compute: (candles, p) => ({ lines: [{ key: "ADX", values: adx(candles, p.period) }] }),
        oscBounds: { min: 0, max: 100 },
    },
    CCI: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 20 }],
        compute: (candles, p) => ({ lines: [{ key: "CCI", values: cci(candles, p.period) }] }),
    },
    ROC: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 12 }],
        compute: (candles, p) => ({ lines: [{ key: "ROC", values: roc(candles, p.period) }] }),
    },
    MOM: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 10 }],
        compute: (candles, p) => ({ lines: [{ key: "MOM", values: mom(candles, p.period) }] }),
    },
    OBV: {
        kind: "osc",
        params: [],
        compute: (candles) => {
            const o = obv(candles);
            if (!o) return { error: "OBV needs volume (not present in data)" };
            return { lines: [{ key: "OBV", values: o }] };
        },
    },
    MFI: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 14 }],
        compute: (candles, p) => {
            const m = mfi(candles, p.period);
            if (!m) return { error: "MFI needs volume (not present in data)" };
            return { lines: [{ key: "MFI", values: m }] };
        },
        oscBounds: { min: 0, max: 100 },
    },
    WilliamsR: {
        kind: "osc",
        params: [{ key: "period", label: "Period", type: "int", min: 1, step: 1, default: 14 }],
        compute: (candles, p) => ({ lines: [{ key: "WilliamsR", values: williamsR(candles, p.period) }] }),
        oscBounds: { min: -100, max: 0 },
    },

    Ichimoku: {
        kind: "overlay",
        params: [
            { key: "conv", label: "Conv", type: "int", min: 1, step: 1, default: 9 },
            { key: "base", label: "Base", type: "int", min: 1, step: 1, default: 26 },
            { key: "spanB", label: "SpanB", type: "int", min: 1, step: 1, default: 52 },
        ],
        compute: (candles, p) => {
            const i = ichimoku(candles, p.conv, p.base, p.spanB);
            // We plot conversion + baseline; spans are shifted forward by displacement.
            return {
                lines: [
                    { key: "Ichi_conv", values: i.conversion },
                    { key: "Ichi_base", values: i.baseline },
                    { key: "Ichi_spanA", values: i.spanA, shift: i.displacement },
                    { key: "Ichi_spanB", values: i.spanB, shift: i.displacement },
                ],
            };
        },
    },

    PSAR: {
        kind: "overlay",
        params: [
            { key: "step", label: "Step", type: "float", min: 0.001, step: 0.001, default: 0.02 },
            { key: "max", label: "Max", type: "float", min: 0.01, step: 0.01, default: 0.2 },
        ],
        compute: (candles, p) => ({
            lines: [{ key: "PSAR", values: psar(candles, p.step, p.max) }],
        }),
    },

    Supertrend: {
        kind: "overlay",
        params: [
            { key: "atr", label: "ATR", type: "int", min: 1, step: 1, default: 10 },
            { key: "mult", label: "Mult", type: "float", min: 0.1, step: 0.1, default: 3 },
        ],
        compute: (candles, p) => {
            const s = supertrend(candles, p.atr, p.mult);
            return { lines: [{ key: "Supertrend", values: s.supertrend }] };
        },
    },
};

export function getIndicatorDefaults(type) {
    const def = INDICATOR_REGISTRY[type];
    const params = def?.params || [];
    const out = {};
    for (const p of params) out[p.key] = p.default;
    return out;
}

export function normalizeIndicatorConfig(raw) {
    const def = INDICATOR_REGISTRY[raw.type];
    if (!def) return raw;

    const params = def.params || [];
    const nextParams = { ...(raw.params || {}) };

    for (const p of params) {
        if (nextParams[p.key] == null) nextParams[p.key] = p.default;

        if (p.type === "int") nextParams[p.key] = toInt(nextParams[p.key], p.default);
        if (p.type === "float") nextParams[p.key] = toFloat(nextParams[p.key], p.default);

        if (p.min != null) nextParams[p.key] = Math.max(p.min, nextParams[p.key]);
        if (p.max != null) nextParams[p.key] = Math.min(p.max, nextParams[p.key]);
    }

    return { ...raw, kind: def.kind, params: nextParams };
}

export function computeIndicator(type, candles, params) {
    const def = INDICATOR_REGISTRY[type];
    if (!def) return { error: "Unknown indicator" };
    return def.compute(candles, params || {});
}
