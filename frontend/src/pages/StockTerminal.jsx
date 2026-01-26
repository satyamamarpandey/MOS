import { useEffect, useState } from "react";
import { api } from "../services/api";

import StockControls from "../components/StockControls";
import StockChart from "../components/StockChart";

export default function StockTerminal() {
    const [market, setMarket] = useState("US");
    const [symbol, setSymbol] = useState("");
    const [days, setDays] = useState(380);

    const [rows, setRows] = useState([]);
    const [error, setError] = useState("");

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
        <div
            style={{
                padding: 18,
                display: "grid",
                gridTemplateColumns: "420px 1fr",
                gap: 18,
                alignItems: "start",
            }}
        >
            <StockControls
                market={market}
                setMarket={setMarket}
                symbol={symbol}
                setSymbol={setSymbol}
                days={days}
                setDays={setDays}
            />

            <StockChart
                market={market}
                symbol={symbol}
                rows={rows}
                days={days}
                setDays={setDays}
                error={error}
            />
        </div>
    );
}
