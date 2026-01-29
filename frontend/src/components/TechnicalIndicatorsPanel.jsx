// frontend/src/components/TechnicalIndicatorsPanel.jsx
import IndicatorPanel from "./IndicatorPanel";

export default function TechnicalIndicatorsPanel({ indicators, setIndicators }) {
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
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                Technical Indicators
            </div>

            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
                Overlays + oscillators are supported.
            </div>

            <IndicatorPanel indicators={indicators} setIndicators={setIndicators} />
        </div>
    );
}
