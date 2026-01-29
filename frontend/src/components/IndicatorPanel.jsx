// frontend/src/components/IndicatorPanel.jsx
import { useMemo, useState } from "react";
import {
    INDICATOR_REGISTRY,
    getIndicatorDefaults,
    normalizeIndicatorConfig,
} from "../utils/indicators";

const INDICATOR_KEYS = Object.keys(INDICATOR_REGISTRY);

function prettyLabel(k) {
    return k;
}

export default function IndicatorPanel({
    indicators,
    setIndicators,
    showHeader = true,
}) {
    const [type, setType] = useState(INDICATOR_KEYS[0] || "SMA");

    // ✅ dynamic draft params based on selected indicator
    const [draftParams, setDraftParams] = useState(() => getIndicatorDefaults(type));

    const selectedDef = INDICATOR_REGISTRY[type];

    // when type changes, reset defaults for that indicator (still editable)
    const onTypeChange = (nextType) => {
        setType(nextType);
        setDraftParams(getIndicatorDefaults(nextType));
    };

    const add = () => {
        const base = {
            id: `${type}_${Date.now()}`,
            type,
            enabled: true,
            params: { ...draftParams },
        };
        const normalized = normalizeIndicatorConfig(base);
        setIndicators((prev) => [normalized, ...(prev || [])]);
    };

    const toggleEnabled = (id) => {
        setIndicators((prev) =>
            (prev || []).map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x))
        );
    };

    const remove = (id) => {
        setIndicators((prev) => (prev || []).filter((x) => x.id !== id));
    };

    const updateParam = (id, key, value) => {
        setIndicators((prev) =>
            (prev || []).map((x) => {
                if (x.id !== id) return x;
                const next = {
                    ...x,
                    params: { ...(x.params || {}), [key]: value },
                };
                return normalizeIndicatorConfig(next);
            })
        );
    };

    const updateDraftParam = (key, value) => {
        setDraftParams((p) => ({ ...(p || {}), [key]: value }));
    };

    const normalizedIndicators = useMemo(
        () => (indicators || []).map(normalizeIndicatorConfig),
        [indicators]
    );

    return (
        <div className="cardInner">
            {showHeader && (
                <div className="cardTitleRow">
                    <div>
                        <div className="cardTitle">Technical Indicators</div>
                        <div className="cardHint">
                            Defaults are optimized per indicator (editable).
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ Add row */}
            <div className="addRowOneLine" style={{ marginTop: showHeader ? 10 : 0 }}>
                <select
                    className="miniSelect"
                    value={type}
                    onChange={(e) => onTypeChange(e.target.value)}
                >
                    {INDICATOR_KEYS.map((k) => (
                        <option key={k} value={k}>
                            {prettyLabel(k)}
                        </option>
                    ))}
                </select>

                {/* Dynamic params for selected indicator */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {(selectedDef?.params || []).length === 0 ? (
                        <div style={{ fontSize: 12, opacity: 0.7, padding: "0 8px" }}>
                            No params
                        </div>
                    ) : (
                        (selectedDef?.params || []).map((p) => (
                            <input
                                key={p.key}
                                className="miniInput"
                                type="number"
                                min={p.min ?? undefined}
                                max={p.max ?? undefined}
                                step={p.step ?? 1}
                                value={draftParams?.[p.key] ?? p.default}
                                onChange={(e) => updateDraftParam(p.key, e.target.value)}
                                placeholder={p.label}
                                style={{ width: 92 }}
                            />
                        ))
                    )}
                </div>

                <button className="btnPrimary" type="button" onClick={add}>
                    Add
                </button>
            </div>

            {/* ✅ Added list */}
            <div className="list">
                {(normalizedIndicators || []).length === 0 && (
                    <div className="emptyNote">No indicators added yet.</div>
                )}

                {(normalizedIndicators || []).map((ind) => {
                    const def = INDICATOR_REGISTRY[ind.type];
                    const params = def?.params || [];

                    return (
                        <div className="listItem" key={ind.id}>
                            <div className="checkRow">
                                <input
                                    type="checkbox"
                                    checked={!!ind.enabled}
                                    onChange={() => toggleEnabled(ind.id)}
                                    title="Toggle"
                                />
                                <div>
                                    {ind.type}
                                    {params.length ? (
                                        <span className="muted" style={{ marginLeft: 6 }}>
                                            (
                                            {params
                                                .map((p) => `${p.key}:${ind.params?.[p.key] ?? p.default}`)
                                                .join(", ")}
                                            )
                                        </span>
                                    ) : (
                                        <span className="muted" style={{ marginLeft: 6 }}>
                                            (no params)
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="inlineControls" style={{ gap: 10, flexWrap: "wrap" }}>
                                {params.map((p) => (
                                    <div className="miniField" key={p.key}>
                                        <span className="miniLabel">{p.label}</span>
                                        <input
                                            className="miniInput"
                                            type="number"
                                            min={p.min ?? undefined}
                                            max={p.max ?? undefined}
                                            step={p.step ?? 1}
                                            value={ind.params?.[p.key] ?? p.default}
                                            onChange={(e) => updateParam(ind.id, p.key, e.target.value)}
                                            style={{ width: 92 }}
                                        />
                                    </div>
                                ))}

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
