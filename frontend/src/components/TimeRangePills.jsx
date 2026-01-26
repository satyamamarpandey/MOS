const ranges = ["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"];

export default function TimeRangePills({ range, setRange }) {
    return (
        <div className="rangeRow">
            {ranges.map((r) => (
                <button
                    key={r}
                    className={r === range ? "rangeBtn active" : "rangeBtn"}
                    onClick={() => setRange(r)}
                >
                    {r}
                </button>
            ))}
        </div>
    );
}
