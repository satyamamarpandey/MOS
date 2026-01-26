# backend/app/run_universe_and_refresh.py

import argparse

from .db import Base, engine_us, engine_in, get_session_by_market
from .jobs_universe import load_universe
from .jobs_prices_all import run_backfill, run_daily_refresh


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--market",
        choices=["INDIA", "US", "ALL"],
        default="ALL",
        help="Which market DB to use",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("universe")

    p_backfill = sub.add_parser("backfill")
    p_backfill.add_argument("--years", type=int, default=10)
    p_backfill.add_argument("--limit", type=int, default=None)
    p_backfill.add_argument("--offset", type=int, default=0)

    p_daily = sub.add_parser("daily")
    p_daily.add_argument("--days", type=int, default=7)
    p_daily.add_argument("--limit", type=int, default=None)
    p_daily.add_argument("--offset", type=int, default=0)

    args = parser.parse_args()

    markets = ["INDIA", "US"] if args.market == "ALL" else [args.market]

    if "INDIA" in markets:
        Base.metadata.create_all(bind=engine_in)
    if "US" in markets:
        Base.metadata.create_all(bind=engine_us)

    for m in markets:
        db = get_session_by_market(m)
        try:
            if args.cmd == "universe":
                print(f"[universe] market={m}")
                load_universe(db, market=m)

            elif args.cmd == "backfill":
                print(f"[backfill] market={m} years={args.years} limit={args.limit} offset={args.offset}")
                run_backfill(db, market=m, years=args.years, limit=args.limit, offset=args.offset)

            elif args.cmd == "daily":
                print(f"[daily] market={m} days={args.days} limit={args.limit} offset={args.offset}")
                run_daily_refresh(db, market=m, days=args.days, limit=args.limit, offset=args.offset)

        finally:
            db.close()


if __name__ == "__main__":
    main()
