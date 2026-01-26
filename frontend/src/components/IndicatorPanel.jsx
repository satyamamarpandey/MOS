import { useMemo, useState } from "react";

const INDICATORS = [
    // overlays
    { key: "SMA", kind: "overlay", supported: true },
    { key: "EMA", kind: "overlay", supported: true },
    { key: "WMA", kind: "overlay", supported: true },
    { key: "VWAP", kind: "overlay", supported: true },
    { key: "BB", kind: "overlay", supported: true },
    { key: "Donchian", kind: "overlay", supported: true },
    { key: "Keltner", kind: "overlay", supported: true },

    // oscillators / momentum (UI ready; chart support can come next)
    { key: "RSI", kind: "osc", supported: false },
    { key: "MACD", kind: "osc", supported: false },
    { key: "Stochastic", kind: "osc", supported: false },
    { key: "ATR", kind: "osc", supported: false },
    { key: "ADX", kind: "osc", supported: false },
    { key: "CCI", kind: "osc", supported: false },
    { key: "ROC", kind: "osc", supported: false },
    { key: "MOM", kind: "osc", supported: false },
    { key: "OBV", kind: "osc", supported: false },
    { key: "MFI", kind: "osc", supported: false },
    { key: "WilliamsR", kind: "osc", supported: false },
    { key: "Ichimoku", kind: "overlay", supported: false },
    { key: "PSAR", kind: "overlay", supported: false },
    { key: "Supertrend", kind: "overlay", supported: false },
];

function clampInt(v, fallback = 20) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const x = Math.floor(n);
    if (x <= 0) return fallback;
    return x;
}

export default function IndicatorPanel({ indicators, setIndicators }) {
    const [type, setType] = useState("SMA");
    const [period, setPeriod] = useState("20");

    const byKey = useMemo(() => {
        const m = new Map();
        for (const i of INDICATORS) m.set(i.key, i);
        return m;
    }, []);

    const add = () => {
        const p = clampInt(period, 20);
        const info = byKey.get(type);
        const next = {
            id: `${type}_${p}_${Date.now()}`,
            type,
            period: p,
            enabled: true,
            kind: info?.kind || "overlay",
            supported: !!info?.supported,
        };
        setIndicators((prev) => [next, ...(prev || [])]);
    };

    const toggleEnabled = (id) => {
        setIndicators((prev) =>
            (prev || []).map((x) =>
                x.id === id ? { ...x, enabled: !x.enabled } : x
            )
        );
    };

    const remove = (id) => {
        setIndicators((prev) => (prev || []).filter((x) => x.id !== id));
    };

    const updatePeriod = (id, newP) => {
        const p = clampInt(newP, 20);
        setIndicators((prev) =>
            (prev || []).map((x) => (x.id === id ? { ...x, period: p } : x))
        );
    };

    return (
        <div className="cardInner">
            <div className="cardTitleRow">
                <div>
                    <div className="cardTitle">Technical Indicators</div>
                    <div className="cardHint">Add overlays now; oscillators will be plotted next.</div>
                </div>
            </div>

            <div className="addRow" style={{ marginTop: 10 }}>
                <select
                    className="miniSelect"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                >
                    {INDICATORS.map((i) => (
                        <option key={i.key} value={i.key}>
                            {i.key}
                        </option>
                    ))}
                </select>

                {/* ✅ period is truly editable (SMA 35 works) */}
                <input
                    className="miniInput"
                    type="number"
                    min="1"
                    step="1"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    placeholder="Period"
                />

                <button className="btnPrimary" type="button" onClick={add}>
                    Add
                </button>
            </div>

            <div className="list">
                {(indicators || []).length === 0 && (
                    <div className="emptyNote">No indicators added yet.</div>
                )}

                {(indicators || []).map((ind) => {
                    const info = byKey.get(ind.type);
                    const supported = ind.supported ?? !!info?.supported;

                    return (
                        <div className="listItem" key={ind.id}>
                            <div className="checkRow">
                                <input
                                    type="checkbox"
                                    checked={!!ind.enabled}
                                    onChange={() => toggleEnabled(ind.id)}
                                    disabled={!supported}
                                    title={!supported ? "Indicator plotting coming soon" : "Toggle"}
                                />
                                <div>
                                    {ind.type}{" "}
                                    <span className="muted">({ind.period})</span>{" "}
                                    {!supported && <span className="soonPill">Soon</span>}
                                </div>
                            </div>

                            <div className="inlineControls">
                                {/* ✅ allow editing period inline */}
                                <div className="miniField">
                                    <span className="miniLabel">P</span>
                                    <input
                                        className="miniInput"
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={ind.period}
                                        onChange={(e) => updatePeriod(ind.id, e.target.value)}
                                        disabled={!supported}
                                        style={{ width: 84 }}
                                    />
                                </div>

                                <button
                                    className="iconBtn"
                                    type="button"
                                    onClick={() => remove(ind.id)}
                                    title="Remove"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
