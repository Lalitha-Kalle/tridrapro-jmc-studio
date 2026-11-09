"""SQLite access: connection per request, schema setup, seeding, and the
queries that turn rows into the chapter objects the studio front-end uses."""
import json
import re
import shutil
import sqlite3
from pathlib import Path

import click
from flask import current_app, g, url_for

BASE_DIR = Path(__file__).resolve().parent
SEED_DIR = BASE_DIR / "seed"

# UKMT JMC marking: Q1–15 score 5, Q16–25 score 6, no penalty for wrong answers.
def test_marks(index):
    return 5 if index < 15 else 6


def clean_options(options, correct):
    """Validate answer options typed as five slots A–E. Trailing slots may be
    blank (e.g. a 4-option question). Returns (options, error_message)."""
    options = [o.strip() for o in options]
    while options and not options[-1]:
        options.pop()
    if len(options) < 2 or not all(options):
        return options, "fill options in order from A (at least A and B, no gaps)."
    if not 0 <= correct < len(options):
        return options, f"the correct answer must be one of the filled options (A–{'ABCDE'[len(options) - 1]})."
    return options, None


SLIDES_ID_RE =re.compile(r"docs\.google\.com/presentation/d/([A-Za-z0-9_-]+)")


def normalize_deck_url(url):
    """Turn any Google Slides share/edit/present link into its /embed form,
    which is the only one Google allows inside an <iframe>."""
    url = (url or "").strip()
    m = SLIDES_ID_RE.search(url)
    if not m or "/d/e/" in url:  # "Publish to web" links (/d/e/…/embed) already embed
        return url
    return f"https://docs.google.com/presentation/d/{m.group(1)}/embed"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript((BASE_DIR / "schema.sql").read_text(encoding="utf-8"))
    db.commit()


def seed_db():
    """Load seed/chapters.json (the content of the original prototype)."""
    db = get_db()
    chapters = json.loads((SEED_DIR / "chapters.json").read_text(encoding="utf-8"))
    upload_dir = Path(current_app.config["UPLOAD_FOLDER"])
    for pos, ch in enumerate(chapters):
        if db.execute("SELECT 1 FROM chapters WHERE slug = ?", (ch["slug"],)).fetchone():
            continue
        if ch.get("worksheet"):
            shutil.copyfile(SEED_DIR / "worksheets" / ch["worksheet"], upload_dir / ch["worksheet"])
        cur = db.execute(
            "INSERT INTO chapters (slug, name, subtitle, deck_url, worksheet_file, worksheet_pages, position)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ch["slug"], ch["name"], ch["subtitle"], ch["deck_url"], ch.get("worksheet"),
             ch["worksheet_pages"], pos),
        )
        chapter_id = cur.lastrowid
        for i, s in enumerate(ch["slides"]):
            db.execute(
                "INSERT INTO slides (chapter_id, position, kicker, heading, subtitle, bullets, note)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (chapter_id, i, s["kicker"], s["heading"], s["subtitle"], json.dumps(s["bullets"]), s["note"]),
            )
        for kind, key in (("drill", "drills"), ("test", "test")):
            for i, q in enumerate(ch[key]):
                db.execute(
                    "INSERT INTO questions (chapter_id, kind, position, stem, options, correct, explanation)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (chapter_id, kind, i, q["stem"], json.dumps(q["options"]), q["correct"], q["explanation"]),
                )
    db.commit()


def load_content_workbook():
    """Apply content.xlsx (the committed copy of the edited content) on top
    of the seed, so a fresh server — e.g. a new Render deploy — shows the
    same chapters, deck links and questions as the workbook."""
    workbook = BASE_DIR / "content.xlsx"
    if workbook.exists():
        import excel_io  # imported here: excel_io itself imports this module
        excel_io.import_bytes(workbook.read_bytes())


def ensure_db():
    """Create and seed the database on first run so `flask run` just works."""
    if not Path(current_app.config["DATABASE"]).exists():
        init_db()
        seed_db()
        load_content_workbook()


# ---------- queries ----------

def list_chapters():
    return get_db().execute("SELECT * FROM chapters ORDER BY position, id").fetchall()


def get_chapter(chapter_id=None, slug=None):
    if slug is not None:
        return get_db().execute("SELECT * FROM chapters WHERE slug = ?", (slug,)).fetchone()
    return get_db().execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()


def chapter_slides(chapter_id):
    return get_db().execute(
        "SELECT * FROM slides WHERE chapter_id = ? ORDER BY position, id", (chapter_id,)
    ).fetchall()


def chapter_questions(chapter_id, kind):
    return get_db().execute(
        "SELECT * FROM questions WHERE chapter_id = ? AND kind = ? ORDER BY position, id",
        (chapter_id, kind),
    ).fetchall()


def question_to_client(q):
    return {"id": q["id"], "s": q["stem"], "o": json.loads(q["options"]),
            "c": q["correct"], "e": q["explanation"]}


def chapter_to_client(ch):
    """Shape a chapter the way the original prototype's CHAPTERS array did."""
    return {
        "id": ch["slug"],
        "name": ch["name"],
        "sub": ch["subtitle"],
        "deck": ch["deck_url"],
        "cwUrl": url_for("worksheet", slug=ch["slug"]) if ch["worksheet_file"] else None,
        "cwPages": ch["worksheet_pages"],
        "slides": [
            {"k": s["kicker"], "h": s["heading"], "s": s["subtitle"],
             "b": json.loads(s["bullets"]), "n": s["note"]}
            for s in chapter_slides(ch["id"])
        ],
        "drills": [question_to_client(q) for q in chapter_questions(ch["id"], "drill")],
        "test": [question_to_client(q) for q in chapter_questions(ch["id"], "test")],
    }


def all_chapters_for_client():
    return [chapter_to_client(ch) for ch in list_chapters()]


def record_attempt(chapter, kind, answers, duration_secs):
    """Mark the submitted answers against the database (never trust the
    client's score) and store the attempt. Returns the stored summary."""
    questions = chapter_questions(chapter["id"], kind)
    if kind == "drill":
        asked = [q for q in questions if str(q["id"]) in answers]
        marks = {q["id"]: 1 for q in asked}
        max_score = len(asked)
    else:
        asked = questions
        marks = {q["id"]: test_marks(i) for i, q in enumerate(questions)}
        max_score = sum(marks.values())

    correct = blank = score = 0
    clean = {}
    for q in asked:
        choice = answers.get(str(q["id"]))
        choice = choice if isinstance(choice, int) and 0 <= choice <= 4 else None
        clean[q["id"]] = choice
        if choice is None:
            blank += 1
        elif choice == q["correct"]:
            correct += 1
            score += marks[q["id"]]

    db = get_db()
    cur = db.execute(
        "INSERT INTO attempts (chapter_id, kind, num_questions, num_correct, num_blank, score,"
        " max_score, duration_secs, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (chapter["id"], kind, len(asked), correct, blank, score, max_score,
         max(0, int(duration_secs or 0)), json.dumps(clean)),
    )
    db.commit()
    return {"id": cur.lastrowid, "score": score, "max_score": max_score,
            "correct": correct, "blank": blank, "questions": len(asked)}


# ---------- CLI ----------

@click.command("init-db")
@click.option("--reset", is_flag=True, help="Delete the existing database first.")
def init_db_command(reset):
    """Create the tables and load the seed chapters, then content.xlsx."""
    db_path = Path(current_app.config["DATABASE"])
    if reset and db_path.exists():
        close_db()
        db_path.unlink()
    init_db()
    seed_db()
    load_content_workbook()
    click.echo(f"Database ready at {db_path}")


def init_app(app):
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
