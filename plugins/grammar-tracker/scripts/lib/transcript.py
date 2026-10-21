import json
import re
from dataclasses import dataclass
from pathlib import Path

from lib.config import CLAUDE_DIR

# The first paragraph of a reply starts with one of these (see instruction.py).
CHECK_LABEL = "**English grammar check:**"
NOT_APPLY = "English grammar check does not apply"
BLOCK_RE = re.compile(r"```grammar-json\s*\n(.*?)\n\s*```", re.DOTALL)
INPUT_MODES = {"typed", "dictated"}
# User entries with these prefixes are harness messages, not prompts the user wrote.
NON_PROMPT_PREFIXES = ("<task-notification>", "<command-", "<local-command")


@dataclass
class Turn:
    prompt_uuid: str
    prompt: str
    timestamp: str
    reply: str


@dataclass
class Mistake:
    type: str
    identifier: str
    original: str
    corrected: str


@dataclass
class Check:
    input_mode: str | None
    corrected_prompt: str
    mistakes: list[Mistake]
    summary: str = ""


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


def last_turn(path):
    """Return the last user prompt in the transcript and all assistant text written after it."""
    turn = None
    replies = []
    for line in Path(path).read_text().splitlines():
        entry = json.loads(line)
        prompt = _prompt_text(entry)
        if prompt is not None:
            turn = Turn(entry["uuid"], prompt, entry.get("timestamp", ""), "")
            replies = []
        elif turn and entry.get("type") == "assistant":
            replies += [block["text"] for block in entry["message"].get("content", []) if block.get("type") == "text"]
    if turn:
        turn.reply = "\n".join(replies)
    return turn


def does_not_apply(reply):
    """Return True when the reply says the check does not apply, with or without the label."""
    return reply.lstrip().removeprefix(CHECK_LABEL).lstrip().startswith(NOT_APPLY)


def extract_check(reply):
    """Parse the grammar-json block of a reply and the check text between its label and the block.
    Return None when the reply has no block."""
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
            )
            for m in data["mistakes"]
        ]
        mode = data.get("input_mode")
        # Text the reply writes before the label, such as progress notes, is not part of the check.
        before = reply[:match.start()]
        label = before.rfind(CHECK_LABEL)
        summary = (before if label == -1 else before[label + len(CHECK_LABEL):]).strip()
        return Check(input_mode=mode if mode in INPUT_MODES else None,
                     corrected_prompt=data["corrected_prompt"], mistakes=mistakes, summary=summary)
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as error:
        raise ValueError(f"malformed grammar-json block: {error!r}") from error
