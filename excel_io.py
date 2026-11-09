"""Excel round-trip for studio content.

content.xlsx has one tab per kind of front-end content. Every column except
the grey "how to" notes maps to something the studio shows:

  Chapters  — chapter picker name, subtitle, order, Google Slides deck link
  Slides    — the built-in Learn slides
  Questions — Classwork Drills pool and the 25-question JMC mock

Importing replaces the slides and questions of every chapter listed in the
workbook; chapters not listed are left alone. Worksheet PDFs are uploaded
in the admin panel, not through Excel.
"""
import io
import json
import re

import click
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

import db

LETTERS = "ABCDE"
MAX_BULLETS = 5
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

CHAPTER_COLS = [
    ("Chapter ID", 14, "Short id used in links, e.g. ch1. Lowercase letters, digits, dashes. Do not rename an existing id — that creates a new chapter."),
    ("Order", 8, "Position in the Chapter drop-down (0 = first)."),
    ("Chapter name", 24, "Shown in the Chapter drop-down and page titles."),
    ("Subtitle", 32, "Short description under the name in the admin panel."),
    ("Google Slides link", 60, "Optional. Paste the deck's share link (…/edit?usp=sharing is fine — it is converted to the embed link on import). The deck must be shared as \"Anyone with the link\". If set, Learn mode shows this deck instead of the built-in slides."),
]
SLIDE_COLS = [
    ("Chapter ID", 14, "Must match a Chapter ID on the Chapters tab."),
    ("Order", 8, "Slide number within the chapter (1 = first)."),
    ("Kicker", 18, "Small gold label above the heading, e.g. JMC Strategy."),
    ("Heading", 40, "Slide title. Wrap a word in <em>…</em> to highlight it in gold."),
    ("Subtitle", 50, "One-line intro under the heading."),
] + [(f"Bullet {i}", 45, "Numbered point on the slide. Leave blank if unused.") for i in range(1, MAX_BULLETS + 1)] + [
    ("Footer note", 30, "Small text at the bottom of the slide."),
]
QUESTION_COLS = [
    ("Chapter ID", 14, "Must match a Chapter ID on the Chapters tab."),
    ("Mode", 10, "Drill = Classwork Drills pool. Mock = JMC mock paper (Q1–15 score 5, Q16–25 score 6)."),
    ("Order", 8, "Question number within the chapter and mode (1 = first)."),
    ("Question", 60, "Question text shown to pupils."),
    ("Option A", 16, "Answer option A."),
    ("Option B", 16, "Answer option B."),
    ("Option C", 16, "Answer option C."),
    ("Option D", 16, "Answer option D. Leave D and E blank for a 3-option question."),
    ("Option E", 16, "Answer option E. Leave blank for a 4-option question."),
    ("Correct", 9, "Letter of the correct option: A, B, C, D or E."),
    ("Explanation", 60, "Shown after answering in drills and in the mock review."),
]

FONT = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="12182A")
EDIT_FILL = PatternFill("solid", fgColor="FFF8E1")  # pale yellow = editable
THIN = Side(style="thin", color="D9DCE3")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


# ---------- export ----------

def _table(ws, cols, rows, first_data_row=2):
    for c, (title, width, note) in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=c, value=title)
        cell.font = Font(name=FONT, bold=True, color="FFFFFF")
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.comment = Comment(note, "TridaPro")
        ws.column_dimensions[cell.column_letter].width = width
    ws.row_dimensions[1].height = 30
    for r, row in enumerate(rows, start=first_data_row):
        for c, value in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=value)
            cell.font = Font(name=FONT)
            cell.fill = EDIT_FILL
            cell.border = BORDER
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = ws.dimensions


def _list_validation(ws, sqref, formula, prompt):
    dv = DataValidation(type="list", formula1=formula, allow_blank=False, showErrorMessage=True,
                        errorTitle="Not allowed", error=prompt, showInputMessage=True, prompt=prompt)
    dv.add(sqref)
    ws.add_data_validation(dv)


def build_workbook():
    chapters = db.list_chapters()
    wb = Workbook()

    readme = wb.active
    readme.title = "Read Me"
    lines = [
        ("TridaPro · UKMT JMC Studio — content workbook", True),
        ("", False),
        ("Edit the pale-yellow cells on the Chapters, Slides and Questions tabs, then upload this file in", False),
        ("Admin → Chapters → “Import from Excel”. The studio updates immediately.", False),
        ("", False),
        ("Rules", True),
        ("• Hover a column heading to see what it controls.", False),
        ("• Chapter ID links the three tabs together — use the drop-down on Slides and Questions.", False),
        ("• Fill options in order from A (at least A and B; D and E may be blank) and pick a Correct letter.", False),
        ("• A full JMC mock has 25 Mock questions per chapter (Q1–15 = 5 marks, Q16–25 = 6 marks).", False),
        ("• Importing replaces all slides and questions of each chapter listed on the Chapters tab.", False),
        ("  Chapters you delete from the Chapters tab are NOT deleted from the site (do that in the admin panel).", False),
        ("• Worksheet PDFs are uploaded per chapter in the admin panel, not here.", False),
        ("• Add rows at the bottom of a tab to add slides or questions; delete rows to remove them.", False),
        ("", False),
        ("Example question row (Questions tab):", True),
        ("ch1 | Drill | 1 | What is 8 + 6 × 3? | 42 | 26 | 24 | 18 | 30 | B | Multiply first: 6×3=18, then 8+18=26.", False),
    ]
    for r, (text, bold) in enumerate(lines, start=1):
        readme.cell(row=r, column=1, value=text).font = Font(name=FONT, bold=bold, size=14 if r == 1 else 11)
    readme.column_dimensions["A"].width = 110
    legend = readme.cell(row=19, column=1, value="Pale yellow = editable content")
    legend.fill = EDIT_FILL
    legend.font = Font(name=FONT)

    ws = wb.create_sheet("Chapters")
    _table(ws, CHAPTER_COLS, [
        (c["slug"], c["position"], c["name"], c["subtitle"], c["deck_url"]) for c in chapters
    ])

    chapter_list = f"Chapters!$A$2:$A${max(2, len(chapters) + 1) + 50}"

    ws = wb.create_sheet("Slides")
    rows = []
    for c in chapters:
        for i, s in enumerate(db.chapter_slides(c["id"]), start=1):
            bullets = json.loads(s["bullets"])[:MAX_BULLETS]
            bullets += [None] * (MAX_BULLETS - len(bullets))
            rows.append((c["slug"], i, s["kicker"], s["heading"], s["subtitle"], *bullets, s["note"]))
    _table(ws, SLIDE_COLS, rows)
    _list_validation(ws, "A2:A2000", chapter_list, "Pick a Chapter ID from the Chapters tab.")

    ws = wb.create_sheet("Questions")
    rows = []
    for c in chapters:
        for kind, label in (("drill", "Drill"), ("test", "Mock")):
            for i, q in enumerate(db.chapter_questions(c["id"], kind), start=1):
                options = json.loads(q["options"])
                options += [None] * (len(LETTERS) - len(options))
                rows.append((c["slug"], label, i, q["stem"], *options,
                             LETTERS[q["correct"]], q["explanation"]))
    _table(ws, QUESTION_COLS, rows)
    _list_validation(ws, "A2:A5000", chapter_list, "Pick a Chapter ID from the Chapters tab.")
    _list_validation(ws, "B2:B5000", '"Drill,Mock"', "Drill or Mock.")
    _list_validation(ws, "J2:J5000", '"A,B,C,D,E"', "Correct answer letter: A, B, C, D or E.")

    wb.active = 1
    return wb


def export_bytes():
    buf = io.BytesIO()
    build_workbook().save(buf)
    return buf.getvalue()


# ---------- import ----------

class ImportError_(Exception):
    def __init__(self, errors):
        super().__init__("\n".join(errors))
        self.errors = errors


def _text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _int(v, default):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


# headings used by earlier downloads of the workbook, still accepted on import
OLD_HEADINGS = {"Google Slides embed URL": "Google Slides link"}


def _rows(wb, sheet, cols, errors):
    if sheet not in wb.sheetnames:
        errors.append(f"Missing tab “{sheet}”.")
        return []
    ws = wb[sheet]
    header = [OLD_HEADINGS.get(_text(c.value), _text(c.value)) for c in ws[1]]
    want = [c[0] for c in cols]
    if header[:len(want)] != want:
        errors.append(f"{sheet}: the column headings were changed. Expected: {', '.join(want)}.")
        return []
    out = []
    for r, values in enumerate(ws.iter_rows(min_row=2, max_col=len(want), values_only=True), start=2):
        if all(_text(v) == "" for v in values):
            continue
        out.append((r, dict(zip(want, values))))
    return out


def parse_workbook(data):
    """Validate the whole workbook. Returns (chapters, slides, questions) or
    raises ImportError_ listing every problem with its tab and row."""
    try:
        wb = load_workbook(io.BytesIO(data), data_only=True)
    except Exception:
        raise ImportError_(["That file isn't a readable .xlsx workbook."])
    errors = []

    chapters = {}
    for r, row in _rows(wb, "Chapters", CHAPTER_COLS, errors):
        slug = _text(row["Chapter ID"]).lower()
        name = _text(row["Chapter name"])
        if not SLUG_RE.match(slug):
            errors.append(f"Chapters row {r}: Chapter ID “{slug}” must be lowercase letters, digits or dashes.")
        elif slug in chapters:
            errors.append(f"Chapters row {r}: Chapter ID “{slug}” is listed twice.")
        if not name:
            errors.append(f"Chapters row {r}: Chapter name is required.")
        chapters[slug] = {"position": _int(row["Order"], r - 2), "name": name,
                          "subtitle": _text(row["Subtitle"]), "deck_url": db.normalize_deck_url(_text(row["Google Slides link"]))}

    slides = {slug: [] for slug in chapters}
    for r, row in _rows(wb, "Slides", SLIDE_COLS, errors):
        slug = _text(row["Chapter ID"]).lower()
        if slug not in chapters:
            errors.append(f"Slides row {r}: Chapter ID “{slug}” is not on the Chapters tab.")
            continue
        heading = _text(row["Heading"])
        if not heading:
            errors.append(f"Slides row {r}: Heading is required.")
        bullets = [_text(row[f"Bullet {i}"]) for i in range(1, MAX_BULLETS + 1)]
        slides[slug].append((_int(row["Order"], r), r, {
            "kicker": _text(row["Kicker"]), "heading": heading, "subtitle": _text(row["Subtitle"]),
            "bullets": [b for b in bullets if b], "note": _text(row["Footer note"])}))

    questions = {slug: {"drill": [], "test": []} for slug in chapters}
    for r, row in _rows(wb, "Questions", QUESTION_COLS, errors):
        slug = _text(row["Chapter ID"]).lower()
        if slug not in chapters:
            errors.append(f"Questions row {r}: Chapter ID “{slug}” is not on the Chapters tab.")
            continue
        mode = _text(row["Mode"]).lower()
        kind = {"drill": "drill", "mock": "test", "test": "test"}.get(mode)
        if kind is None:
            errors.append(f"Questions row {r}: Mode must be Drill or Mock.")
            continue
        stem = _text(row["Question"])
        options = [_text(row[f"Option {L}"]) for L in LETTERS]
        correct = _text(row["Correct"]).upper()
        if not stem:
            errors.append(f"Questions row {r}: Question is required.")
        if correct not in LETTERS or len(correct) != 1:
            errors.append(f"Questions row {r}: Correct must be one letter A–E.")
            correct = "A"
        options, problem = db.clean_options(options, LETTERS.index(correct))
        if problem:
            errors.append(f"Questions row {r}: {problem}")
        questions[slug][kind].append((_int(row["Order"], r), r, {
            "stem": stem, "options": options, "correct": LETTERS.index(correct),
            "explanation": _text(row["Explanation"])}))

    if not chapters and not errors:
        errors.append("The Chapters tab has no rows.")
    if errors:
        raise ImportError_(errors)
    return chapters, slides, questions


def import_bytes(data):
    """Apply a workbook to the database in one transaction. Returns counts."""
    chapters, slides, questions = parse_workbook(data)
    conn = db.get_db()
    counts = {"chapters": 0, "slides": 0, "drills": 0, "mock": 0}
    try:
        for slug, ch in chapters.items():
            existing = db.get_chapter(slug=slug)
            if existing:
                chapter_id = existing["id"]
                conn.execute("UPDATE chapters SET name = ?, subtitle = ?, deck_url = ?, position = ? WHERE id = ?",
                             (ch["name"], ch["subtitle"], ch["deck_url"], ch["position"], chapter_id))
            else:
                chapter_id = conn.execute(
                    "INSERT INTO chapters (slug, name, subtitle, deck_url, position) VALUES (?, ?, ?, ?, ?)",
                    (slug, ch["name"], ch["subtitle"], ch["deck_url"], ch["position"])).lastrowid
            counts["chapters"] += 1

            conn.execute("DELETE FROM slides WHERE chapter_id = ?", (chapter_id,))
            for pos, (_, _, s) in enumerate(sorted(slides[slug], key=lambda t: (t[0], t[1]))):
                conn.execute(
                    "INSERT INTO slides (chapter_id, position, kicker, heading, subtitle, bullets, note)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (chapter_id, pos, s["kicker"], s["heading"], s["subtitle"], json.dumps(s["bullets"]), s["note"]))
                counts["slides"] += 1

            conn.execute("DELETE FROM questions WHERE chapter_id = ?", (chapter_id,))
            for kind in ("drill", "test"):
                for pos, (_, _, q) in enumerate(sorted(questions[slug][kind], key=lambda t: (t[0], t[1]))):
                    conn.execute(
                        "INSERT INTO questions (chapter_id, kind, position, stem, options, correct, explanation)"
                        " VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (chapter_id, kind, pos, q["stem"], json.dumps(q["options"]), q["correct"], q["explanation"]))
                    counts["drills" if kind == "drill" else "mock"] += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return counts


# ---------- CLI ----------

@click.command("export-xlsx")
@click.argument("path", default="content.xlsx")
def export_xlsx_command(path):
    """Write all chapter content to an Excel workbook."""
    with open(path, "wb") as f:
        f.write(export_bytes())
    click.echo(f"Wrote {path}")


@click.command("import-xlsx")
@click.argument("path", default="content.xlsx")
def import_xlsx_command(path):
    """Load chapter content from an Excel workbook."""
    with open(path, "rb") as f:
        data = f.read()
    try:
        counts = import_bytes(data)
    except ImportError_ as e:
        raise click.ClickException("Nothing was imported:\n" + "\n".join(e.errors))
    click.echo("Imported {chapters} chapters, {slides} slides, {drills} drill and {mock} mock questions.".format(**counts))


def init_app(app):
    app.cli.add_command(export_xlsx_command)
    app.cli.add_command(import_xlsx_command)
