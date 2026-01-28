import os
from pathlib import Path

from fastapi import Query
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


# ------------------------------------------------------------
# Paths
# ------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[2]  # .../<repo>/
DATA_DIR = PROJECT_ROOT / "backend" / "data"

US_DB_PATH = DATA_DIR / "stockapp-us.db"
IN_DB_PATH = DATA_DIR / "stockapp-in.db"


def _sqlite_url(db_path: Path) -> str:
    return f"sqlite:///{db_path.as_posix()}"


# Optional overrides
DATABASE_URL_US = os.environ.get("DATABASE_URL_US", _sqlite_url(US_DB_PATH))
DATABASE_URL_IN = os.environ.get("DATABASE_URL_IN", _sqlite_url(IN_DB_PATH))


# ------------------------------------------------------------
# Engines + Sessions
# ------------------------------------------------------------
connect_args_us = {"check_same_thread": False} if DATABASE_URL_US.startswith("sqlite") else {}
connect_args_in = {"check_same_thread": False} if DATABASE_URL_IN.startswith("sqlite") else {}

engine_us = create_engine(DATABASE_URL_US, connect_args=connect_args_us, pool_pre_ping=True)
engine_in = create_engine(DATABASE_URL_IN, connect_args=connect_args_in, pool_pre_ping=True)

SessionUS = sessionmaker(autocommit=False, autoflush=False, bind=engine_us)
SessionIN = sessionmaker(autocommit=False, autoflush=False, bind=engine_in)

# Backward compatibility (old code may import SessionLocal)
SessionLocal = SessionUS

Base = declarative_base()


# ------------------------------------------------------------
# Dependencies
# ------------------------------------------------------------
def get_db():
    """
    Default DB = US (backward compatible)
    """
    db = SessionUS()
    try:
        yield db
    finally:
        db.close()


def get_db_market(market: str = Query(default="US")):
    """
    Market-aware DB selector:
      - "India", "INDIA", "IN" -> India DB
      - everything else -> US DB
    """
    m = (market or "US").strip().lower()
    is_india = m in {"india", "in", "ind", "nse"}

    db = SessionIN() if is_india else SessionUS()
    try:
        yield db
    finally:
        db.close()

def get_session_by_market(market: str):
    """
    CLI/script helper (non-FastAPI):
    Returns a Session() bound to the requested market DB.
    """
    m = (market or "US").strip().upper()

    if m in {"INDIA", "IN", "IND", "NSE"}:
        return SessionIN()

    # default US
    return SessionUS()
