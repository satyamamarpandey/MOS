// frontend/src/pages/StockTerminal.jsx
import { useEffect, useState } from "react";
import { api } from "../services/api";

import StockControls from "../components/StockControls";
import StockChart from "../components/StockChart";
import TechnicalIndicatorsPanel from "../components/TechnicalIndicatorsPanel";
import FundamentalIndicatorsPanel from "../components/FundamentalIndicatorsPanel";

export default function StockTerminal() {
    const [market, setMarket] = useState("US");
    const [symbol, setSymbol] = useState("");
    const [days, setDays] = useState(380);

    const [rows, setRows] = useState([]);
    const [error, setError] = useState("");

    // ✅ NEW: indicator configs live here (single source of truth)
    const [indicators, setIndicators] = useState([]);

    useEffect(() => {
        let cancelled = false;

        async function run() {
            setError("");

            if (!symbol) {
                setRows([]);
                return;
            }

            try {
                const outRows = await api.getHistory({ market, symbol, days });
                if (!cancelled) setRows(Array.isArray(outRows) ? outRows : []);
            } catch (e) {
                if (!cancelled) {
                    setRows([]);
                    setError(e?.message || "Failed to load data");
                }
            }
        }

        run();
        return () => {
            cancelled = true;
        };
    }, [market, symbol, days]);

    return (
        <div className="terminalPage">
            {/* ===== Top full-width: Header + Stock Controls ===== */}
            <div className="topCard">
                <div className="appHeader">
                    <div className="appTitle">Fundsap</div>
                    <div className="appSubtitle">Pick market → select stock → analyze</div>
                </div>

                <StockControls
                    market={market}
                    setMarket={setMarket}
                    symbol={symbol}
                    setSymbol={setSymbol}
                    days={days}
                    setDays={setDays}
                    showIndicators={false}
                    showRange={false}
                />
            </div>

            {/* ===== Bottom: 3-column grid ===== */}
            <div className="bottomGrid">
                {/* Grid 1 (25%) */}
                <div className="gridCol">
                    <TechnicalIndicatorsPanel
                        indicators={indicators}
                        setIndicators={setIndicators}
                    />
                </div>

                {/* Grid 2 (25%) */}
                <div className="gridCol">
                    <FundamentalIndicatorsPanel />
                </div>

                {/* Grid 3 (50%) */}
                <div className="gridCol">
                    <StockChart
                        market={market}
                        symbol={symbol}
                        rows={rows}
                        days={days}
                        setDays={setDays}
                        error={error}
                        // ✅ NEW
                        indicators={indicators}
                    />
                </div>
            </div>
        </div>
    );
}
