import json
import subprocess
import sys

from conftest import ROOT, assistant, script_env, user
from lib.db import connect, save_check
from lib.rekey import rekey
from lib.transcript import Check


def at(uuid, text, timestamp):
    return {**user(uuid, text), "timestamp": timestamp}


def write(projects, session, entries):
    path = projects / "-p" / f"{session}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(e) + "\n" for e in entries))


def save(conn, turn, original, created_at, session="s1"):
    save_check(conn, turn_id=turn, session_id=session, created_at=created_at, project_dir="/p", original=original,
               check=Check(input_mode="typed", corrected_prompt="c", mistakes=[]))


def uuids(conn):
    return conn.execute("SELECT turn_id, prompt_uuid FROM prompts ORDER BY id").fetchall()


def test_rekey_takes_the_entry_with_the_same_text_and_the_closest_time(tmp_path):
    projects = tmp_path / "projects"
    write(projects, "s1", [at("u1", "fix it", "2026-10-17T12:00:00.000Z"), assistant("a1", "ok"),
                           at("u2", "fix it", "2026-10-17T12:05:00.000Z"), at("u3", "other", "2026-10-17T12:05:01.000Z")])
    conn = connect(tmp_path / "g.db")
    save(conn, "t1", "fix it", "2026-10-17T12:05:00.400Z")
    assert rekey(conn, projects) == 1
    assert uuids(conn) == [("t1", "u2")]


def test_rekey_gives_two_prompts_with_the_same_text_their_own_entries(tmp_path):
    projects = tmp_path / "projects"
    write(projects, "s1", [at("u1", "fix it", "2026-10-17T12:00:00.000Z"), at("u2", "fix it", "2026-10-17T12:05:00.000Z")])
    conn = connect(tmp_path / "g.db")
    save(conn, "t1", "fix it", "2026-10-17T12:00:00.500Z")
    save(conn, "t2", "fix it", "2026-10-17T12:05:00.500Z")
    assert rekey(conn, projects) == 2
    assert uuids(conn) == [("t1", "u1"), ("t2", "u2")]


def test_rekey_leaves_unmatched_prompts_and_is_idempotent(tmp_path):
    projects = tmp_path / "projects"
    write(projects, "s1", [at("u1", "something else", "2026-10-17T12:00:00.000Z")])
    conn = connect(tmp_path / "g.db")
    save(conn, "t1", "fix it", "2026-10-17T12:00:00.000Z")
    save(conn, "t2", "no transcript", "2026-10-17T12:00:00.000Z", session="missing")
    assert rekey(conn, projects) == 0
    assert rekey(conn, projects) == 0
    assert uuids(conn) == [("t1", None), ("t2", None)]
    write(projects, "s1", [at("u1", "fix it", "2026-10-17T12:00:00.000Z")])
    assert rekey(conn, projects) == 1
    assert rekey(conn, projects) == 0
    assert uuids(conn) == [("t1", "u1"), ("t2", None)]


def test_rekey_keeps_the_uuid_of_old_rows(tmp_path):
    projects = tmp_path / "projects"
    write(projects, "s1", [at("u9", "fix it", "2026-10-17T12:00:00.000Z")])
    conn = connect(tmp_path / "g.db")
    save_check(conn, turn_id=None, prompt_uuid="old", session_id="s1", created_at="2026-10-17T12:00:00Z",
               project_dir="/p", original="fix it", check=Check(input_mode="typed", corrected_prompt="c", mistakes=[]))
    assert rekey(conn, projects) == 0
    assert uuids(conn) == [(None, "old")]


def test_query_rekey_command(tmp_path):
    config_dir = tmp_path / "claude"
    write(config_dir / "projects", "s1", [at("u1", "fix it", "2026-10-17T12:00:00.000Z")])
    conn = connect(tmp_path / "grammar.db")
    save(conn, "t1", "fix it", "2026-10-17T12:00:00.000Z")
    conn.close()
    result = subprocess.run([sys.executable, ROOT / "scripts" / "query.py", "rekey"], capture_output=True, text=True,
                            env=script_env(tmp_path, CLAUDE_PLUGIN_DATA=str(tmp_path),
                                           CLAUDE_CONFIG_DIR=str(config_dir)), cwd=tmp_path)
    assert (result.returncode, json.loads(result.stdout)) == (0, {"rekeyed": 1}), result.stderr
