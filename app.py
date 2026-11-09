"""TridaPro · UKMT JMC Studio — Flask backend.

Run:  flask --app app run --debug     (creates + seeds instance/studio.db on first run)
"""
import os
import secrets
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory, session

import db
import excel_io
from admin import admin_bp, is_admin, require_admin

BASE_DIR = Path(__file__).resolve().parent


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def check_csrf():
    sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
    if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
        abort(400, "Invalid or missing CSRF token")


def create_app():
    # DATA_DIR lets a host put the database and uploads on a persistent disk
    data_dir = Path(os.environ.get("DATA_DIR", BASE_DIR / "instance"))
    app = Flask(__name__, instance_path=str(BASE_DIR / "instance"))
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-change-me"),
        ADMIN_PASSWORD=os.environ.get("ADMIN_PASSWORD", "admin"),
        DATABASE=str(data_dir / "studio.db"),
        UPLOAD_FOLDER=str(data_dir / "uploads"),
        MAX_CONTENT_LENGTH=25 * 1024 * 1024,  # worksheet PDFs up to 25 MB
    )
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    excel_io.init_app(app)
    app.register_blueprint(admin_bp)
    app.jinja_env.globals["csrf_token"] = csrf_token

    with app.app_context():
        db.ensure_db()

    @app.before_request
    def protect_posts():
        if request.method in ("POST", "PUT", "DELETE"):
            check_csrf()

    # ---------- studio ----------

    @app.get("/")
    def studio():
        return render_template("studio.html", chapters=db.all_chapters_for_client(), is_admin=is_admin())

    @app.get("/worksheets/<slug>.pdf")
    def worksheet(slug):
        ch = db.get_chapter(slug=slug)
        if ch is None or not ch["worksheet_file"]:
            abort(404)
        return send_from_directory(
            app.config["UPLOAD_FOLDER"], ch["worksheet_file"], mimetype="application/pdf",
            as_attachment=bool(request.args.get("download")),
            download_name=f"TridaPro_{slug.upper()}_Classwork_Worksheet.pdf",
        )

    # ---------- JSON API ----------

    @app.get("/api/chapters")
    def api_chapters():
        return jsonify(db.all_chapters_for_client())

    @app.get("/api/chapters/<slug>")
    def api_chapter(slug):
        ch = db.get_chapter(slug=slug)
        if ch is None:
            abort(404)
        return jsonify(db.chapter_to_client(ch))

    @app.post("/api/chapters/<slug>/deck")
    @require_admin
    def api_set_deck(slug):
        ch = db.get_chapter(slug=slug)
        if ch is None:
            abort(404)
        deck_url = db.normalize_deck_url((request.get_json(silent=True) or {}).get("deck_url", ""))
        conn = db.get_db()
        conn.execute("UPDATE chapters SET deck_url = ? WHERE id = ?", (deck_url, ch["id"]))
        conn.commit()
        return jsonify({"ok": True, "deck_url": deck_url})

    @app.post("/api/attempts")
    def api_record_attempt():
        data = request.get_json(silent=True) or {}
        ch = db.get_chapter(slug=data.get("chapter"))
        kind = data.get("kind")
        answers = data.get("answers")
        if ch is None or kind not in ("drill", "test") or not isinstance(answers, dict):
            abort(400, "Expected chapter, kind (drill|test) and answers")
        return jsonify(db.record_attempt(ch, kind, answers, data.get("duration_secs"))), 201

    @app.errorhandler(400)
    @app.errorhandler(404)
    def json_errors(err):
        if request.path.startswith("/api/"):
            return jsonify({"error": err.description}), err.code
        return err

    return app


app = create_app()
