from apscheduler.schedulers.background import BackgroundScheduler
from .jobs import refresh_all_watchlist

def start_scheduler():
    sched = BackgroundScheduler(timezone="America/New_York")
    sched.add_job(refresh_all_watchlist, "cron", hour=2, minute=10)
    sched.start()
