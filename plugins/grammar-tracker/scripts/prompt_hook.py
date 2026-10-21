"""UserPromptSubmit hook: ask Claude to start every response with an English grammar check of the user's prompt
and a grammar-json block that the Stop hook saves.

A prompt that opens with "Claude, do not grammar check" (or a close variant) skips the check for that prompt only.
The mistake types in the instruction are the active ones in the database. When the data folder Claude Code gives the
hook differs from config.PLUGIN_DATA, the one the scripts the mod runs use, the hook logs the difference to the error
log. Never blocks Claude Code: failures go to the error log and the hook prints nothing, or a systemMessage warning
when the data folder cannot be written."""
import json
import os
import re
import sys
import traceback
from pathlib import Path

from lib import config
from lib.db import active_types, connect
from lib.errorlog import UNWRITABLE, log_error
from lib.instruction import build_instruction

SKIP_RE = re.compile(r"^\s*(claude,?\s+)?(do not|don't|dont|skip|no)\s+grammar\s*check", re.IGNORECASE)


def instruction() -> str:
    conn = connect(config.DB_PATH)
    try:
        return build_instruction(active_types(conn))
    finally:
        conn.close()


def log_data_folder_mismatch() -> bool:
    """Log a difference between CLAUDE_PLUGIN_DATA and config.PLUGIN_DATA. Return False when it cannot be logged."""
    real = os.environ.get("CLAUDE_PLUGIN_DATA")
    if real and Path(real) != config.PLUGIN_DATA:
        return log_error(f"Grammar tracker: the scripts the mod runs use {config.PLUGIN_DATA}, but Claude Code gives "
                         f"the plugin {real}. Update PLUGIN_DATA in scripts/lib/config.py.\n")
    return True


def main():
    is_logged = log_data_folder_mismatch()
    output = {}
    prompt = json.load(sys.stdin).get("prompt") or ""
    if not SKIP_RE.match(prompt):
        try:
            context = instruction()
        except Exception:
            is_logged = log_error(traceback.format_exc()) and is_logged
        else:
            output["hookSpecificOutput"] = {"hookEventName": "UserPromptSubmit", "additionalContext": context}
    if not is_logged:
        output["systemMessage"] = UNWRITABLE
    if output:
        json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
