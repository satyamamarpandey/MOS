import pandas as pd
from ta.momentum import RSIIndicator, StochasticOscillator
from ta.trend import MACD, SMAIndicator, EMAIndicator, ADXIndicator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import OnBalanceVolumeIndicator


def _sanitize(df: pd.DataFrame) -> pd.DataFrame:
    needed = ["open", "high", "low", "close", "volume"]
    for c in needed:
        if c not in df.columns:
            df[c] = None

    for c in needed:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["close"])

    if "date" in df.columns:
        df = df.sort_values("date")

    return df.reset_index(drop=True)


def add_indicators(df: pd.DataFrame, selected: list[str]) -> pd.DataFrame:
    df = _sanitize(df)

    if len(df) < 50:
        return df

    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    if "rsi" in selected:
        df["rsi"] = RSIIndicator(close, window=14).rsi()

    if "macd" in selected or "signal" in selected:
        macd = MACD(close)
        if "macd" in selected:
            df["macd"] = macd.macd()
        if "signal" in selected:
            df["signal"] = macd.macd_signal()

    if "sma20" in selected:
        df["sma20"] = SMAIndicator(close, window=20).sma_indicator()

    if "sma50" in selected:
        df["sma50"] = SMAIndicator(close, window=50).sma_indicator()

    if "ema20" in selected:
        df["ema20"] = EMAIndicator(close, window=20).ema_indicator()

    if "bb_upper" in selected or "bb_lower" in selected:
        bb = BollingerBands(close, window=20, window_dev=2)
        if "bb_upper" in selected:
            df["bb_upper"] = bb.bollinger_hband()
        if "bb_lower" in selected:
            df["bb_lower"] = bb.bollinger_lband()

    if "atr" in selected:
        df["atr"] = AverageTrueRange(high, low, close, window=14).average_true_range()

    if "adx" in selected:
        df["adx"] = ADXIndicator(high, low, close, window=14).adx()

    if "obv" in selected:
        df["obv"] = OnBalanceVolumeIndicator(close, volume).on_balance_volume()

    if "stoch" in selected:
        st = StochasticOscillator(high, low, close, window=14, smooth_window=3)
        df["stoch"] = st.stoch()

    return df
