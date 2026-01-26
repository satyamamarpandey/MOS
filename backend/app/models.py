from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    UniqueConstraint,
    Index,
    func,
)
from .db import Base


class Symbol(Base):
    __tablename__ = "symbols"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True, nullable=False)  # e.g., AAPL, RELIANCE.NS
    name = Column(String, nullable=True)

    market = Column(String, nullable=False)  # "US" or "INDIA"
    exchange = Column(String, nullable=True)  # NASDAQ/NYSE/AMEX/NSE
    currency = Column(String, nullable=True)  # USD/INR

    is_active = Column(Boolean, default=True, nullable=False)

    source = Column(String, nullable=True)  # nasdaqtrader / nse / manual
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DailyBar(Base):
    __tablename__ = "daily_bars"

    id = Column(Integer, primary_key=True, index=True)

    symbol = Column(String, index=True, nullable=False)
    date = Column(Date, index=True, nullable=False)

    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    adj_close = Column(Float, nullable=True)
    volume = Column(BigInteger, nullable=True)

    source = Column(String, nullable=True)  # yfinance, etc.
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uq_daily_bars_symbol_date"),
        Index("ix_daily_bars_symbol_date", "symbol", "date"),
    )


# -------------------------------------------------------------------
# Backward-compatible aliases (your routes/services expect these names)
# -------------------------------------------------------------------
Stock = Symbol
PriceDaily = DailyBar
