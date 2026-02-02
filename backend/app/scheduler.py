import os
from apscheduler.schedulers.background import BackgroundScheduler
from .jobs import refresh_all_watchlist

def start_scheduler():
    # Disable scheduler unless explicitly enabled
    # Set ENABLE_SCHEDULER=1 in env to enable it
    if os.getenv("ENABLE_SCHEDULER", "0") != "1":
        print("[scheduler] disabled (set ENABLE_SCHEDULER=1 to enable)")
        return

    sched = BackgroundScheduler(timezone="America/New_York")
    sched.add_job(refresh_all_watchlist, "cron", hour=2, minute=10)
    sched.start()
    print("[scheduler] started")
