from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router
from .scheduler import start_scheduler
from app.utils.r2_sync import sync_all_latest_dbs

app = FastAPI(title="Stock Platform (US + India)")


@app.on_event("startup")
def startup():
    # Robust: always point to backend/data regardless of where command is run from
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

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"ok": True}
