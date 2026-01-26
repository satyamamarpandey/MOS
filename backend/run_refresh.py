import os, sqlite3, traceback, subprocess, sys

DBS = [
    (r".\data\stockapp-in.db", "IN"),
    (r".\data\stockapp-us.db", "US"),
]

# TODO: replace these with YOUR actual refresh commands/scripts
# Examples:
# IN_REFRESH_CMD = [sys.executable, r".\scripts\refresh_in.py"]
# US_REFRESH_CMD = [sys.executable, r".\scripts\refresh_us.py"]
IN_REFRESH_CMD = None
US_REFRESH_CMD = None

def log_run(db_path, status, message):
    p = os.path.abspath(db_path)
    con = sqlite3.connect(p)
    cur = con.cursor()
    mx = cur.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    cnt = cur.execute("SELECT COUNT(*) FROM daily_bars WHERE date=? AND close IS NOT NULL", (mx,)).fetchone()[0]
    con.execute(
        "INSERT INTO refresh_runs(status,message,max_date,rows_on_max_date) VALUES (?,?,?,?)",
        (status, message, mx, cnt),
    )
    con.commit()
    con.close()

def run_cmd(cmd):
    if not cmd:
        return 0, "No refresh command configured"
    p = subprocess.run(cmd, capture_output=True, text=True)
    out = (p.stdout or "") + ("\n" + p.stderr if p.stderr else "")
    return p.returncode, out.strip()[:2000]

if __name__ == "__main__":
    for db, label in DBS:
        try:
            cmd = IN_REFRESH_CMD if label == "IN" else US_REFRESH_CMD
            code, out = run_cmd(cmd)
            if code == 0:
                log_run(db, "success", f"{label} refresh ok. {out}")
                print(f"✅ {label} refresh logged")
            else:
                log_run(db, "fail", f"{label} refresh failed (code {code}). {out}")
                print(f"❌ {label} refresh failed/logged")
        except Exception:
            msg = traceback.format_exc()[:2000]
            log_run(db, "fail", f"{label} exception: {msg}")
            print(f"❌ {label} exception/logged")
