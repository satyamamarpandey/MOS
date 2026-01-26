export default function TimeRangePills(props) {
    // supports both:
    // - old: { range, setRange }
    // - new: { value, onChange }
    const range = props.range ?? props.value ?? 380;
    const setRange = props.setRange ?? props.onChange ?? (() => { });

    const pills = [
        { label: "1D", days: 2 },
        { label: "5D", days: 8 },
        { label: "1M", days: 35 },
        { label: "6M", days: 200 },
        { label: "1Y", days: 380 },
        { label: "5Y", days: 2000 },
        { label: "MAX", days: 5000 },
    ];

    return (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pills.map((p) => (
                <button
                    key={p.label}
                    type="button"
                    onClick={() => setRange(p.days)}
                    style={{
                        padding: "8px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: p.days === range ? "rgba(251,191,36,0.18)" : "rgba(0,0,0,0.2)",
                        color: "white",
                        cursor: "pointer",
                    }}
                >
                    {p.label}
                </button>
            ))}
        </div>
    );
}
  