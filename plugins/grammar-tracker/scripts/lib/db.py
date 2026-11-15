import sqlite3
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path

from lib.mistake_types import ADDED_IN_2, ADDED_IN_6, ROMANCE_TEXTS_5, SEED, SPANISH_TEXTS_4, WORD_CHOICE_1
from lib.transcript import Check

# turn_id is the engine's key for the turn and the dedupe key. prompt_uuid is the prompt's uuid in the transcript,
# empty until `query.py rekey` finds it. clean_streak is the number of prompts in a row with no mistakes, across every
# conversation, that ends at this prompt: 0 for a prompt with mistakes.
PROMPTS_DDL = """CREATE TABLE {name} (
    id INTEGER PRIMARY KEY,
    turn_id TEXT UNIQUE,
    prompt_uuid TEXT UNIQUE,
    session_id TEXT,
    created_at TEXT NOT NULL,
    project_dir TEXT,
    input_mode TEXT CHECK (input_mode IN ('typed', 'dictated')),
    original TEXT NOT NULL,
    corrected TEXT NOT NULL,
    clean_streak INTEGER NOT NULL DEFAULT 0
)"""
SCHEMA = (
    PROMPTS_DDL.format(name="IF NOT EXISTS prompts"),
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
        corrected_sentence TEXT NOT NULL,
        reason TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS occurrences_mistake ON occurrences (mistake_id)",
)
MISTAKES_DDL = """CREATE TABLE {name} (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL REFERENCES mistake_types (key),
    identifier TEXT NOT NULL,
    UNIQUE (type, identifier)
)"""

VERSION = 7


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
    reason: str | None
    count: int


def connect(path: str | Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5, isolation_level=None)
    try:
        _migrate(conn)
    except BaseException:
        conn.close()
        raise
    conn.execute("PRAGMA foreign_keys = ON")
    conn.isolation_level = "DEFERRED"
    return conn


def _check_not_newer(version: int) -> None:
    if version > VERSION:
        raise NewerDatabaseError(
            f"grammar.db is at version {version}, and this grammar tracker reads version {VERSION}"
            f" or older. Update the grammar-tracker mod."
        )


def _migrate(conn: sqlite3.Connection) -> None:
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
        if version == 1:
            _add_types_of_2(conn)
        _add_reason(conn)
        _add_turn_id(conn)
        _remove_spanish(conn)
        if version <= 5:
            _cover_romance(conn)
        if version <= 6:
            _add_clean_streak(conn)
        if conn.execute("PRAGMA foreign_key_check").fetchall():
            raise sqlite3.IntegrityError("foreign key check failed after migration")
        conn.execute(f"PRAGMA user_version = {VERSION}")
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def _create(conn: sqlite3.Connection) -> None:
    """Create the tables and seed the types. An existing mistakes table is rebuilt with a foreign key to
    mistake_types; its unknown types become 'other' and the rows that then collide are merged."""
    for statement in SCHEMA:
        conn.execute(statement)
    conn.executemany(
        "INSERT INTO mistake_types (key, label, description, example, identifier_rule, position)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        [(*row, i) for i, row in enumerate(SEED, 1)],
    )
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mistakes'").fetchone():
        conn.execute(MISTAKES_DDL.format(name="mistakes_new"))
        resolved = "CASE WHEN {0}.type IN (SELECT key FROM mistake_types) THEN {0}.type ELSE 'other' END"
        conn.execute(
            f"INSERT INTO mistakes_new (id, type, identifier)"
            f" SELECT MIN(id), {resolved.format('m')}, identifier FROM mistakes m GROUP BY 2, 3"
        )
        conn.execute(
            f"UPDATE occurrences SET mistake_id = (SELECT n.id FROM mistakes o JOIN mistakes_new n"
            f" ON n.type = {resolved.format('o')} AND n.identifier = o.identifier"
            f" WHERE o.id = occurrences.mistake_id)"
        )
        conn.execute("DROP TABLE mistakes")
        conn.execute("ALTER TABLE mistakes_new RENAME TO mistakes")
    else:
        conn.execute(MISTAKES_DDL.format(name="mistakes"))


def _add_types_of_2(conn: sqlite3.Connection) -> None:
    """Add the version 2 types after the last type that is not 'other', and keep 'other' last. word_choice gets its
    version 2 text only while it still has the version 1 text, so edits stay."""
    _add_before_other(conn, ADDED_IN_2)
    word_choice = next(row for row in SEED if row[0] == "word_choice")
    conn.execute(
        "UPDATE mistake_types SET description = ?, example = ?, identifier_rule = ?"
        " WHERE key = 'word_choice' AND description = ? AND example = ? AND identifier_rule = ?",
        (*word_choice[2:], *WORD_CHOICE_1),
    )


def _add_before_other(conn: sqlite3.Connection, keys: Collection[str]) -> None:
    """Add the SEED types of `keys` after the last type that is not 'other', and keep 'other' last."""
    (last,) = conn.execute("SELECT MAX(position) FROM mistake_types WHERE key != 'other'").fetchone()
    rows = [row for row in SEED if row[0] in keys]
    conn.executemany(
        "INSERT OR IGNORE INTO mistake_types (key, label, description, example, identifier_rule,"
        " position) VALUES (?, ?, ?, ?, ?, ?)",
        [(*row, last + i) for i, row in enumerate(rows, 1)],
    )
    conn.execute("UPDATE mistake_types SET position = ? WHERE key = 'other'", (last + len(rows) + 1,))


def _rewrite_unedited(conn: sqlite3.Connection, old_texts: dict[str, tuple[str, str]]) -> None:
    """Give each type of `old_texts` its SEED description and identifier rule, only while it still has the old text
    that `old_texts` maps it to, so edits stay."""
    seed = {row[0]: row for row in SEED}
    conn.executemany(
        "UPDATE mistake_types SET description = ?, identifier_rule = ?"
        " WHERE key = ? AND description = ? AND identifier_rule = ?",
        [(seed[key][2], seed[key][4], key, *old) for key, old in old_texts.items()],
    )


def _cover_romance(conn: sqlite3.Connection) -> None:
    """Add the version 6 types before 'other' and give the types of ROMANCE_TEXTS_5 their version 6 text."""
    _add_before_other(conn, ADDED_IN_6)
    _rewrite_unedited(conn, ROMANCE_TEXTS_5)


def _remove_spanish(conn: sqlite3.Connection) -> None:
    """Give the types of SPANISH_TEXTS_4 their version 5 text, which names no language. A type gets it only while it
    still has its version 4 text, so edits stay."""
    _rewrite_unedited(conn, SPANISH_TEXTS_4)


def _add_reason(conn: sqlite3.Connection) -> None:
    """Add the reason column of version 3 to occurrences. Occurrences saved before it have no reason."""
    columns = [row[1] for row in conn.execute("PRAGMA table_info(occurrences)")]
    if "reason" not in columns:
        conn.execute("ALTER TABLE occurrences ADD COLUMN reason TEXT")


def _add_turn_id(conn: sqlite3.Connection) -> None:
    """Rebuild prompts of versions before 4 with the turn_id column and a nullable prompt_uuid. Rows keep their ids,
    so occurrences stay linked, and their prompt_uuid."""
    columns = [row[1] for row in conn.execute("PRAGMA table_info(prompts)")]
    if "turn_id" in columns:
        return
    conn.execute(PROMPTS_DDL.format(name="prompts_new"))
    conn.execute(
        "INSERT INTO prompts_new (id, prompt_uuid, session_id, created_at, project_dir, input_mode, original,"
        " corrected) SELECT id, prompt_uuid, session_id, created_at, project_dir, input_mode, original,"
        " corrected FROM prompts"
    )
    conn.execute("DROP TABLE prompts")
    conn.execute("ALTER TABLE prompts_new RENAME TO prompts")


def _add_clean_streak(conn: sqlite3.Connection) -> None:
    """Add the clean_streak column of version 7 to prompts and count it for every saved prompt."""
    columns = [row[1] for row in conn.execute("PRAGMA table_info(prompts)")]
    if "clean_streak" not in columns:
        conn.execute("ALTER TABLE prompts ADD COLUMN clean_streak INTEGER NOT NULL DEFAULT 0")
    _count_streaks(conn, "")


def _count_streaks(conn: sqlite3.Connection, since: str) -> None:
    """Count clean_streak again for the prompts sent at `since` or later, in the order they were sent, from the streak
    of the prompt sent before them. A prompt whose check is saved after a later prompt's thus fixes the ones after it."""
    row = conn.execute(
        "SELECT clean_streak FROM prompts WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT 1", (since,)
    ).fetchone()
    streak = row[0] if row else 0
    prompts = conn.execute(
        "SELECT p.id, EXISTS (SELECT 1 FROM occurrences o WHERE o.prompt_id = p.id) FROM prompts p"
        " WHERE p.created_at >= ? ORDER BY p.created_at, p.id",
        (since,),
    ).fetchall()
    updates = []
    for prompt_id, has_mistakes in prompts:
        streak = 0 if has_mistakes else streak + 1
        updates.append((streak, prompt_id))
    conn.executemany("UPDATE prompts SET clean_streak = ? WHERE id = ?", updates)


@dataclass
class Streak:
    """The clean streak that ends at a prompt, and the longest one of the prompts sent before it."""

    current: int
    best_before: int


def streak_of(conn: sqlite3.Connection, turn_id: str) -> Streak | None:
    """Return the clean streak of the prompt saved for `turn_id`, or None when no prompt has that turn id."""
    row = conn.execute("SELECT clean_streak, created_at, id FROM prompts WHERE turn_id = ?", (turn_id,)).fetchone()
    if row is None:
        return None
    current, created_at, prompt_id = row
    (best_before,) = conn.execute(
        "SELECT COALESCE(MAX(clean_streak), 0) FROM prompts WHERE created_at < ? OR (created_at = ? AND id < ?)",
        (created_at, created_at, prompt_id),
    ).fetchone()
    return Streak(current, best_before)


def _types(conn: sqlite3.Connection, where: str = "") -> list[MistakeType]:
    rows = conn.execute(
        f"SELECT key, label, description, example, identifier_rule, position, deleted_at"
        f" FROM mistake_types {where} ORDER BY position"
    ).fetchall()
    return [MistakeType(*row) for row in rows]


def active_types(conn: sqlite3.Connection) -> list[MistakeType]:
    return _types(conn, "WHERE deleted_at IS NULL")


def all_types(conn: sqlite3.Connection) -> list[MistakeType]:
    return _types(conn)


def save_check(
    conn: sqlite3.Connection,
    *,
    turn_id: str,
    session_id: str | None,
    created_at: str,
    project_dir: str | None,
    original: str,
    check: Check,
    prompt_uuid: str | None = None,
) -> list[SavedOccurrence] | None:
    """Save a prompt and its mistakes. Return the saved occurrences with their total counts,
    or None when the turn is already saved."""
    with conn:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO prompts (turn_id, prompt_uuid, session_id, created_at, project_dir, input_mode,"
            " original, corrected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                turn_id,
                prompt_uuid,
                session_id,
                created_at,
                project_dir,
                check.input_mode,
                original,
                check.corrected_prompt,
            ),
        )
        if cursor.rowcount == 0:
            return None
        prompt_id = cursor.lastrowid
        mistake_ids: list[int] = []
        types: list[str] = []
        for mistake in check.mistakes:
            known = conn.execute(
                "SELECT 1 FROM mistake_types WHERE key = ? AND deleted_at IS NULL", (mistake.type,)
            ).fetchone()
            type_ = mistake.type if known else "other"
            conn.execute("INSERT OR IGNORE INTO mistakes (type, identifier) VALUES (?, ?)", (type_, mistake.identifier))
            (mistake_id,) = conn.execute(
                "SELECT id FROM mistakes WHERE type = ? AND identifier = ?", (type_, mistake.identifier)
            ).fetchone()
            types.append(type_)
            conn.execute(
                "INSERT INTO occurrences (prompt_id, mistake_id, original_sentence, corrected_sentence,"
                " reason) VALUES (?, ?, ?, ?, ?)",
                (prompt_id, mistake_id, mistake.original, mistake.corrected, mistake.reason),
            )
            mistake_ids.append(mistake_id)
        _count_streaks(conn, created_at)
    saved = []
    for m, type_, mid in zip(check.mistakes, types, mistake_ids, strict=True):
        key, label, description, example = conn.execute(
            "SELECT key, label, description, example FROM mistake_types WHERE key = ?", (type_,)
        ).fetchone()
        (count,) = conn.execute("SELECT COUNT(*) FROM occurrences WHERE mistake_id = ?", (mid,)).fetchone()
        saved.append(
            SavedOccurrence(key, label, description, example, m.identifier, m.original, m.corrected, m.reason, count)
        )
    return saved


@dataclass
class RankedMistake(SavedOccurrence):
    """A saved mistake with its latest occurrence as the example, and `recent`, its occurrences in the prompts sent at
    the `since` time or later."""

    recent: int


_RANKED = (
    "SELECT * FROM (SELECT t.key, t.label, t.description, t.example, m.identifier, latest.original_sentence,"
    " latest.corrected_sentence, latest.reason, stats.n, stats.recent, stats.latest_id"
    " FROM (SELECT o.mistake_id, COUNT(*) AS n, MAX(o.id) AS latest_id, SUM(p.created_at >= :since) AS recent"
    " FROM occurrences o JOIN prompts p ON p.id = o.prompt_id GROUP BY o.mistake_id) stats"
    " JOIN mistakes m ON m.id = stats.mistake_id"
    " JOIN mistake_types t ON t.key = m.type"
    " JOIN occurrences latest ON latest.id = stats.latest_id)"
)


def _ranked(conn: sqlite3.Connection, rest: str, **params: str | int) -> list[RankedMistake]:
    rows = conn.execute(f"{_RANKED} {rest}", {"since": "", **params}).fetchall()
    return [RankedMistake(*row[:-1]) for row in rows]


def top_mistakes(conn: sqlite3.Connection, limit: int, since: str = "") -> list[RankedMistake]:
    """Return the most frequent mistakes across all prompts, each with its latest occurrence as the example."""
    return _ranked(conn, "ORDER BY n DESC, latest_id DESC LIMIT :limit", limit=limit, since=since)


def _prompts_around(conn: sqlite3.Connection, since: str) -> tuple[int, int]:
    """Count the prompts sent at `since` or later, and the ones sent before."""
    recent, earlier = conn.execute(
        "SELECT COALESCE(SUM(created_at >= ?), 0), COALESCE(SUM(created_at < ?), 0) FROM prompts", (since, since)
    ).fetchone()
    return recent, earlier


@dataclass
class Rising:
    mistake: RankedMistake
    # How many more times the mistake occurred since the `since` time than its rate before it predicts, rounded.
    above_usual: int


def rising_mistake(conn: sqlite3.Connection, since: str) -> Rising | None:
    """Return the mistake that occurred most above its usual rate in the prompts sent at `since` or later: its
    occurrences there minus the ones its rate in the earlier prompts predicts. It must occur at least twice there and
    at least one time above that rate. None when no prompt was sent before `since`, which leaves no rate to compare."""
    recent_prompts, earlier_prompts = _prompts_around(conn, since)
    if earlier_prompts == 0:
        return None
    best: tuple[float, int, RankedMistake] | None = None
    for o in _ranked(conn, "WHERE recent >= 2 ORDER BY latest_id DESC", since=since):
        above = o.recent - (o.count - o.recent) * recent_prompts / earlier_prompts
        if above >= 1 and (best is None or (above, o.recent) > best[:2]):
            best = (above, o.recent, o)
    return None if best is None else Rising(best[2], round(best[0]))


def fading_mistake(conn: sqlite3.Connection, threshold: int, since: str) -> RankedMistake | None:
    """Return the most frequent recurring mistake (a counter of `threshold` or more) that no prompt sent at `since` or
    later made. None when no prompt was sent since then, which shows nothing about the mistake."""
    if _prompts_around(conn, since)[0] == 0:
        return None
    found = _ranked(
        conn,
        "WHERE n >= :threshold AND recent = 0 ORDER BY n DESC, latest_id DESC LIMIT 1",
        threshold=threshold,
        since=since,
    )
    return found[0] if found else None


@dataclass
class Totals:
    mistakes: int
    prompts: int
    clean_prompts: int
    recurring: int


def totals(conn: sqlite3.Connection, threshold: int) -> Totals:
    """Count every saved occurrence, every saved prompt, the prompts with no mistake, and the mistakes whose counter
    reaches `threshold`."""
    row = conn.execute(
        "SELECT (SELECT COUNT(*) FROM occurrences), (SELECT COUNT(*) FROM prompts),"
        " (SELECT COUNT(*) FROM prompts p WHERE NOT EXISTS (SELECT 1 FROM occurrences o WHERE o.prompt_id = p.id)),"
        " (SELECT COUNT(*) FROM (SELECT 1 FROM occurrences GROUP BY mistake_id HAVING COUNT(*) >= ?))",
        (threshold,),
    ).fetchone()
    return Totals(*row)
