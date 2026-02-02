from fastapi import APIRouter, HTTPException, Query

from .fundamentals import compute_and_cache_fundamentals

router = APIRouter()


@router.get("/fundamentals")
def get_fundamentals(
    market: str = Query(..., description="US or IN"),
    symbol: str = Query(..., description="Ticker (e.g., AAPL, RELIANCE.NS)"),
    refresh: int = Query(0, description="1 to force refresh (bypass cache)"),
):
    try:
        return compute_and_cache_fundamentals(
            market=market,
            symbol=symbol,
            force_refresh=bool(refresh),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
