## Database schema

### India DB
**Path:** `backend/data/stockapp-in.db`  
**Tables:** `daily_bars`, `price_daily`, `stocks`, `symbols`

#### `daily_bars` (India)
- `id` (INTEGER, PK)
- `symbol` (VARCHAR, NOT NULL)
- `date` (DATE, NOT NULL)
- `open` (FLOAT, nullable)
- `high` (FLOAT, nullable)
- `low` (FLOAT, nullable)
- `close` (FLOAT, nullable)
- `adj_close` (FLOAT, nullable)
- `volume` (BIGINT, nullable)
- `source` (VARCHAR, nullable)
- `created_at` (DATETIME, NOT NULL, default `CURRENT_TIMESTAMP`)
- `updated_at` (DATETIME, NOT NULL, default `CURRENT_TIMESTAMP`)
- **Unique constraint:** `(symbol, date)`

---

### US DB
**Path:** `backend/data/stockapp-us.db`  
**Tables:** `daily_bars`, `symbols`

#### `daily_bars` (US)
- `id` (INTEGER, PK)
- `symbol` (VARCHAR, NOT NULL)
- `date` (DATE, NOT NULL)
- `open` (FLOAT, nullable)
- `high` (FLOAT, nullable)
- `low` (FLOAT, nullable)
- `close` (FLOAT, nullable)
- `adj_close` (FLOAT, nullable)
- `volume` (BIGINT, nullable)
- `source` (VARCHAR, nullable)
- `created_at` (DATETIME, NOT NULL, default `CURRENT_TIMESTAMP`)
- `updated_at` (DATETIME, NOT NULL, default `CURRENT_TIMESTAMP`)
- **Unique constraint:** `(symbol, date)`

---

### Notes
- Some older historical rows may have `NULL` OHLC values (placeholder rows for symbols with no data on those dates).  
  When querying candles for charts/indicators, filter using:
  `open IS NOT NULL AND high IS NOT NULL AND low IS NOT NULL AND close IS NOT NULL`
- Recommended index (added):
  `CREATE INDEX IF NOT EXISTS idx_daily_bars_symbol_date ON daily_bars(symbol, date);`
