import { useEffect, useMemo, useState } from "react";
import StockControls from "../components/StockControls";
import StockChart from "../components/StockChart";
import { api } from "../services/api";

const DEFAULT_SYMBOL_US = "AAPL";
const DEFAULT_SYMBOL_IN = "RELIANCE.NS";

const RANGE_TO_DAYS = {
    "1D": 2,
    "5D": 7,
    "1M": 32,
    "6M": 190,
    "1Y": 380,
    "5Y": 2000,
    "MAX": 8000,
};

function computeMetaFromRows(rows, currency, name) {
    if (!rows || rows.length < 2) {
        return {
            name,
            currency,
            last: rows?.[rows.length - 1]?.close ?? null,
            change: null,
            changePct: null,
            points: rows?.length || 0,
        };
    }
    const last = rows[rows.length - 1].close;
    const prev = rows[rows.length - 2].close;
    const change = last - prev;
    const changePct = prev ? (change / prev) * 100 : null;

    return { name, currency, last, change, changePct, points: rows.length };
}  

export default function StockTerminal() {
    const [market, setMarket] = useState("India");
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL_IN);
    const [range, setRange] = useState("1Y");

    const [indicators, setIndicators] = useState([
        { id: "sma20", type: "SMA", period: 20, enabled: true },
        { id: "sma50", type: "SMA", period: 50, enabled: true },
    ]);

    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    const [meta, setMeta] = useState({
        name: "",
        currency: market === "India" ? "INR" : "USD",
        last: null,
        change: null,
        changePct: null,
        points: null,
        mocked: false,
    });

    const [ohlcv, setOhlcv] = useState([]);

    const days = useMemo(() => RANGE_TO_DAYS[range] ?? 380, [range]);

    useEffect(() => {
        let ignore = false;

        async function load() {
            setErr("");
            setLoading(true);
            try {
                const res = await api.getHistory({ market, symbol, days });
                if (ignore) return;

                const rows = Array.isArray(res?.data) ? res.data : [];
                // slice on client so range buttons visibly change even if backend returns more
                const sliced = rows.slice(-days);
                setOhlcv(sliced);

                const currency = market === "India" ? "INR" : "USD";
                const m = res?.meta || {};
                const computed = computeMetaFromRows(rows, currency, symbol);

                setMeta({ ...computed, mocked: false });

            } catch (e) {
                if (ignore) return;
                setErr(e?.message || "Failed to load chart data.");
                setOhlcv([]);
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        load();
        return () => {
            ignore = true;
        };
    }, [market, symbol, days]);

    return (
        <div className="appShell">
            <div className="bgAurora" />

            <div className="terminalGrid">
                {/* LEFT */}
                <section className="paneCard paneLeft">
                    <StockControls
                        market={market}
                        setMarket={(m) => {
                            setMarket(m);
                            setSymbol(m === "India" ? DEFAULT_SYMBOL_IN : DEFAULT_SYMBOL_US);
                        }}
                        symbol={symbol}
                        setSymbol={setSymbol}
                        indicators={indicators}
                        setIndicators={setIndicators}
                    />
                </section>

                {/* RIGHT */}
                <section className="paneCard paneRight">
                    <StockChart
                        market={market}
                        symbol={symbol}
                        range={range}
                        setRange={setRange}
                        indicators={indicators}
                        meta={meta}
                        data={ohlcv}
                        loading={loading}
                        error={err}
                    />
                </section>
            </div>
        </div>
    );
}
