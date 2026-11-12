"""Live tests of the grammar check itself: each sample prompt holds a mistake that speakers of one native language
typically make in English, and Claude, given the mod's instruction for that language, must report it. Correct prompts
must get no mistakes.

They call Claude through `claude -p` with the mod loaded from this folder, so they cost tokens and depend on the
model's answer. A plain `pytest` run skips them all.

Environment variables:
- GRAMMAR_TRACKER_LIVE: required. Only the value 1 runs the tests; any other value, or none, skips them.
- GRAMMAR_TRACKER_LIVE_MODEL: optional. The model for `claude -p --model`, such as `sonnet`; Claude Code's own default
  model when unset.

Run them from the repository root, with `claude` on the PATH and logged in:

    GRAMMAR_TRACKER_LIVE=1 python3 -m pytest plugins/grammar-tracker/tests/test_live_check.py

Each run has no tools, no MCP servers and no saved session, runs in an empty folder, and is told to answer only OK
after the check. The test sets CLAUDE_CODE_PLUGIN_CACHE_DIR to a plugins folder of its own, so it writes nothing to the
real grammar.db, and CLAUDE_CODE_MAX_OUTPUT_TOKENS to cap each reply; neither needs setting by hand."""
import json
import os
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import pytest
from conftest import ROOT
from lib.transcript import Check, extract_check

pytestmark = pytest.mark.skipif(os.environ.get("GRAMMAR_TRACKER_LIVE") != "1",
                                reason="live grammar check tests run only with GRAMMAR_TRACKER_LIVE=1")


@dataclass(frozen=True)
class Sample:
    language: str
    prompt: str
    types: frozenset[str]  # A reported mistake must have one of these types.
    gone: str  # The wrong fragment, which the corrected prompt must not contain.


def sample(language: str, prompt: str, types: set[str], gone: str) -> Sample:
    return Sample(language, prompt, frozenset(types), gone)


SAMPLES = (
    # French: present for an action that continues, "expliquer à quelqu'un", "assister à", "informations",
    # "elle" for a feminine noun, plural adjectives.
    sample("French", "I am working on this project since two years, so I know the code well.",
           {"wrong_tense", "preposition"}, "since two years"),
    sample("French", "Can you explain me why the build fails on the main branch?",
           {"verb_pattern", "preposition", "word_choice"}, "explain me"),
    sample("French", "I assisted to the meeting yesterday, and they asked me to fix the login page.",
           {"false_friend", "word_choice", "preposition"}, "assisted to"),
    sample("French", "The informations about the error are in the log file.", {"countability"}, "informations"),
    sample("French", "The function is slow because she reads the whole file into memory.", {"pronoun"},
           "because she reads"),
    sample("French", "We tested differents options for the cache last week.", {"agreement"}, "differents"),
    # Portuguese: dropped subject, "pretender" (intend), "preciso que você", perfect for a finished past action, "seu"
    # agreeing with the thing owned.
    sample("Portuguese", "Is important to run the tests before we merge the branch.", {"missing_subject"},
           "Is important"),
    sample("Portuguese", "I pretend to finish the migration today, so please review it soon.",
           {"false_friend", "word_choice"}, "pretend"),
    sample("Portuguese", "I need that you push the changes to the remote repository.", {"verb_pattern"},
           "need that you"),
    sample("Portuguese", "Yesterday I have fixed the bug in the parser.", {"wrong_tense"}, "have fixed"),
    sample("Portuguese", "My sister finished the review and pushed the fix to his own branch.", {"pronoun"},
           "his own"),
    # Italian: "voglio che tu", dropped subject, "controllare" (check), passato prossimo for a finished action,
    # "essere" as the auxiliary.
    sample("Italian", "I want that you check the logs before the deploy.", {"verb_pattern"}, "want that you"),
    sample("Italian", "Is necessary to update the README after this change.", {"missing_subject"}, "Is necessary"),
    sample("Italian", "Please control the logs and tell me if there are errors.", {"false_friend", "word_choice"},
           "control the logs"),
    sample("Italian", "I have done the tests yesterday and they all passed.", {"wrong_tense"}, "have done"),
    sample("Italian", "The new version is arrived on the server, so we can start the tests.", {"malformed_tense"},
           "is arrived"),
    # Spanish: "depender de", "discutir sobre".
    sample("Spanish", "I depend of the API team to finish this feature.", {"preposition"}, "depend of"),
    sample("Spanish", "We need to discuss about the design before we write the code.", {"preposition"},
           "discuss about"),
)


# Without tools, the model would otherwise write the task's tool calls as text, at length. The prompt itself stays as
# written, so the check grades it unchanged.
STOP_AFTER_CHECK = ("This is a test of the grammar check alone. After the grammar check, do not carry out the "
                    "request: reply only with OK.")


def check_of(sample_: Sample) -> Check | None:
    """Send the sample's prompt to Claude with the mod set to the sample's language; return the reply's check."""
    with tempfile.TemporaryDirectory(prefix="grammar-live-") as folder:
        work = Path(folder) / "work"
        work.mkdir()
        settings = {"pluginConfigs": {"grammar-tracker@inline": {"options": {"native_language": sample_.language}}}}
        command = [shutil.which("claude") or "claude", "-p", "--plugin-dir", str(ROOT), "--settings",
                   json.dumps(settings), "--tools", "", "--strict-mcp-config", "--no-session-persistence",
                   "--max-turns", "1", "--append-system-prompt", STOP_AFTER_CHECK]
        if model := os.environ.get("GRAMMAR_TRACKER_LIVE_MODEL"):
            command += ["--model", model]
        env = {**os.environ, "CLAUDE_CODE_PLUGIN_CACHE_DIR": str(Path(folder) / "plugins"),
               "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "2000"}
        result = subprocess.run([*command, sample_.prompt], stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                cwd=work, timeout=300, env=env)
        return extract_check(result.stdout)


@pytest.fixture(scope="module")
def checks() -> dict[Sample, Check | None]:
    """The check of every sample, run in parallel."""
    with ThreadPoolExecutor(max_workers=7) as pool:
        return dict(zip(SAMPLES, pool.map(check_of, SAMPLES)))


@pytest.mark.parametrize("sample_", SAMPLES, ids=lambda s: f"{s.language}: {s.gone}")
def test_check_reports_the_typical_mistake(checks: dict[Sample, Check | None], sample_: Sample) -> None:
    """The check reports the sample's mistake with an expected type and removes it from the corrected prompt."""
    check = checks[sample_]
    assert check is not None, "the reply has no grammar-json block"
    found = [(m.type, m.identifier) for m in check.mistakes]
    assert any(m.type in sample_.types for m in check.mistakes), f"no mistake of {set(sample_.types)} in {found}"
    assert sample_.gone not in check.corrected_prompt, check.corrected_prompt


# Correct prompts, one per language: the check must not invent mistakes in them.
CLEAN = (
    sample("French", "I have been working on this project for two years, so I know the code well.", set(), ""),
    sample("Portuguese", "It is important to run the tests before we merge the branch.", set(), ""),
    sample("Italian", "I want you to check the logs before the deploy.", set(), ""),
    sample("Spanish", "We need to discuss the design before we write the code.", set(), ""),
)


@pytest.fixture(scope="module")
def clean_checks() -> dict[Sample, Check | None]:
    """The check of every clean prompt, run in parallel."""
    with ThreadPoolExecutor(max_workers=len(CLEAN)) as pool:
        return dict(zip(CLEAN, pool.map(check_of, CLEAN)))


@pytest.mark.parametrize("sample_", CLEAN, ids=lambda s: s.language)
def test_check_finds_no_mistake_in_a_correct_prompt(clean_checks: dict[Sample, Check | None], sample_: Sample) -> None:
    """The check of a correct prompt has a grammar-json block with no mistakes."""
    check = clean_checks[sample_]
    assert check is not None, "the reply has no grammar-json block"
    assert check.mistakes == [], [(m.type, m.identifier) for m in check.mistakes]
