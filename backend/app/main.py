# backend/app/main.py

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router
from .scheduler import start_scheduler
from app.utils.r2_sync import sync_all_latest_dbs

from .fundamentals_routes import router as fundamentals_router
from .watchlist_routes import router as watchlist_router  # ✅ watchlist router

# ✅ OPTIONAL: load backend/.env if python-dotenv exists
try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[1] / ".env"  # backend/.env
    load_dotenv(env_path)
except Exception:
    pass

app = FastAPI(title="Stock Platform (US + India)")


@app.on_event("startup")
def startup():
    project_root = Path(__file__).resolve().parents[2]  # .../<repo>/
    data_dir = project_root / "backend" / "data"

    sync_all_latest_dbs(local_data_dir=str(data_dir))
    start_scheduler()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ mount routers
app.include_router(router, prefix="/api")
app.include_router(fundamentals_router, prefix="/api")
app.include_router(watchlist_router, prefix="/api")  # ✅ THIS WAS MISSING


@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/_routes")
def _routes():
    return [getattr(r, "path", None) for r in app.routes]
