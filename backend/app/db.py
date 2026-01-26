from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

Base = declarative_base()

# --- DB file paths ---
DB_PATH_IN = DATA_DIR / "stockapp-in.db"
DB_PATH_US = DATA_DIR / "stockapp-us.db"

# --- Engines ---
engine_in = create_engine(
    f"sqlite:///{DB_PATH_IN}",
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

engine_us = create_engine(
    f"sqlite:///{DB_PATH_US}",
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

# --- Sessions ---
SessionLocalIN = sessionmaker(autocommit=False, autoflush=False, bind=engine_in)
SessionLocalUS = sessionmaker(autocommit=False, autoflush=False, bind=engine_us)


def get_session_by_market(market: str):
    """
    market: 'INDIA' or 'US' (case-insensitive)
    """
    m = (market or "INDIA").upper()
    if m == "US":
        return SessionLocalUS()
    return SessionLocalIN()


# FastAPI dependency (defaults to INDIA unless you add separate routes)
def get_db():
    db = SessionLocalIN()
    try:
        yield db
    finally:
        db.close()
