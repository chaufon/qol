import sqlite3
from dataclasses import dataclass
from pathlib import Path

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY,
        prompt_uuid TEXT NOT NULL UNIQUE,
        session_id TEXT,
        created_at TEXT NOT NULL,
        project_dir TEXT,
        input_mode TEXT CHECK (input_mode IN ('typed', 'dictated')),
        original TEXT NOT NULL,
        corrected TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS mistake_types (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        example TEXT,
        identifier_rule TEXT NOT NULL,
        position INTEGER NOT NULL,
        deleted_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS occurrences (
        id INTEGER PRIMARY KEY,
        prompt_id INTEGER NOT NULL REFERENCES prompts (id),
        mistake_id INTEGER NOT NULL REFERENCES mistakes (id),
        original_sentence TEXT NOT NULL,
        corrected_sentence TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS occurrences_mistake ON occurrences (mistake_id)",
)
MISTAKES_DDL = """CREATE TABLE {name} (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL REFERENCES mistake_types (key),
    identifier TEXT NOT NULL,
    UNIQUE (type, identifier)
)"""

# (key, label, description, example, identifier rule shown to the model); position is the index + 1.
SEED = (
    ("spelling", "spelling", "A word written with wrong, missing or extra letters.",
     '"necesity" instead of "necessity"',
     'the correct word ("necessity" for "necesity")'),
    ("irregular_verb", "irregular verb", "An irregular verb in the wrong form, usually its past or past participle.",
     '"know" instead of "known"',
     'the base form of the verb, never the past forms ("know" for "I have know")'),
    ("phrasal_verb", "phrasal verb", "The wrong verb + particle combination for the meaning.",
     '"get off" instead of "get out"',
     'the correct phrasal verb ("get out" for "get off the house")'),
    ("wrong_tense", "wrong tense", "A real tense, but not the one the meaning needs.",
     '"simple past" instead of "present perfect"',
     'the used tense and the correct one, as is ("\\"simple past\\" instead of \\"present perfect\\"")'),
    ("malformed_tense", "malformed tense",
     "The right tense built wrong: auxiliaries missing, extra or in the wrong place.",
     '"you have been at the mall?" instead of "have you been at the mall?"',
     'the auxiliaries in correct order ("have you been" for "you have been at the mall?")'),
    ("word_order", "word order", "Words in the order Spanish uses instead of the order English uses.",
     '"the strategy of my cousin" instead of "my cousin\'s strategy"',
     'the pattern the user was replicating from Spanish ("expressing belonging" for "the strategy of my cousin")'),
    ("native_expression", "native expression", "Correct English that a native speaker would say another way.",
     '"a practical course will be preferred" instead of "a hands-on course would be preferred"',
     'the correct native expression ("hands-on" for "a practical course")'),
    ("preposition", "preposition", "A wrong, missing or extra preposition.",
     '"depend of" instead of "depend on"',
     'the correct word and preposition ("depend on" for "depend of")'),
    ("article", "article", 'A wrong, missing or extra "a/an" or "the".',
     '"the people are selfish" instead of "people are selfish"',
     'the correct article use: "a/an", "the" or "no article" ("no article" for "the people are selfish")'),
    ("agreement", "agreement", "A verb or noun that does not match its subject or its number.",
     '"he have" instead of "he has"',
     'the agreement rule: "third person -s", "there is/there are", "plural noun", ...'),
    ("word_choice", "word choice", "A real English word that does not mean what you meant.",
     '"button" instead of "key"',
     'the correct word ("key" for "press the G button")'),
    ("false_friend", "false friend", "An English word that looks like a Spanish word but means something else.",
     '"actually" instead of "currently"',
     'the false friend used, never the correct word ("actually" for "I am actually working on it", meant as '
     '"currently")'),
    ("countability", "countability", "An uncountable noun used with a/an or in the plural.",
     '"a research" instead of "research"',
     'the noun in its correct form ("research" for "a research", "information" for "informations")'),
    ("missing_subject", "missing subject", 'A clause without its subject, as Spanish allows ("es importante").',
     '"is important" instead of "it is important"',
     'the missing subject ("it" for "is important to test")'),
    ("verb_pattern", "verb pattern",
     "The wrong form after a verb or a preposition: to-infinitive, base form, -ing or that-clause.",
     '"I want that you check" instead of "I want you to check"',
     'the word and the form it takes ("want + object + to-infinitive" for "I want that you check")'),
    ("question_form", "question form",
     "A direct question without inversion or do, or an indirect question in question order.",
     '"tell me what is it" instead of "tell me what it is"',
     'the rule broken: "no inversion in a direct question", "question order in an indirect question", '
     '"missing do/does/did" or "missing if/whether"'),
    ("other", "other", "Any mistake that fits none of the types above.", None,
     "a short description of the mistake"),
)
VERSION = 2
# Types that version 2 adds, and the word_choice text of version 1 that version 2 rewrites.
ADDED_IN_2 = ("false_friend", "countability", "missing_subject", "verb_pattern", "question_form")
WORD_CHOICE_1 = ("A real English word that does not mean what you meant, false friends included.",
                 '"actually" instead of "currently"',
                 'the correct word, false friends included ("currently" for "actually")')


class NewerDatabaseError(Exception):
    """The database file is at a version newer than VERSION, written by a newer grammar tracker."""


@dataclass
class MistakeType:
    key: str
    label: str
    description: str
    example: str | None
    identifier_rule: str
    position: int
    deleted_at: str | None


@dataclass
class SavedOccurrence:
    type: str
    type_label: str
    type_description: str
    type_example: str | None
    identifier: str
    original: str
    corrected: str
    count: int


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5, isolation_level=None)
    try:
        _migrate(conn)
    except BaseException:
        conn.close()
        raise
    conn.execute("PRAGMA foreign_keys = ON")
    conn.isolation_level = ""
    return conn


def _check_not_newer(version):
    if version > VERSION:
        raise NewerDatabaseError(f"grammar.db is at version {version}, and this grammar tracker reads version {VERSION}"
                                 f" or older. Update the grammar-tracker mod.")


def _migrate(conn):
    """Bring the database to VERSION in one transaction. A database at VERSION is not locked. Otherwise the write
    lock is taken before the version is read again, so concurrent hooks migrate once. Foreign keys stay off until
    the mistakes table is rebuilt. A database newer than VERSION raises NewerDatabaseError and stays unchanged."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    _check_not_newer(version)
    if version == VERSION:
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        _check_not_newer(version)
        if version == VERSION:
            conn.execute("COMMIT")
            return
        if version == 0:
            _create(conn)
        else:
            _add_types_of_2(conn)
        if conn.execute("PRAGMA foreign_key_check").fetchall():
            raise sqlite3.IntegrityError("foreign key check failed after migration")
        conn.execute(f"PRAGMA user_version = {VERSION}")
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise



def _create(conn):
    """Create the tables and seed the types. An existing mistakes table is rebuilt with a foreign key to
    mistake_types; its unknown types become 'other' and the rows that then collide are merged."""
    for statement in SCHEMA:
        conn.execute(statement)
    conn.executemany("INSERT INTO mistake_types (key, label, description, example, identifier_rule, position)"
                     " VALUES (?, ?, ?, ?, ?, ?)", [(*row, i) for i, row in enumerate(SEED, 1)])
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mistakes'").fetchone():
        conn.execute(MISTAKES_DDL.format(name="mistakes_new"))
        resolved = "CASE WHEN {0}.type IN (SELECT key FROM mistake_types) THEN {0}.type ELSE 'other' END"
        conn.execute(f"INSERT INTO mistakes_new (id, type, identifier)"
                     f" SELECT MIN(id), {resolved.format('m')}, identifier FROM mistakes m GROUP BY 2, 3")
        conn.execute(f"UPDATE occurrences SET mistake_id = (SELECT n.id FROM mistakes o JOIN mistakes_new n"
                     f" ON n.type = {resolved.format('o')} AND n.identifier = o.identifier"
                     f" WHERE o.id = occurrences.mistake_id)")
        conn.execute("DROP TABLE mistakes")
        conn.execute("ALTER TABLE mistakes_new RENAME TO mistakes")
    else:
        conn.execute(MISTAKES_DDL.format(name="mistakes"))


def _add_types_of_2(conn):
    """Add the version 2 types after the last type that is not 'other', and keep 'other' last. word_choice gets its
    version 2 text only while it still has the version 1 text, so edits stay."""
    (last,) = conn.execute("SELECT MAX(position) FROM mistake_types WHERE key != 'other'").fetchone()
    rows = [row for row in SEED if row[0] in ADDED_IN_2]
    conn.executemany("INSERT OR IGNORE INTO mistake_types (key, label, description, example, identifier_rule,"
                     " position) VALUES (?, ?, ?, ?, ?, ?)", [(*row, last + i) for i, row in enumerate(rows, 1)])
    conn.execute("UPDATE mistake_types SET position = ? WHERE key = 'other'", (last + len(rows) + 1,))
    word_choice = next(row for row in SEED if row[0] == "word_choice")
    conn.execute("UPDATE mistake_types SET description = ?, example = ?, identifier_rule = ?"
                 " WHERE key = 'word_choice' AND description = ? AND example = ? AND identifier_rule = ?",
                 (*word_choice[2:], *WORD_CHOICE_1))

def _types(conn, where=""):
    rows = conn.execute(f"SELECT key, label, description, example, identifier_rule, position, deleted_at"
                        f" FROM mistake_types {where} ORDER BY position").fetchall()
    return [MistakeType(*row) for row in rows]


def active_types(conn):
    return _types(conn, "WHERE deleted_at IS NULL")


def all_types(conn):
    return _types(conn)


def save_check(conn, *, prompt_uuid, session_id, created_at, project_dir, original, check):
    """Save a prompt and its mistakes. Return the saved occurrences with their total counts,
    or None when the prompt is already saved."""
    with conn:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO prompts (prompt_uuid, session_id, created_at, project_dir, input_mode, original,"
            " corrected) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (prompt_uuid, session_id, created_at, project_dir, check.input_mode, original, check.corrected_prompt),
        )
        if cursor.rowcount == 0:
            return None
        prompt_id = cursor.lastrowid
        mistake_ids = []
        types = []
        for mistake in check.mistakes:
            known = conn.execute("SELECT 1 FROM mistake_types WHERE key = ? AND deleted_at IS NULL",
                                 (mistake.type,)).fetchone()
            type_ = mistake.type if known else "other"
            conn.execute("INSERT OR IGNORE INTO mistakes (type, identifier) VALUES (?, ?)",
                         (type_, mistake.identifier))
            (mistake_id,) = conn.execute("SELECT id FROM mistakes WHERE type = ? AND identifier = ?",
                                         (type_, mistake.identifier)).fetchone()
            types.append(type_)
            conn.execute("INSERT INTO occurrences (prompt_id, mistake_id, original_sentence, corrected_sentence)"
                         " VALUES (?, ?, ?, ?)", (prompt_id, mistake_id, mistake.original, mistake.corrected))
            mistake_ids.append(mistake_id)
    return [
        SavedOccurrence(*conn.execute("SELECT key, label, description, example FROM mistake_types WHERE key = ?",
                                      (type_,)).fetchone(),
                        m.identifier, m.original, m.corrected,
                        conn.execute("SELECT COUNT(*) FROM occurrences WHERE mistake_id = ?", (mid,)).fetchone()[0])
        for m, type_, mid in zip(check.mistakes, types, mistake_ids)
    ]


def top_mistakes(conn, limit):
    """Return the most frequent mistakes across all prompts, each with its latest occurrence as the example."""
    rows = conn.execute(
        "SELECT t.key, t.label, t.description, t.example, m.identifier, latest.original_sentence,"
        " latest.corrected_sentence, counts.n"
        " FROM (SELECT mistake_id, COUNT(*) AS n, MAX(id) AS latest_id FROM occurrences GROUP BY mistake_id) counts"
        " JOIN mistakes m ON m.id = counts.mistake_id"
        " JOIN mistake_types t ON t.key = m.type"
        " JOIN occurrences latest ON latest.id = counts.latest_id"
        " ORDER BY counts.n DESC, counts.latest_id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [SavedOccurrence(*row) for row in rows]
