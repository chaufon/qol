"""Print the grammar check instruction the hooks module attaches to a submitted prompt, for Claude to start its reply
with an English grammar check and a grammar-json block.

Reads {"prompt": "..."} on standard input and prints {"context": "<instruction>"}. A prompt that opens with
"Claude, do not grammar check" (or a close variant) skips the check for that prompt only: the output then has no
context. The mistake types in the instruction are the active ones in the database. Never fails: errors go to the
error log, and the output holds a systemMessage warning when the error log cannot be written either."""
import json
import re
import sys
import traceback

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


def main() -> None:
    output = {}
    prompt = json.load(sys.stdin).get("prompt") or ""
    if not SKIP_RE.match(prompt):
        try:
            output["context"] = instruction()
        except Exception:
            if not log_error(traceback.format_exc()):
                output["systemMessage"] = UNWRITABLE
    if output:
        json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
