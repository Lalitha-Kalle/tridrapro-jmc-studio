# TridaPro · UKMT JMC Studio

Flask + SQLite version of the `tridapro-jmc-studio.html` prototype. The studio
UI (Learn / Classwork Drills / Test) is unchanged; chapter content, worksheet
PDFs and pupils' results now live in a SQLite database and are managed from a
teacher admin panel.

## Run it

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
flask --app app run --debug
```

Open http://127.0.0.1:5000 for the studio and http://127.0.0.1:5000/admin for
the admin panel. On first start the database `instance/studio.db` is created
and seeded with the three chapters from the prototype (including Chapter 1's
worksheet PDF).

Rebuild the database from the seed (deletes all edits and results):

```bash
flask --app app init-db --reset
```

## Editing content in Excel

`content.xlsx` holds everything the studio shows, one tab each:

- **Chapters**: Chapter ID, Order, Chapter name, Subtitle, Google Slides embed URL
- **Slides**: Chapter ID, Order, Kicker, Heading, Subtitle, Bullet 1–5, Footer note
- **Questions**: Chapter ID, Mode (Drill/Mock), Order, Question, Option A–E, Correct (A–E), Explanation

In the admin panel, use **Download Excel** to get the current content, edit the
yellow cells, then **Import from Excel**. Each column heading has a comment
explaining what it controls. If any row is invalid, nothing is imported and
every problem is listed by tab and row. From the command line:

```bash
flask --app app export-xlsx content.xlsx
```
```bash
flask --app app import-xlsx content.xlsx
```

Importing replaces the slides and questions of each chapter on the Chapters
tab. Chapters left out of the file are not deleted, and worksheet PDFs are
still uploaded per chapter in the admin panel.

## Configuration (environment variables)

| Variable         | Default         | Purpose                                  |
|------------------|-----------------|------------------------------------------|
| `ADMIN_PASSWORD` | `admin`         | Teacher login password — change it        |
| `SECRET_KEY`     | `dev-change-me` | Signs the session cookie — change it      |

## Layout

```
app.py              Flask app: studio page, worksheet download, JSON API
admin.py            /admin blueprint: chapters, slides, questions, PDFs, results
db.py               SQLite helpers, seeding, scoring of attempts
schema.sql          Tables: chapters, slides, questions, attempts
seed/               Original prototype content (chapters.json + worksheet PDF)
templates/          studio.html (the prototype markup) and admin/ pages
static/             studio.css / studio.js (prototype styles + script), admin.css, logo
instance/           Created at runtime: studio.db and uploads/ (git-ignored)
```

## API

| Method | Path                          | Notes                                                    |
|--------|-------------------------------|----------------------------------------------------------|
| GET    | `/api/chapters`               | All chapters with slides, drills and mock questions       |
| GET    | `/api/chapters/<slug>`        | One chapter                                              |
| POST   | `/api/chapters/<slug>/deck`   | `{deck_url}` — teacher login required                     |
| POST   | `/api/attempts`               | `{chapter, kind: drill|test, answers: {qid: 0-4|null}, duration_secs}`; the server marks it (JMC: Q1–15 = 5, Q16–25 = 6, no penalty) |
| GET    | `/worksheets/<slug>.pdf`      | Chapter worksheet (`?download=1` to download)             |

POST requests need the `X-CSRF-Token` header (the studio page provides it).

Slide headings and question text are rendered as HTML (so `<em>` works in
headings); only teachers can edit them.
