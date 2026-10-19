"""Үлгі бейнелерді аккаунтқа қосу.
Қолдану: алдымен сайтта аккаунт тіркеңіз, содан кейін:  python seed_demo.py улан
"""
import sys
from datetime import datetime
from pathlib import Path

import app as A

if len(sys.argv) < 2:
    sys.exit("Қолдану: python seed_demo.py <пайдаланушы аты>")

con = A.sqlite3.connect(A.DB_PATH)
con.row_factory = A.sqlite3.Row
user = con.execute("SELECT id FROM users WHERE username=?", (sys.argv[1],)).fetchone()
if user is None:
    sys.exit(f"Аккаунт табылмады: {sys.argv[1]}. Алдымен сайтта тіркеліңіз.")

added = 0
for vtt in sorted(A.UPLOADS.glob("*.vtt")):
    job = vtt.stem
    video = next((p for p in A.UPLOADS.glob(job + ".*") if p.suffix not in (".vtt", ".db")), None)
    if video is None or con.execute("SELECT 1 FROM videos WHERE job=?", (job,)).fetchone():
        continue
    added += 1
    ts = datetime.fromtimestamp(vtt.stat().st_mtime)
    con.execute("INSERT INTO videos(job, user_id, title, ext, created, label) VALUES(?,?,?,?,?,?)",
                (job, user["id"], f"Үлгі бейне {added}", video.suffix[1:],
                 ts.isoformat(timespec="minutes"), ts.strftime("%d.%m.%Y %H:%M")))
con.commit()
print(f"Қосылды: {added} бейне ({sys.argv[1]} аккаунтына)")
