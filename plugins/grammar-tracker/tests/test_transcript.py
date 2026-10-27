import json

import pytest

from conftest import ROOT, assistant, block, user
from lib.transcript import CHECK_LABEL, NOT_APPLY, extract_check, find_transcript, last_turn

PAYLOAD = {
    "input_mode": "dictated",
    "corrected_prompt": "I need the Claude model to include it.",
    "mistakes": [
        {"type": "native_expression", "identifier": "  Need Somebody To ", "original": "we need that it includes",
         "corrected": "we need it to include", "reason": " want + object + to-infinitive "},
    ],
}


def test_last_turn_skips_tool_results_meta_and_notifications(write_transcript):
    path = write_transcript([
        user("u1", "first prompt"),
        assistant("a1", "old reply"),
        user("u2", "second prompt"),
        assistant("a2", "part one"),
        user("t1", [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]),
        user("m1", [{"type": "text", "text": "skill body"}], isMeta=True),
        assistant("a3", "part two"),
        user("n1", "<task-notification>\n<task-id>x</task-id>"),
        assistant("a4", "part three"),
    ])
    turn = last_turn(path)
    assert turn.prompt_uuid == "u2"
    assert turn.prompt == "second prompt"
    assert turn.timestamp == "2026-10-17T12:00:00.000Z"
    assert turn.reply == "part one\npart two\npart three"


def test_last_turn_joins_text_blocks_of_a_list_prompt(write_transcript):
    path = write_transcript([
        user("u1", [{"type": "text", "text": "line one"}, {"type": "image", "source": {}},
                    {"type": "text", "text": "line two"}]),
    ])
    assert last_turn(path).prompt == "line one\nline two"


def test_last_turn_is_none_without_a_prompt(write_transcript):
    assert last_turn(write_transcript([assistant("a1", "hi")])) is None


def test_extract_check_parses_and_normalizes():
    check = extract_check(block(PAYLOAD))
    assert check.input_mode == "dictated"
    assert check.corrected_prompt == "I need the Claude model to include it."
    [mistake] = check.mistakes
    assert mistake.type == "native_expression"
    assert mistake.identifier == "need somebody to"
    assert mistake.original == "we need that it includes"
    assert mistake.corrected == "we need it to include"
    assert mistake.reason == "want + object + to-infinitive"


@pytest.mark.parametrize("reason", [{}, {"reason": None}, {"reason": "  "}])
def test_extract_check_reads_missing_or_blank_reason_as_none(reason):
    mistake = {k: v for k, v in PAYLOAD["mistakes"][0].items() if k != "reason"} | reason
    assert extract_check(block({**PAYLOAD, "mistakes": [mistake]})).mistakes[0].reason is None


def test_extract_check_keeps_unknown_type_and_maps_bad_mode_to_none():
    payload = {**PAYLOAD, "input_mode": "spoken",
               "mistakes": [{**PAYLOAD["mistakes"][0], "type": "Idioms"}]}
    check = extract_check(block(payload))
    assert check.input_mode is None
    assert check.mistakes[0].type == "Idioms"


def test_extract_check_accepts_mistake_free_prompt():
    check = extract_check(block({**PAYLOAD, "mistakes": []}))
    assert check.mistakes == []


def test_extract_check_reads_block_without_label():
    reply = "```grammar-json\n" + json.dumps(PAYLOAD) + "\n```\n\nRest."
    assert extract_check(reply).corrected_prompt == PAYLOAD["corrected_prompt"]


def test_extract_check_reads_block_after_progress_text():
    reply = "Now writing the hooks.\nFixing the test helper.\n" + block(PAYLOAD)
    assert extract_check(reply).corrected_prompt == PAYLOAD["corrected_prompt"]


def test_extract_check_is_none_without_block():
    assert extract_check("English grammar check does not apply.") is None


@pytest.mark.parametrize("bad", [
    "```grammar-json\n{not json}\n```",
    "```grammar-json\n[]\n```",
    '```grammar-json\n{"input_mode": "typed", "mistakes": []}\n```',
    '```grammar-json\n{"input_mode": "typed", "corrected_prompt": "x", "mistakes": [{"type": "article"}]}\n```',
])
def test_extract_check_rejects_malformed_block(bad):
    with pytest.raises(ValueError):
        extract_check(bad)


def test_find_transcript_by_session_id(tmp_path):
    path = tmp_path / "-home-me-project" / "abc-123.jsonl"
    path.parent.mkdir()
    path.write_text("")
    assert find_transcript("abc-123", tmp_path) == path
    assert find_transcript("missing", tmp_path) is None


def test_mod_uses_same_label_and_not_apply_phrase():
    mod = (ROOT / "hooks" / "register.tsx").read_text()
    assert f"const CHECK_LABEL = '{CHECK_LABEL}'" in mod
    assert f"const NOT_APPLY = '{NOT_APPLY}'" in mod
