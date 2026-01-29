import MarketStockPicker from "./MarketStockPicker";
import TimeRangePills from "./TimeRangePills";
import IndicatorPanel from "./IndicatorPanel";

export default function StockControls({
    market,
    setMarket,
    symbol,
    setSymbol,
    days,
    setDays,
    showIndicators = true,
    showRange = true,
}) {
    const onMarketChange = (m) => {
        setMarket(m);
        setSymbol(""); // reset so picker auto-selects valid symbol
    };

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
                Stock Controls
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
                Pick market → select stock → choose indicators
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <button
                    type="button"
                    onClick={() => onMarketChange("US")}
                    style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background:
                            market === "US" ? "rgba(251,191,36,0.18)" : "rgba(0,0,0,0.2)",
                        color: "white",
                        cursor: "pointer",
                    }}
                >
                    US
                </button>
                <button
                    type="button"
                    onClick={() => onMarketChange("India")}
                    style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background:
                            market === "India"
                                ? "rgba(251,191,36,0.18)"
                                : "rgba(0,0,0,0.2)",
                        color: "white",
                        cursor: "pointer",
                    }}
                >
                    India
                </button>
            </div>

            <MarketStockPicker
                market={market}
                value={symbol}
                onChange={setSymbol}
                limit={10000}
            />

            {showRange ? (
                <>
                    <div style={{ marginTop: 14, marginBottom: 10, fontSize: 12, opacity: 0.8 }}>
                        Range
                    </div>
                    <TimeRangePills range={days} setRange={setDays} />
                </>
            ) : null}

            {showIndicators ? (
                <div style={{ marginTop: 16 }}>
                    <IndicatorPanel />
                </div>
            ) : null}
        </div>
    );
}
