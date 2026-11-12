import json
import subprocess
import sys

import pytest
from conftest import ROOT, block, script_env, user
from lib import config
from lib.db import connect


def run(script, payload, home, **env):
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=script_env(home, CLAUDE_PLUGIN_DATA=str(home), **env),
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout) if result.stdout.strip() else None


def test_prompt_context_adds_instruction(tmp_path):
    out = run("prompt_context.py", {"prompt": "I want improve it"}, tmp_path)
    context = out["context"]
    assert "grammar-json" in context
    assert "native_expression" in context
    assert "**English grammar check:**" in context
    assert '"reason": "<why it is a mistake, in a few words>"' in context
    assert '- word_choice: the correct word ("key" for "press the G button")' in context
    assert "- false_friend: the false friend used, never the correct word" in context
    positions = [
        context.index(f"- {key}:")
        for key in (
            "spelling",
            "irregular_verb",
            "phrasal_verb",
            "wrong_tense",
            "malformed_tense",
            "word_order",
            "native_expression",
            "preposition",
            "article",
            "agreement",
            "word_choice",
            "false_friend",
            "countability",
            "missing_subject",
            "verb_pattern",
            "question_form",
            "pronoun",
            "other",
        )
    ]
    assert positions == sorted(positions)


def context_for(tmp_path, *language):
    """The instruction for a prompt, with native_language set to `language` or, without it, left out."""
    payload = {"prompt": "I want improve it", **({"native_language": language[0]} if language else {})}
    return run("prompt_context.py", payload, tmp_path)["context"]


def logged(home):
    log = home / "errors.log"
    return log.read_text() if log.exists() else ""


@pytest.mark.parametrize("language", config.NATIVE_LANGUAGES)
def test_prompt_context_names_the_native_language_it_is_given(tmp_path, language):
    context = context_for(tmp_path, language)
    assert context.startswith(f"The user is a {language} speaker writing prompts in English.")
    assert f"{language} calques" in context
    for other in set(config.NATIVE_LANGUAGES) - {language}:
        assert other not in context
    assert "native language" not in logged(tmp_path)


def test_prompt_context_matches_the_native_language_without_regard_to_case(tmp_path):
    assert context_for(tmp_path, " portuguese ").startswith("The user is a Portuguese speaker")


def test_prompt_context_without_a_native_language_uses_spanish(tmp_path):
    assert context_for(tmp_path).startswith("The user is a Spanish speaker")
    assert context_for(tmp_path, "").startswith("The user is a Spanish speaker")
    assert "native language" not in logged(tmp_path)


def test_prompt_context_with_an_unknown_native_language_uses_spanish_and_logs_it(tmp_path):
    assert context_for(tmp_path, "Klingon").startswith("The user is a Spanish speaker")
    log = (tmp_path / "errors.log").read_text()
    assert "unknown native language 'Klingon'; using Spanish" in log
    assert "Spanish, Portuguese, French, Italian" in log


def test_native_language_option_lists_the_languages_prompt_context_knows():
    option = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())["userConfig"]["native_language"]
    assert tuple(option["options"]) == config.NATIVE_LANGUAGES
    assert option["default"] == config.DEFAULT_NATIVE_LANGUAGE


def test_prompt_context_leaves_out_deleted_type(tmp_path):
    conn = connect(tmp_path / "grammar.db")
    conn.execute("UPDATE mistake_types SET deleted_at = '2026-01-01T00:00:00' WHERE key = 'phrasal_verb'")
    conn.commit()
    conn.close()
    out = run("prompt_context.py", {"prompt": "I want improve it"}, tmp_path)
    context = out["context"]
    assert "- phrasal_verb:" not in context
    assert "- spelling:" in context


def test_prompt_context_with_unreadable_database_logs_and_prints_nothing(tmp_path):
    (tmp_path / "grammar.db").mkdir()
    assert run("prompt_context.py", {"prompt": "I want improve it"}, tmp_path) is None
    assert "sqlite3" in (tmp_path / "errors.log").read_text()


def test_prompt_context_honors_skip_phrase(tmp_path):
    assert run("prompt_context.py", {"prompt": "Claude, don't grammar check: fix it"}, tmp_path) is None


def test_script_without_claude_plugin_data_uses_the_data_folder_claude_code_gives_the_plugin(tmp_path):
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "query.py"), "top"],
        capture_output=True,
        text=True,
        env=script_env(tmp_path, CLAUDE_CONFIG_DIR=str(tmp_path)),
        cwd=tmp_path,
    )
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "plugins" / "data" / "grammar-tracker-qol" / "grammar.db").exists()


def save_payload(reply, turn_id="turn-1", prompt="the people"):
    return {
        "turn_id": turn_id,
        "session_id": "s1",
        "cwd": "/proj",
        "prompt": prompt,
        "reply": reply,
        "timestamp": "2026-10-17T12:00:00.000Z",
    }


def test_save_check_saves_and_reports(tmp_path):
    mistake = {
        "type": "article",
        "identifier": "no article",
        "original": "the people",
        "corrected": "people",
        "reason": "people in general take no article",
    }
    payload = {"input_mode": "typed", "corrected_prompt": "people", "mistakes": [mistake] * 3}
    out = run("save_check.py", save_payload(block(payload)), tmp_path)
    assert "systemMessage" not in out
    assert out["occurrences"][0] == {
        "type": "article",
        "type_label": "article",
        "identifier": "no article",
        "type_description": 'A wrong, missing or extra "a/an" or "the".',
        "type_example": '"the people are selfish" instead of "people are selfish"',
        "original": "the people",
        "corrected": "people",
        "reason": "people in general take no article",
        "count": 3,
        "is_recurring": True,
    }
    assert len(out["occurrences"]) == 3
    assert out["corrected_prompt"] == "people"
    conn = connect(tmp_path / "grammar.db")
    assert conn.execute("SELECT turn_id, prompt_uuid, original, created_at, project_dir FROM prompts").fetchall() == [
        ("turn-1", None, "the people", "2026-10-17T12:00:00.000Z", "/proj")
    ]
    assert run("save_check.py", save_payload(block(payload)), tmp_path) is None


def test_save_check_reports_check_that_does_not_apply(tmp_path):
    reply = "English grammar check does not apply\n\nDone."
    assert run("save_check.py", save_payload(reply), tmp_path) == {"does_not_apply": True}


def test_save_check_reports_labeled_check_that_does_not_apply(tmp_path):
    reply = "**English grammar check:** English grammar check does not apply.\n\nDone."
    assert run("save_check.py", save_payload(reply), tmp_path) == {"does_not_apply": True}


def test_save_check_is_silent_without_check(tmp_path):
    assert run("save_check.py", save_payload("Done."), tmp_path) is None
    assert not (tmp_path / "grammar.db").exists()


def test_save_check_logs_failure_without_blocking(tmp_path):
    out = run("save_check.py", save_payload("```grammar-json\n{broken\n```"), tmp_path)
    assert out == {"systemMessage": "Grammar tracker: failed to log (see errors.log)"}
    assert "ValueError" in (tmp_path / "errors.log").read_text()


def test_save_check_reports_mistake_free_prompt(tmp_path):
    payload = {"input_mode": "typed", "corrected_prompt": "fine", "mistakes": []}
    out = run("save_check.py", save_payload(block(payload), prompt="fine"), tmp_path)
    assert out == {"corrected_prompt": "fine", "occurrences": []}


def test_save_check_reads_check_after_progress_text_and_a_reply_still_streaming(tmp_path):
    payload = {"input_mode": "typed", "corrected_prompt": "fine", "mistakes": []}
    reply = block(payload).split("\n\nRest")[0] + "\n\nStill strea"
    assert run("save_check.py", save_payload(reply, prompt="fine"), tmp_path)["corrected_prompt"] == "fine"


def test_save_check_stores_the_transcript_uuid_of_earlier_prompts(tmp_path):
    config_dir = tmp_path / "claude"
    transcript = config_dir / "projects" / "-home-me-project" / "s1.jsonl"
    transcript.parent.mkdir(parents=True)
    transcript.write_text(json.dumps(user("u1", "the people")) + "\n")
    payload = {"input_mode": "typed", "corrected_prompt": "fine", "mistakes": []}
    run("save_check.py", save_payload(block(payload)), tmp_path / "data", CLAUDE_CONFIG_DIR=str(config_dir))
    run(
        "save_check.py",
        save_payload(block(payload), turn_id="turn-2", prompt="next"),
        tmp_path / "data",
        CLAUDE_CONFIG_DIR=str(config_dir),
    )
    conn = connect(tmp_path / "data" / "grammar.db")
    assert conn.execute("SELECT turn_id, prompt_uuid FROM prompts ORDER BY id").fetchall() == [
        ("turn-1", "u1"),
        ("turn-2", None),
    ]


def unwritable(tmp_path):
    """A data folder that cannot be created: its parent is a file."""
    blocker = tmp_path / "file"
    blocker.write_text("")
    return blocker / "data"


def test_prompt_context_with_an_unwritable_data_folder_warns_without_blocking(tmp_path):
    home = unwritable(tmp_path)
    out = run("prompt_context.py", {"prompt": "I want improve it"}, home)
    assert out == {"systemMessage": f"Grammar tracker: cannot write to the data folder {home}"}


def test_save_check_with_an_unwritable_data_folder_says_so(tmp_path):
    payload = {"input_mode": "typed", "corrected_prompt": "fine", "mistakes": []}
    home = unwritable(tmp_path)
    out = run("save_check.py", save_payload(block(payload)), home)
    assert out == {"systemMessage": f"Grammar tracker: cannot write to the data folder {home}"}
