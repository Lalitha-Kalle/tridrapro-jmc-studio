"""Teacher/admin panel: chapters, slides, questions, worksheet PDFs, results."""
import json
import re
import secrets
from functools import wraps
from pathlib import Path

from flask import (Blueprint, Response, abort, current_app, flash, jsonify, redirect, render_template,
                   request, session, url_for)

import db
import excel_io

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def is_admin():
    return bool(session.get("admin"))


def require_admin(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Teacher login required"}), 401
            return redirect(url_for("admin.login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def count_pdf_pages(data):
    return len(re.findall(rb"/Type\s*/Page(?![s\w])", data))


def form_int(name, default=0):
    try:
        return int(request.form.get(name, default))
    except (TypeError, ValueError):
        return default


def chapter_or_404(chapter_id):
    ch = db.get_chapter(chapter_id)
    if ch is None:
        abort(404)
    return ch


# ---------- auth ----------

@admin_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if secrets.compare_digest(request.form.get("password", ""), current_app.config["ADMIN_PASSWORD"]):
            session["admin"] = True
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("admin.index"))
        flash("Wrong password.", "error")
    return render_template("admin/login.html")


@admin_bp.post("/logout")
def logout():
    session.pop("admin", None)
    return redirect(url_for("studio"))


# ---------- dashboard ----------

@admin_bp.get("/")
@require_admin
def index():
    conn = db.get_db()
    chapters = conn.execute(
        """SELECT c.*,
                  (SELECT COUNT(*) FROM slides s WHERE s.chapter_id = c.id) AS n_slides,
                  (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id AND q.kind = 'drill') AS n_drills,
                  (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id AND q.kind = 'test') AS n_test,
                  (SELECT COUNT(*) FROM attempts a WHERE a.chapter_id = c.id) AS n_attempts
           FROM chapters c ORDER BY c.position, c.id"""
    ).fetchall()
    return render_template("admin/index.html", chapters=chapters, attempts=recent_attempts(10))


def recent_attempts(limit, chapter_id=None, kind=None):
    sql = ("SELECT a.*, c.name AS chapter_name FROM attempts a JOIN chapters c ON c.id = a.chapter_id"
           " WHERE (? IS NULL OR a.chapter_id = ?) AND (? IS NULL OR a.kind = ?)"
           " ORDER BY a.id DESC LIMIT ?")
    return db.get_db().execute(sql, (chapter_id, chapter_id, kind, kind, limit)).fetchall()


@admin_bp.get("/attempts")
@require_admin
def attempts():
    chapter_id = request.args.get("chapter", type=int)
    kind = request.args.get("kind") or None
    return render_template("admin/attempts.html", attempts=recent_attempts(500, chapter_id, kind),
                           chapters=db.list_chapters(), chapter_id=chapter_id, kind=kind)


@admin_bp.post("/attempts/<int:attempt_id>/delete")
@require_admin
def delete_attempt(attempt_id):
    conn = db.get_db()
    conn.execute("DELETE FROM attempts WHERE id = ?", (attempt_id,))
    conn.commit()
    flash("Result deleted.", "ok")
    return redirect(request.referrer or url_for("admin.attempts"))


# ---------- Excel ----------

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@admin_bp.get("/content.xlsx")
@require_admin
def export_excel():
    return Response(excel_io.export_bytes(), mimetype=XLSX_MIME,
                    headers={"Content-Disposition": "attachment; filename=TridaPro_JMC_content.xlsx"})


@admin_bp.post("/import")
@require_admin
def import_excel():
    f = request.files.get("xlsx")
    if not f or not f.filename:
        flash("Choose an .xlsx file to import.", "error")
        return redirect(url_for("admin.index"))
    try:
        counts = excel_io.import_bytes(f.read())
    except excel_io.ImportError_ as e:
        shown = e.errors[:15] + ([f"…and {len(e.errors) - 15} more."] if len(e.errors) > 15 else [])
        flash("Nothing was imported. Fix these in the workbook and try again:", "error")
        for msg in shown:
            flash(msg, "error")
        return redirect(url_for("admin.index"))
    flash("Imported {chapters} chapters, {slides} slides, {drills} drill and {mock} mock questions."
          .format(**counts), "ok")
    return redirect(url_for("admin.index"))


# ---------- chapters ----------

@admin_bp.route("/chapters/new", methods=["GET", "POST"])
@require_admin
def new_chapter():
    if request.method == "POST":
        slug = request.form.get("slug", "").strip().lower()
        name = request.form.get("name", "").strip()
        if not SLUG_RE.match(slug) or not name:
            flash("A name and a short id (lowercase letters, digits, dashes) are required.", "error")
        elif db.get_chapter(slug=slug):
            flash(f"A chapter with id “{slug}” already exists.", "error")
        else:
            conn = db.get_db()
            pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM chapters").fetchone()[0]
            cur = conn.execute(
                "INSERT INTO chapters (slug, name, subtitle, deck_url, position) VALUES (?, ?, ?, ?, ?)",
                (slug, name, request.form.get("subtitle", "").strip(),
                 db.normalize_deck_url(request.form.get("deck_url", "")), pos),
            )
            conn.commit()
            flash("Chapter created.", "ok")
            return redirect(url_for("admin.edit_chapter", chapter_id=cur.lastrowid))
    return render_template("admin/chapter_new.html")


@admin_bp.route("/chapters/<int:chapter_id>", methods=["GET", "POST"])
@require_admin
def edit_chapter(chapter_id):
    ch = chapter_or_404(chapter_id)
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("Name is required.", "error")
        else:
            conn = db.get_db()
            conn.execute(
                "UPDATE chapters SET name = ?, subtitle = ?, deck_url = ?, position = ? WHERE id = ?",
                (name, request.form.get("subtitle", "").strip(), db.normalize_deck_url(request.form.get("deck_url", "")),
                 form_int("position", ch["position"]), chapter_id),
            )
            conn.commit()
            flash("Chapter saved.", "ok")
            return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id))
    return render_template(
        "admin/chapter.html", ch=ch, slides=db.chapter_slides(chapter_id),
        drills=db.chapter_questions(chapter_id, "drill"), tests=db.chapter_questions(chapter_id, "test"),
        loads=json.loads,
    )


@admin_bp.post("/chapters/<int:chapter_id>/delete")
@require_admin
def delete_chapter(chapter_id):
    ch = chapter_or_404(chapter_id)
    remove_worksheet_file(ch)
    conn = db.get_db()
    conn.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
    conn.commit()
    flash(f"Deleted {ch['name']}.", "ok")
    return redirect(url_for("admin.index"))


def remove_worksheet_file(ch):
    if ch["worksheet_file"]:
        (Path(current_app.config["UPLOAD_FOLDER"]) / ch["worksheet_file"]).unlink(missing_ok=True)


@admin_bp.post("/chapters/<int:chapter_id>/worksheet")
@require_admin
def upload_worksheet(chapter_id):
    ch = chapter_or_404(chapter_id)
    f = request.files.get("pdf")
    data = f.read() if f else b""
    if not data.startswith(b"%PDF"):
        flash("Please choose a PDF file.", "error")
        return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id))
    remove_worksheet_file(ch)
    filename = f"{ch['slug']}-{secrets.token_hex(4)}.pdf"
    (Path(current_app.config["UPLOAD_FOLDER"]) / filename).write_bytes(data)
    pages = form_int("pages") or count_pdf_pages(data)
    conn = db.get_db()
    conn.execute("UPDATE chapters SET worksheet_file = ?, worksheet_pages = ? WHERE id = ?",
                 (filename, pages, chapter_id))
    conn.commit()
    flash(f"Worksheet uploaded ({pages} pages).", "ok")
    return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id))


@admin_bp.post("/chapters/<int:chapter_id>/worksheet/delete")
@require_admin
def delete_worksheet(chapter_id):
    ch = chapter_or_404(chapter_id)
    remove_worksheet_file(ch)
    conn = db.get_db()
    conn.execute("UPDATE chapters SET worksheet_file = NULL, worksheet_pages = 0 WHERE id = ?", (chapter_id,))
    conn.commit()
    flash("Worksheet removed.", "ok")
    return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id))


# ---------- slides ----------

def next_position(table, chapter_id, kind=None):
    sql = f"SELECT COALESCE(MAX(position), -1) + 1 FROM {table} WHERE chapter_id = ?"
    args = [chapter_id]
    if kind:
        sql += " AND kind = ?"
        args.append(kind)
    return db.get_db().execute(sql, args).fetchone()[0]


@admin_bp.route("/chapters/<int:chapter_id>/slides/new", methods=["GET", "POST"], defaults={"slide_id": None})
@admin_bp.route("/chapters/<int:chapter_id>/slides/<int:slide_id>", methods=["GET", "POST"])
@require_admin
def edit_slide(chapter_id, slide_id):
    ch = chapter_or_404(chapter_id)
    conn = db.get_db()
    slide = None
    if slide_id is not None:
        slide = conn.execute("SELECT * FROM slides WHERE id = ? AND chapter_id = ?", (slide_id, chapter_id)).fetchone()
        if slide is None:
            abort(404)
    if request.method == "POST":
        heading = request.form.get("heading", "").strip()
        bullets = [b.strip() for b in request.form.get("bullets", "").splitlines() if b.strip()]
        if not heading:
            flash("Heading is required.", "error")
        else:
            values = (request.form.get("kicker", "").strip(), heading, request.form.get("subtitle", "").strip(),
                      json.dumps(bullets), request.form.get("note", "").strip())
            if slide is None:
                conn.execute(
                    "INSERT INTO slides (chapter_id, position, kicker, heading, subtitle, bullets, note)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)", (chapter_id, next_position("slides", chapter_id), *values))
            else:
                conn.execute(
                    "UPDATE slides SET kicker = ?, heading = ?, subtitle = ?, bullets = ?, note = ?, position = ?"
                    " WHERE id = ?", (*values, form_int("position", slide["position"]), slide_id))
            conn.commit()
            flash("Slide saved.", "ok")
            return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id) + "#slides")
    return render_template("admin/slide.html", ch=ch, slide=slide,
                           bullets=json.loads(slide["bullets"]) if slide else [])


@admin_bp.post("/chapters/<int:chapter_id>/slides/<int:slide_id>/delete")
@require_admin
def delete_slide(chapter_id, slide_id):
    conn = db.get_db()
    conn.execute("DELETE FROM slides WHERE id = ? AND chapter_id = ?", (slide_id, chapter_id))
    conn.commit()
    flash("Slide deleted.", "ok")
    return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id) + "#slides")


# ---------- questions ----------

@admin_bp.route("/chapters/<int:chapter_id>/<any(drill, test):kind>/new", methods=["GET", "POST"],
                defaults={"question_id": None})
@admin_bp.route("/chapters/<int:chapter_id>/<any(drill, test):kind>/<int:question_id>", methods=["GET", "POST"])
@require_admin
def edit_question(chapter_id, kind, question_id):
    ch = chapter_or_404(chapter_id)
    conn = db.get_db()
    q = None
    if question_id is not None:
        q = conn.execute("SELECT * FROM questions WHERE id = ? AND chapter_id = ? AND kind = ?",
                         (question_id, chapter_id, kind)).fetchone()
        if q is None:
            abort(404)
    if request.method == "POST":
        stem = request.form.get("stem", "").strip()
        options, problem = db.clean_options([request.form.get(f"option{i}", "") for i in range(5)],
                                            form_int("correct", -1))
        correct = form_int("correct", -1)
        if not stem:
            flash("The question text is required.", "error")
        elif problem:
            flash("Options: " + problem, "error")
        else:
            values = (stem, json.dumps(options), correct, request.form.get("explanation", "").strip())
            if q is None:
                conn.execute(
                    "INSERT INTO questions (chapter_id, kind, position, stem, options, correct, explanation)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (chapter_id, kind, next_position("questions", chapter_id, kind), *values))
            else:
                conn.execute(
                    "UPDATE questions SET stem = ?, options = ?, correct = ?, explanation = ?, position = ?"
                    " WHERE id = ?", (*values, form_int("position", q["position"]), question_id))
            conn.commit()
            flash("Question saved.", "ok")
            return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id) + f"#{kind}")
    return render_template("admin/question.html", ch=ch, kind=kind, q=q,
                           options=json.loads(q["options"]) if q else [""] * 5)


@admin_bp.post("/chapters/<int:chapter_id>/<any(drill, test):kind>/<int:question_id>/delete")
@require_admin
def delete_question(chapter_id, kind, question_id):
    conn = db.get_db()
    conn.execute("DELETE FROM questions WHERE id = ? AND chapter_id = ? AND kind = ?",
                 (question_id, chapter_id, kind))
    conn.commit()
    flash("Question deleted.", "ok")
    return redirect(url_for("admin.edit_chapter", chapter_id=chapter_id) + f"#{kind}")
