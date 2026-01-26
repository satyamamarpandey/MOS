from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import router
from .scheduler import start_scheduler

app = FastAPI(title="Stock Platform (US + India)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

@app.on_event("startup")
def boot():
    start_scheduler()

@app.get("/health")
def health():
    return {"ok": True}
