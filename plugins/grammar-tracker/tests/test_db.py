import sqlite3

import pytest

from lib.db import (ADDED_IN_2, VERSION, WORD_CHOICE_1, NewerDatabaseError, active_types, all_types, connect,
                    save_check, top_mistakes)
from lib.transcript import Check, Mistake


OLD_SCHEMA = """
CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY,
    prompt_uuid TEXT NOT NULL UNIQUE,
    session_id TEXT,
    created_at TEXT NOT NULL,
    project_dir TEXT,
    input_mode TEXT CHECK (input_mode IN ('typed', 'dictated')),
    original TEXT NOT NULL,
    corrected TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    identifier TEXT NOT NULL,
    UNIQUE (type, identifier)
);
CREATE TABLE IF NOT EXISTS occurrences (
    id INTEGER PRIMARY KEY,
    prompt_id INTEGER NOT NULL REFERENCES prompts (id),
    mistake_id INTEGER NOT NULL REFERENCES mistakes (id),
    original_sentence TEXT NOT NULL,
    corrected_sentence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS occurrences_mistake ON occurrences (mistake_id);
"""

SEED_KEYS = ["spelling", "irregular_verb", "phrasal_verb", "wrong_tense", "malformed_tense", "word_order",
             "native_expression", "preposition", "article", "agreement", "word_choice", "false_friend", "countability",
             "missing_subject", "verb_pattern", "question_form", "other"]


def old_database(path, mistakes, occurrences, prompts=2):
    """Build a version 0 database: mistakes are (id, type, identifier), occurrences (prompt_id, mistake_id)."""
    old = sqlite3.connect(path)
    old.executescript(OLD_SCHEMA)
    for i in range(1, prompts + 1):
        old.execute("INSERT INTO prompts (prompt_uuid, session_id, created_at, project_dir, input_mode, original,"
                    " corrected) VALUES (?, 's', '2026-10-17T12:00:00Z', '/p', 'typed', ?, ?)",
                    (f"u{i}", f"original{i}", f"corrected{i}"))
    old.executemany("INSERT INTO mistakes (id, type, identifier) VALUES (?, ?, ?)", mistakes)
    old.executemany("INSERT INTO occurrences (prompt_id, mistake_id, original_sentence, corrected_sentence)"
                    " VALUES (?, ?, 'o', 'c')", occurrences)
    old.commit()
    old.close()


def check(*mistakes):
    return Check(input_mode="typed", corrected_prompt="corrected", mistakes=list(mistakes))


def m(type_, identifier, n="", reason=None):
    return Mistake(type=type_, identifier=identifier, original=f"orig{n}", corrected=f"fix{n}", reason=reason)


def save(conn, uuid, c):
    return save_check(conn, prompt_uuid=uuid, session_id="s", created_at="2026-10-17T12:00:00Z",
                      project_dir="/p", original="original", check=c)


def test_counts_every_occurrence_across_prompts(tmp_path):
    conn = connect(tmp_path / "g.db")
    save(conn, "u1", check(m("article", "the", 1), m("article", "the", 2)))
    saved = save(conn, "u2", check(m("article", "the", 3), m("spelling", "necessity", 4)))
    assert [(o.type, o.type_label, o.identifier, o.original, o.count) for o in saved] == [
        ("article", "article", "the", "orig3", 3),
        ("spelling", "spelling", "necessity", "orig4", 1),
    ]


def test_same_prompt_is_saved_once(tmp_path):
    conn = connect(tmp_path / "g.db")
    assert save(conn, "u1", check(m("article", "the"))) is not None
    assert save(conn, "u1", check(m("article", "the"))) is None
    assert conn.execute("SELECT COUNT(*) FROM occurrences").fetchone()[0] == 1


def test_mistake_free_prompt_is_saved(tmp_path):
    conn = connect(tmp_path / "g.db")
    assert save(conn, "u1", check()) == []
    assert conn.execute("SELECT corrected FROM prompts").fetchone()[0] == "corrected"


def test_top_mistakes_ranks_by_count_with_latest_example(tmp_path):
    conn = connect(tmp_path / "g.db")
    save(conn, "u1", check(m("article", "the", 1), m("spelling", "necessity", 2)))
    save(conn, "u2", check(m("article", "the", 3), m("preposition", "depend on", 4)))
    save(conn, "u3", check(m("preposition", "depend on", 5), m("article", "the", 6)))
    assert [(o.type, o.type_label, o.identifier, o.original, o.corrected, o.count)
            for o in top_mistakes(conn, 2)] == [
        ("article", "article", "the", "orig6", "fix6", 3),
        ("preposition", "preposition", "depend on", "orig5", "fix5", 2),
    ]


def test_reason_is_saved_and_reported_with_the_latest_example(tmp_path):
    conn = connect(tmp_path / "g.db")
    saved = save(conn, "u1", check(m("article", "the", 1, "a known remote"), m("spelling", "necessity", 2)))
    assert [o.reason for o in saved] == ["a known remote", None]
    save(conn, "u2", check(m("article", "the", 3, "one specific file")))
    assert [(o.identifier, o.reason) for o in top_mistakes(conn, 10)] == [
        ("the", "one specific file"), ("necessity", None)]


def test_top_mistakes_empty_database(tmp_path):
    assert top_mistakes(connect(tmp_path / "g.db"), 10) == []


def occurrence_columns(conn):
    return [row[1] for row in conn.execute("PRAGMA table_info(occurrences)")]


def test_new_database_has_seed_types_and_version_3(tmp_path):
    conn = connect(tmp_path / "g.db")
    types = {t.key: t for t in all_types(conn)}
    assert list(types) == SEED_KEYS
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
    assert "reason" in occurrence_columns(conn)
    assert types["word_choice"].description == "A real English word that does not mean what you meant."
    assert types["false_friend"].example == '"actually" instead of "currently"'
    assert types["other"].example is None


def test_migration_keeps_every_saved_row(tmp_path):
    path = tmp_path / "g.db"
    old_database(path, [(1, "article", "the"), (2, "spelling", "necessity")], [(1, 1), (1, 2), (2, 1)])
    queries = ["SELECT * FROM prompts", "SELECT id, type, identifier FROM mistakes",
               "SELECT id, prompt_id, mistake_id, original_sentence, corrected_sentence FROM occurrences"]
    old = sqlite3.connect(path)
    before = [old.execute(q).fetchall() for q in queries]
    old.close()
    conn = connect(path)
    assert [conn.execute(q).fetchall() for q in queries] == before
    assert conn.execute("SELECT DISTINCT reason FROM occurrences").fetchall() == [(None,)]
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_migration_rewrites_unknown_type_to_other_and_merges(tmp_path):
    path = tmp_path / "g.db"
    old_database(path, [(1, "Idioms", "x"), (2, "other", "x")], [(1, 1), (2, 2)])
    conn = connect(path)
    assert conn.execute("SELECT type, identifier FROM mistakes").fetchall() == [("other", "x")]
    (kept,) = conn.execute("SELECT id FROM mistakes").fetchone()
    assert conn.execute("SELECT mistake_id FROM occurrences ORDER BY id").fetchall() == [(kept,), (kept,)]
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def version_2_database(path):
    """Build a version 2 database: occurrences without the reason column, and one saved word_choice mistake."""
    conn = connect(path)
    save(conn, "u1", check(m("word_choice", "currently")))
    conn.execute("ALTER TABLE occurrences DROP COLUMN reason")
    conn.execute("PRAGMA user_version = 2")
    conn.commit()
    return conn


def version_1_database(path, word_choice=WORD_CHOICE_1):
    """Build a version 1 database: the version 1 types, 'other' at position 12, and one saved word_choice mistake."""
    conn = version_2_database(path)
    conn.execute(f"DELETE FROM mistake_types WHERE key IN {ADDED_IN_2}")
    conn.execute("UPDATE mistake_types SET position = 12 WHERE key = 'other'")
    conn.execute("UPDATE mistake_types SET description = ?, example = ?, identifier_rule = ? WHERE key = 'word_choice'",
                 word_choice)
    conn.execute("PRAGMA user_version = 1")
    conn.commit()
    conn.close()


def test_migration_from_2_adds_reason(tmp_path):
    version_2_database(tmp_path / "g.db").close()
    conn = connect(tmp_path / "g.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
    assert conn.execute("SELECT original_sentence, reason FROM occurrences").fetchall() == [("orig", None)]
    assert [o.reason for o in save(conn, "u2", check(m("article", "the", reason="a known remote")))] == [
        "a known remote"]


def test_migration_from_1_adds_types_before_other(tmp_path):
    version_1_database(tmp_path / "g.db")
    conn = connect(tmp_path / "g.db")
    types = all_types(conn)
    assert [t.key for t in types] == SEED_KEYS
    assert [t.position for t in types] == list(range(1, 18))
    assert types[10].description == "A real English word that does not mean what you meant."
    assert conn.execute("SELECT type, identifier FROM mistakes").fetchall() == [("word_choice", "currently")]
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
    assert "reason" in occurrence_columns(conn)


def test_migration_from_1_keeps_edited_word_choice(tmp_path):
    version_1_database(tmp_path / "g.db", ("mine", *WORD_CHOICE_1[1:]))
    conn = connect(tmp_path / "g.db")
    assert conn.execute("SELECT description, example FROM mistake_types WHERE key = 'word_choice'").fetchone() == (
        "mine", WORD_CHOICE_1[1])


def test_connect_twice_changes_nothing(tmp_path):
    connect(tmp_path / "g.db").close()
    conn = connect(tmp_path / "g.db")
    assert len(all_types(conn)) == 17
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3


def test_connect_on_migrated_database_from_second_connection_changes_nothing(tmp_path):
    first = connect(tmp_path / "g.db")
    second = connect(tmp_path / "g.db")
    assert len(all_types(first)) == len(all_types(second)) == 17


def test_connect_enables_foreign_keys(tmp_path):
    assert connect(tmp_path / "g.db").execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_seed_never_overwrites_edits(tmp_path):
    conn = connect(tmp_path / "g.db")
    conn.execute("UPDATE mistake_types SET description = 'mine' WHERE key = 'article'")
    conn.commit()
    conn.close()
    conn = connect(tmp_path / "g.db")
    assert conn.execute("SELECT description FROM mistake_types WHERE key = 'article'").fetchone()[0] == "mine"


def delete_type(conn, key):
    conn.execute("UPDATE mistake_types SET deleted_at = '2026-10-18T00:00:00Z' WHERE key = ?", (key,))
    conn.commit()


def test_active_types_leave_out_deleted(tmp_path):
    conn = connect(tmp_path / "g.db")
    delete_type(conn, "spelling")
    assert "spelling" not in [t.key for t in active_types(conn)]
    assert "spelling" in [t.key for t in all_types(conn)]


def test_save_check_resolves_unknown_deleted_and_miscased_keys(tmp_path):
    conn = connect(tmp_path / "g.db")
    delete_type(conn, "spelling")
    saved = save(conn, "u1", check(m("Idioms", "a"), m("spelling", "b"), m("Article", "c"), m("article", "d")))
    assert [o.type for o in saved] == ["other", "other", "other", "article"]


def test_deleted_type_keeps_its_label_on_saved_mistakes(tmp_path):
    conn = connect(tmp_path / "g.db")
    save(conn, "u1", check(m("phrasal_verb", "get out")))
    delete_type(conn, "phrasal_verb")
    top = top_mistakes(conn, 10)[0]
    assert (top.type, top.type_label, top.type_description) == (
        "phrasal_verb", "phrasal verb", "The wrong verb + particle combination for the meaning.")


def test_migrated_database_connects_while_another_connection_holds_the_write_lock(tmp_path):
    connect(tmp_path / "g.db").close()
    writer = sqlite3.connect(tmp_path / "g.db", isolation_level=None)
    writer.execute("BEGIN IMMEDIATE")
    try:
        assert len(all_types(connect(tmp_path / "g.db"))) == 17
    finally:
        writer.execute("ROLLBACK")


def test_failed_migration_rolls_back(tmp_path):
    path = tmp_path / "g.db"
    old_database(path, [(1, "article", "the")], [(1, 99)])
    with pytest.raises(sqlite3.IntegrityError):
        connect(path)
    old = sqlite3.connect(path)
    assert old.execute("PRAGMA user_version").fetchone()[0] == 0
    assert old.execute("SELECT id, type, identifier FROM mistakes").fetchall() == [(1, "article", "the")]
    assert old.execute("SELECT 1 FROM sqlite_master WHERE name IN ('mistake_types', 'mistakes_new')").fetchall() == []


def test_newer_database_is_refused_and_left_unchanged(tmp_path):
    path = tmp_path / "g.db"
    connect(path).close()
    newer = sqlite3.connect(path)
    newer.execute(f"PRAGMA user_version = {VERSION + 1}")
    newer.execute("DELETE FROM mistake_types WHERE key = 'false_friend'")
    newer.commit()
    newer.close()
    with pytest.raises(NewerDatabaseError, match=f"version {VERSION + 1}.*version {VERSION}"):
        connect(path)
    after = sqlite3.connect(path)
    assert after.execute("PRAGMA user_version").fetchone()[0] == VERSION + 1
    assert after.execute("SELECT 1 FROM mistake_types WHERE key = 'false_friend'").fetchall() == []
