"""Print the grammar check instruction the hooks module attaches to a submitted prompt, for Claude to start its reply
with an English grammar check and a grammar-json block.

Reads {"prompt": "...", "native_language": "..."} on standard input and prints {"context": "<instruction>"}. A prompt
that opens with "Claude, do not grammar check" (or a close variant) skips the check for that prompt only: the output
then has no context. The instruction names the language of the mod's native_language option, which the hooks module
passes as native_language: a missing value gives config.DEFAULT_NATIVE_LANGUAGE, and a value outside
config.NATIVE_LANGUAGES gives it too and is logged to the error log. The mistake types in the instruction are the
active ones in the database. Never fails: errors go to the error log, and the output holds a systemMessage warning when
the error log cannot be written either."""
import json
import re
import sys
import traceback

from lib import config
from lib.db import active_types, connect
from lib.errorlog import UNWRITABLE, log_error
from lib.instruction import build_instruction

SKIP_RE = re.compile(r"^\s*(claude,?\s+)?(do not|don't|dont|skip|no)\s+grammar\s*check", re.IGNORECASE)


def native_language(value: object) -> tuple[str, bool]:
    """Return the native language `value` names, matched without regard to case, and False when an unknown value could
    not be logged."""
    text = "" if value is None else str(value).strip()
    for language in config.NATIVE_LANGUAGES:
        if text.casefold() == language.casefold():
            return language, True
    if not text:
        return config.DEFAULT_NATIVE_LANGUAGE, True
    return config.DEFAULT_NATIVE_LANGUAGE, log_error(
        f"Grammar tracker: unknown native language {text!r}; using {config.DEFAULT_NATIVE_LANGUAGE}. Pick one of "
        f"{', '.join(config.NATIVE_LANGUAGES)} in the mod's native_language option.\n")


def instruction(language: str) -> str:
    conn = connect(config.DB_PATH)
    try:
        return build_instruction(active_types(conn), language)
    finally:
        conn.close()


def main() -> None:
    output = {}
    payload = json.load(sys.stdin)
    prompt = payload.get("prompt") or ""
    if not SKIP_RE.match(prompt):
        language, is_logged = native_language(payload.get("native_language"))
        try:
            output["context"] = instruction(language)
        except Exception:
            is_logged = log_error(traceback.format_exc()) and is_logged
        if not is_logged:
            output["systemMessage"] = UNWRITABLE
    if output:
        json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
