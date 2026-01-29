export default function FundamentalIndicatorsPanel() {
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
                Fundamental Indicators
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
                (Coming next) Valuation, growth, margins, debt, cash flow, dividend, etc.
            </div>

            <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.4 }}>
                Placeholder panel. We’ll wire real fundamentals after the UI layout is locked.
            </div>
        </div>
    );
}
  