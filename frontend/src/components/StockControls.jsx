import { useMemo, useState } from "react";
import MarketStockPicker from "./MarketStockPicker";
import IndicatorPanel from "./IndicatorPanel";

export default function StockControls({
    market,
    setMarket,
    symbol,
    setSymbol,
    indicators,
    setIndicators,
}) {
    const [regex, setRegex] = useState(false);
    const [foundCount, setFoundCount] = useState(0);

    const currency = useMemo(() => (market === "India" ? "INR" : "USD"), [market]);

    return (
        <div className="controlsWrap">
            <div className="controlsHeader">
                <div>
                    <div className="title">Stock Controls</div>
                    <div className="subtitle">Pick market → select stock → choose indicators</div>
                </div>
                <div className="pill">{currency}</div>
            </div>

            <div className="segmented">
                <button
                    className={`segBtn ${market === "US" ? "active" : ""}`}
                    onClick={() => setMarket("US")}
                    type="button"
                >
                    US
                </button>
                <button
                    className={`segBtn ${market === "India" ? "active" : ""}`}
                    onClick={() => setMarket("India")}
                    type="button"
                >
                    India
                </button>

                <div className="miniToggle" title="Use regex for search">
                    <input
                        type="checkbox"
                        checked={regex}
                        onChange={(e) => setRegex(e.target.checked)}
                    />
                    Regex
                </div>
            </div>

            {/* ✅ Search + Select fixed */}
            <MarketStockPicker
                market={market}
                symbol={symbol}
                setSymbol={setSymbol}
                regex={regex}
                onFoundCount={setFoundCount}
            />

            {/* small chip: found */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div className="chip">{foundCount} found</div>
            </div>

            <div className="twoCards">
                {/* ✅ Indicators panel with editable periods */}
                <IndicatorPanel indicators={indicators} setIndicators={setIndicators} />

                {/* Fundamentals placeholder (kept same look) */}
                <div className="cardInner">
                    <div className="cardTitleRow">
                        <div>
                            <div className="cardTitle">Fundamental Indicators</div>
                            <div className="cardHint">Powered by fundamentals API (coming soon).</div>
                        </div>
                    </div>

                    <div className="soonList">
                        {[
                            "Revenue Growth (10Y)",
                            "EPS Growth (10Y)",
                            "ROE %",
                            "Debt/Equity",
                            "Free Cash Flow (10Y)",
                            "Operating Margin",
                        ].map((t) => (
                            <div className="soonItem" key={t}>
                                <div className="muted">{t}</div>
                                <div className="soonPill">Soon</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
