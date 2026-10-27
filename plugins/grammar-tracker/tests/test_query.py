import json
import subprocess
import sys

from conftest import ROOT, script_env

from lib.db import connect, save_check
from lib.transcript import Check, Mistake


def run(tmp_path, *args):
    return subprocess.run([sys.executable, ROOT / "scripts" / "query.py", *args], capture_output=True, text=True,
                          env=script_env(tmp_path, CLAUDE_PLUGIN_DATA=str(tmp_path)), cwd=tmp_path)


def test_unknown_command_fails(tmp_path):
    assert run(tmp_path, "bogus").returncode == 2


def test_top_on_empty_database(tmp_path):
    result = run(tmp_path, "top")
    assert (result.returncode, json.loads(result.stdout)) == (0, [])


def test_top_marks_recurring_mistakes(tmp_path):
    conn = connect(tmp_path / "grammar.db")
    for n in range(3):
        save_check(conn, prompt_uuid=f"p{n}", session_id="s", created_at="2026-10-18T12:00:00Z", project_dir="/p",
                   original="o", check=Check(input_mode="typed", corrected_prompt="c", mistakes=[
                       Mistake(type="article", identifier="the", original="now related.", corrected="now the related.")]))
    conn.close()
    [mistake] = json.loads(run(tmp_path, "top").stdout)
    assert (mistake["identifier"], mistake["count"], mistake["is_recurring"]) == ("the", 3, True)
    assert (mistake["original"], mistake["corrected"]) == ("now related.", "now the related.")


def test_top_on_newer_database_exits_with_the_reason_alone(tmp_path):
    conn = connect(tmp_path / "grammar.db")
    conn.execute("PRAGMA user_version = 99")
    conn.close()
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "query.py"), "top"], capture_output=True, text=True,
                            env=script_env(tmp_path, CLAUDE_PLUGIN_DATA=str(tmp_path)), cwd=tmp_path)
    assert result.returncode == 1
    assert result.stderr.strip() == ("grammar.db is at version 99, and this grammar tracker reads version 3 or older."
                                     " Update the grammar-tracker mod.")


def test_top_with_an_unwritable_data_folder_exits_with_the_reason(tmp_path):
    (tmp_path / "file").write_text("")
    home = tmp_path / "file" / "data"
    result = subprocess.run([sys.executable, ROOT / "scripts" / "query.py", "top"], capture_output=True, text=True,
                            env=script_env(tmp_path, CLAUDE_PLUGIN_DATA=str(home)), cwd=tmp_path)
    assert result.returncode == 1
    assert result.stderr.strip() == f"Grammar tracker: cannot write to the data folder {home}"
