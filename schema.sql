PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chapters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    subtitle        TEXT    NOT NULL DEFAULT '',
    deck_url        TEXT    NOT NULL DEFAULT '',
    worksheet_file  TEXT,                       -- filename inside UPLOAD_FOLDER
    worksheet_pages INTEGER NOT NULL DEFAULT 0,
    position        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    kicker      TEXT    NOT NULL DEFAULT '',
    heading     TEXT    NOT NULL,               -- may contain <em> for gold emphasis
    subtitle    TEXT    NOT NULL DEFAULT '',
    bullets     TEXT    NOT NULL DEFAULT '[]',  -- JSON array of strings
    note        TEXT    NOT NULL DEFAULT ''
);

-- kind 'drill' = Classwork Drills pool, 'test' = 25-question JMC mock
CREATE TABLE IF NOT EXISTS questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('drill', 'test')),
    position    INTEGER NOT NULL DEFAULT 0,
    stem        TEXT    NOT NULL,
    options     TEXT    NOT NULL,               -- JSON array of 2–5 strings (A–E)
    correct     INTEGER NOT NULL CHECK (correct BETWEEN 0 AND 4),
    explanation TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attempts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id     INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    kind           TEXT    NOT NULL CHECK (kind IN ('drill', 'test')),
    num_questions  INTEGER NOT NULL,
    num_correct    INTEGER NOT NULL,
    num_blank      INTEGER NOT NULL,
    score          INTEGER NOT NULL,
    max_score      INTEGER NOT NULL,
    duration_secs  INTEGER NOT NULL DEFAULT 0,
    answers        TEXT    NOT NULL,            -- JSON {question_id: choice|null}
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slides_chapter    ON slides(chapter_id, position);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter_id, kind, position);
CREATE INDEX IF NOT EXISTS idx_attempts_created  ON attempts(created_at);
