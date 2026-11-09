import json
import re
from dataclasses import dataclass
from pathlib import Path

from lib.config import CLAUDE_DIR

# A reply starts with the label and its grammar-json block, or with the does-not-apply phrase (see instruction.py).
CHECK_LABEL = "**English grammar check:**"
NOT_APPLY = "English grammar check does not apply"
BLOCK_RE = re.compile(r"```grammar-json\s*\n(.*?)\n\s*```", re.DOTALL)
INPUT_MODES = {"typed", "dictated"}
# User entries with these prefixes are harness messages, not prompts the user wrote.
NON_PROMPT_PREFIXES = ("<task-notification>", "<command-", "<local-command")


@dataclass
class Prompt:
    uuid: str
    text: str
    timestamp: str


@dataclass
class Mistake:
    type: str
    identifier: str
    original: str
    corrected: str
    reason: str | None = None


@dataclass
class Check:
    input_mode: str | None
    corrected_prompt: str
    mistakes: list[Mistake]


def _prompt_text(entry):
    """Return the text of a user-written prompt entry, or None for any other entry."""
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain"):
        return None
    content = entry.get("message", {}).get("content")
    if isinstance(content, list):
        if any(block.get("type") == "tool_result" for block in content):
            return None
        content = "\n".join(block["text"] for block in content if block.get("type") == "text")
    if not isinstance(content, str) or content.lstrip().startswith(NON_PROMPT_PREFIXES):
        return None
    return content


def find_transcript(session_id, projects_dir=CLAUDE_DIR / "projects"):
    """Return the transcript file of a session, which is named after the session id."""
    return next(Path(projects_dir).glob(f"*/{session_id}.jsonl"), None)


def user_prompts(path):
    """Return the user-written prompts of the transcript in file order."""
    prompts = []
    for line in Path(path).read_text().splitlines():
        entry = json.loads(line)
        text = _prompt_text(entry)
        if text is not None:
            prompts.append(Prompt(entry["uuid"], text, entry.get("timestamp", "")))
    return prompts


def does_not_apply(reply):
    """Return True when the reply says the check does not apply, with or without the label."""
    return reply.lstrip().removeprefix(CHECK_LABEL).lstrip().startswith(NOT_APPLY)


def extract_check(reply):
    """Parse the grammar-json block of a reply. Return None when the reply has no block."""
    match = BLOCK_RE.search(reply)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        mistakes = [
            Mistake(
                type=m["type"],
                identifier=m["identifier"].strip().lower(),
                original=m["original"],
                corrected=m["corrected"],
                reason=(m.get("reason") or "").strip() or None,
            )
            for m in data["mistakes"]
        ]
        mode = data.get("input_mode")
        return Check(input_mode=mode if mode in INPUT_MODES else None,
                     corrected_prompt=data["corrected_prompt"], mistakes=mistakes)
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as error:
        raise ValueError(f"malformed grammar-json block: {error!r}") from error
