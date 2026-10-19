"""ЖИ субтитр студиясы: аккаунт, бейне -> субтитр, ЖИ чаты, жеке дизайн баптаулары."""
import base64
import json
import os
import re
import sqlite3
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, g, jsonify, redirect, render_template, request,
                   send_from_directory, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from subtitles import transcribe

BASE = Path(__file__).parent
UPLOADS = BASE / "uploads"
UPLOADS.mkdir(exist_ok=True)
DB_PATH = UPLOADS / "app.db"
KEY_FILE = UPLOADS / "secret.key"
ALLOWED = {".mp4", ".webm", ".ogv", ".mov", ".mkv"}
MODEL = os.environ.get("WHISPER_MODEL", "medium")  # қазақ тілі үшін: "medium" (жақсы), "large-v3" (ең дәл, өте баяу)

def load_env():
    """.env файлын оқу (кілт кодта тұрмайды). Файл Git-ке жіберілмейді."""
    env_file = BASE / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

# ЖИ чаты: Groq ақысыз жоспары. Кілт пен модель орта айнымалысынан алынады, кодқа жазылмайды.
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_VISION_MODEL = os.environ.get("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")  # суретті сипаттау үшін
IMG_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
IMG_MAX_BYTES = 4 * 1024 * 1024
DESCRIBE_DEFAULT = "Бұл суретті есту қабілеті бұзылған бала үшін қысқа, нақты және түсінікті тілмен сипаттап бер."
SYSTEM_PROMPT = (
    "Сен «ЖИ субтитр студиясы» сайтының көмекшісісің. Пайдаланушылар — есту қабілеті бұзылған "
    "балалар мен олардың мұғалімдері. Қысқа, түсінікті және жылы тілмен жауап бер. Сұрақ қойылған "
    "тілде жауап бер (қазақша немесе орысша). Субтитр, бейне және сайт мүмкіндіктері туралы көмектес."
)

DEFAULT_THEME = {"accent": "#1c59d9", "bg": "#f7f7f9", "surface": "#ffffff", "sidebar": "#efeff3",
                 "text": "#15171f", "radius": 14, "font": 18, "contrast": False, "motion": True}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
USERNAME = re.compile(r"^[\w-]{3,32}$")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024


# ---------- дерекқор ----------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    con = g.pop("db", None)
    if con is not None:
        con.close()


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
            pw_hash TEXT NOT NULL, theme TEXT, created TEXT);
        CREATE TABLE IF NOT EXISTS videos (
            job TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT, ext TEXT,
            created TEXT, label TEXT);
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            role TEXT NOT NULL, content TEXT NOT NULL, created TEXT);
    """)
    cols = {r[1] for r in con.execute("PRAGMA table_info(videos)")}
    if "lang" not in cols:
        con.execute("ALTER TABLE videos ADD COLUMN lang TEXT")
    con.commit()
    con.close()


init_db()

if not KEY_FILE.exists():
    KEY_FILE.write_text(uuid.uuid4().hex + uuid.uuid4().hex, encoding="utf-8")
app.secret_key = os.environ.get("FLASK_SECRET") or KEY_FILE.read_text(encoding="utf-8")
app.permanent_session_lifetime = timedelta(days=30)


# ---------- тақырып (дизайн) ----------
def clean_theme(raw):
    t = dict(DEFAULT_THEME)
    if not isinstance(raw, dict):
        return t
    for k in ("accent", "bg", "surface", "sidebar", "text"):
        v = raw.get(k)
        if isinstance(v, str) and HEX.match(v):
            t[k] = v
    try:
        t["radius"] = min(28, max(0, int(raw.get("radius", t["radius"]))))
    except (TypeError, ValueError):
        pass
    try:
        t["font"] = min(28, max(14, int(raw.get("font", t["font"]))))
    except (TypeError, ValueError):
        pass
    t["contrast"] = bool(raw.get("contrast", False))
    t["motion"] = bool(raw.get("motion", True))
    return t


def load_theme(text):
    try:
        return clean_theme(json.loads(text))
    except (TypeError, ValueError):
        return dict(DEFAULT_THEME)


def on_accent(hex_color):
    """Акцент түсіне жазу түсі: ашық болса қара, қараңғы болса ақ."""
    n = int(hex_color[1:], 16)
    chans = []
    for shift in (16, 8, 0):
        v = ((n >> shift) & 255) / 255
        chans.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
    lum = 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2]
    return "#111111" if lum > 0.179 else "#ffffff"


# ---------- аккаунт ----------
def me():
    if "me" not in g:
        uid = session.get("uid")
        g.me = db().execute("SELECT id, username, theme FROM users WHERE id=?", (uid,)).fetchone() if uid else None
    return g.me


@app.context_processor
def inject_user():
    u = me()
    theme = load_theme(u["theme"]) if u else dict(DEFAULT_THEME)
    theme["on_accent"] = on_accent(theme["accent"])
    return {"me": u, "theme": theme}


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if me() is None:
            if request.path.startswith(("/api/", "/status/")):
                return jsonify({"error": "Алдымен кіріңіз."}), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapper


@app.route("/register", methods=["GET", "POST"])
def register():
    error, username = None, ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not USERNAME.match(username):
            error = "Аты 3–32 таңбадан тұруы керек: әріп, сан, _ немесе -."
        elif len(password) < 6:
            error = "Құпия сөз кемінде 6 таңба болуы керек."
        else:
            try:
                cur = db().execute(
                    "INSERT INTO users(username, pw_hash, theme, created) VALUES(?,?,?,?)",
                    (username, generate_password_hash(password), json.dumps(DEFAULT_THEME),
                     datetime.now().isoformat(timespec="minutes")))
                db().commit()
                session.clear()
                session.permanent = True
                session["uid"] = cur.lastrowid
                return redirect(url_for("index"))
            except sqlite3.IntegrityError:
                error = "Бұл аты бос емес. Басқа атын таңдаңыз."
    return render_template("auth.html", mode="register", error=error, username=username)


@app.route("/login", methods=["GET", "POST"])
def login():
    error, username = None, ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        row = db().execute("SELECT id, pw_hash FROM users WHERE username=?", (username,)).fetchone()
        if row and check_password_hash(row["pw_hash"], password):
            session.clear()
            session.permanent = True
            session["uid"] = row["id"]
            return redirect(url_for("index"))
        error = "Аты немесе құпия сөз қате."
    return render_template("auth.html", mode="login", error=error, username=username)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/api/theme", methods=["GET", "PUT"])
@login_required
def api_theme():
    user = me()
    if request.method == "PUT":
        theme = clean_theme(request.get_json(silent=True) or {})
        db().execute("UPDATE users SET theme=? WHERE id=?", (json.dumps(theme), user["id"]))
        db().commit()
        return jsonify(theme)
    return jsonify(load_theme(user["theme"]))


# ---------- бейне жұмыстары ----------
def own_video(job):
    return db().execute("SELECT * FROM videos WHERE job=? AND user_id=?", (job, me()["id"])).fetchone()


def user_history():
    rows = db().execute(
        "SELECT job, title, ext, label, created FROM videos WHERE user_id=? ORDER BY created DESC",
        (me()["id"],)).fetchall()
    return [dict(r) for r in rows if (UPLOADS / f"{r['job']}.vtt").exists()]


LANGS = {"", "kk", "ru", "en"}
JOBS = {}  # job_id -> {"state": "working" | "done" | "error", "error": "..."}


def run_job(job, video_path, lang):
    try:
        transcribe(str(video_path), model_size=MODEL, lang=lang)
        JOBS[job] = {"state": "done"}
    except Exception as e:
        JOBS[job] = {"state": "error", "error": str(e)}


@app.route("/")
@login_required
def index():
    return render_template("index.html", recent=user_history()[:6])


@app.route("/upload", methods=["POST"])
@login_required
def upload():
    f = request.files.get("video")
    if not f or not f.filename:
        return redirect(url_for("index"))
    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED:
        return render_template("index.html", error="Бұл формат қолдау көрсетілмейді.",
                               recent=user_history()[:6]), 400

    lang_in = request.form.get("lang") or ""
    if lang_in not in LANGS:
        lang_in = ""
    job = uuid.uuid4().hex[:8]
    video_path = UPLOADS / f"{job}{ext}"
    f.save(video_path)
    now = datetime.now()
    db().execute("INSERT INTO videos(job, user_id, title, ext, created, label, lang) VALUES(?,?,?,?,?,?,?)",
                 (job, me()["id"], Path(f.filename).stem, ext[1:],
                  now.isoformat(timespec="minutes"), now.strftime("%d.%m.%Y %H:%M"), lang_in))
    db().commit()
    JOBS[job] = {"state": "working"}
    threading.Thread(target=run_job, args=(job, video_path, lang_in or None), daemon=True).start()
    return redirect(url_for("wait", job=job, ext=ext[1:]))


@app.route("/wait/<job>/<ext>")
@login_required
def wait(job, ext):
    row = own_video(job)
    if row is None:
        abort(404)
    return render_template("wait.html", job=job, ext=ext, title=row["title"])


@app.route("/status/<job>")
@login_required
def status(job):
    if own_video(job) is None:
        return jsonify({"state": "unknown"})
    if job in JOBS:
        return jsonify(JOBS[job])
    # Сервер қайта қосылса, дайын субтитр файлы бойынша анықтаймыз
    return jsonify({"state": "done" if (UPLOADS / f"{job}.vtt").exists() else "unknown"})


@app.route("/api/videos")
@login_required
def api_videos():
    return jsonify(user_history())


@app.route("/player/<job>/<ext>")
@login_required
def player(job, ext):
    row = own_video(job)
    if row is None or not (UPLOADS / f"{job}.{ext}").exists() or not (UPLOADS / f"{job}.vtt").exists():
        abort(404)
    lang = row["lang"] or ""
    if not lang:  # автоматты анықтау: Whisper тапқан тіл
        lang_file = UPLOADS / f"{job}.lang"
        lang = lang_file.read_text(encoding="utf-8").strip() if lang_file.exists() else "kk"
    if lang not in LANGS - {""}:
        lang = "kk"
    return render_template("player.html", video=f"{job}.{ext}", vtt=f"{job}.vtt", title=row["title"], lang=lang)


@app.route("/media/<path:name>")
@login_required
def media(name):
    if own_video(name.split(".")[0]) is None:
        abort(404)
    mimetype = "text/vtt" if name.endswith(".vtt") else None
    return send_from_directory(UPLOADS, name, mimetype=mimetype)


# ---------- ЖИ чаты ----------
class ChatError(Exception):
    pass


def groq_chat(messages, model):
    if not GROQ_KEY:
        raise ChatError("ЖИ әзірге қосылмаған: сервер әкімшісі GROQ_API_KEY орнатуы керек.")
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "temperature": 0.5,
        "max_tokens": 700,
    }).encode("utf-8")
    req = urllib.request.Request(GROQ_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_KEY,
        "User-Agent": "hci-subtitle-studio/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.load(r)
        return data["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        raise ChatError(f"ЖИ сервисі қате қайтарды ({e.code}). Кілтті, модельді немесе лимитті тексеріңіз.")
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError):
        raise ChatError("ЖИ сервисіне қосылу мүмкін болмады.")


def ask_groq(messages):
    return groq_chat(messages, GROQ_MODEL)


@app.route("/api/chat", methods=["GET", "POST", "DELETE"])
@login_required
def api_chat():
    uid = me()["id"]
    if request.method == "DELETE":
        db().execute("DELETE FROM messages WHERE user_id=?", (uid,))
        db().commit()
        return jsonify({"ok": True})
    if request.method == "GET":
        rows = db().execute("SELECT role, content FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 60",
                            (uid,)).fetchall()
        return jsonify([dict(r) for r in reversed(rows)])

    text = str((request.get_json(silent=True) or {}).get("message", "")).strip()[:2000]
    if not text:
        return jsonify({"error": "Хабарлама бос."}), 400
    rows = db().execute("SELECT role, content FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 16",
                        (uid,)).fetchall()
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    now = datetime.now().isoformat(timespec="seconds")
    db().execute("INSERT INTO messages(user_id, role, content, created) VALUES(?,?,?,?)",
                 (uid, "user", text, now))
    db().commit()
    try:
        reply = ask_groq(history + [{"role": "user", "content": text}])
    except ChatError as e:
        return jsonify({"error": str(e)}), 503
    db().execute("INSERT INTO messages(user_id, role, content, created) VALUES(?,?,?,?)",
                 (uid, "assistant", reply, now))
    db().commit()
    return jsonify({"reply": reply})


@app.route("/api/describe", methods=["POST"])
@login_required
def api_describe():
    uid = me()["id"]
    f = request.files.get("image")
    if not f or not f.filename:
        return jsonify({"error": "Сурет файлын таңдаңыз."}), 400
    if f.mimetype not in IMG_TYPES:
        return jsonify({"error": "Тек JPG, PNG, WEBP немесе GIF суреті қабылданады."}), 400
    data = f.read(IMG_MAX_BYTES + 1)
    if len(data) > IMG_MAX_BYTES:
        return jsonify({"error": "Сурет 4 МБ-тан үлкен болмауы керек."}), 413
    question = (request.form.get("question", "") or "").strip()[:500] or DESCRIBE_DEFAULT
    now = datetime.now().isoformat(timespec="seconds")
    db().execute("INSERT INTO messages(user_id, role, content, created) VALUES(?,?,?,?)",
                 (uid, "user", "[сурет] " + question, now))
    db().commit()
    url = f"data:{f.mimetype};base64," + base64.b64encode(data).decode("ascii")
    content = [{"type": "text", "text": question}, {"type": "image_url", "image_url": {"url": url}}]
    try:
        reply = groq_chat([{"role": "user", "content": content}], GROQ_VISION_MODEL)
    except ChatError as e:
        return jsonify({"error": str(e)}), 503
    db().execute("INSERT INTO messages(user_id, role, content, created) VALUES(?,?,?,?)",
                 (uid, "assistant", reply, now))
    db().commit()
    return jsonify({"reply": reply})


if __name__ == "__main__":
    app.run(debug=True)
