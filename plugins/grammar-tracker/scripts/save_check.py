"""Save the grammar-json block of a reply to the database and print the check for the grammar-tracker mod.

The mod (hooks/register.tsx) runs this as soon as the check block closes in the streamed reply, with the JSON
`{turn_id, session_id, cwd, prompt, reply, timestamp}` on standard input: the engine's turn id, the prompt the user
sent, the reply streamed so far and the time the prompt was sent. It prints `corrected_prompt` and `occurrences` (each
saved mistake with its reason, its counter and its type's label, description and example), which the mod draws in its
band and pane. When the reply says the check does not apply, it prints `does_not_apply` alone. Before it saves, it
stores the transcript uuid of earlier prompts that have none (lib/rekey.py). Never blocks Claude Code: failures go to
the error log and print `systemMessage`, a one-line warning that the mod shows as a toast."""

import json
import sys
import traceback
from typing import Any

from lib import config
from lib.db import connect, save_check
from lib.errorlog import UNWRITABLE, log_error
from lib.rekey import rekey
from lib.report import occurrence_fields
from lib.transcript import does_not_apply, extract_check


def report(data: dict[str, Any]) -> dict[str, object] | None:
    reply = data["reply"]
    if does_not_apply(reply):
        return {"does_not_apply": True}
    check = extract_check(reply)
    if check is None:
        return None
    conn = connect(config.DB_PATH)
    try:
        rekey(conn)
        saved = save_check(
            conn,
            turn_id=data["turn_id"],
            session_id=data.get("session_id"),
            created_at=data["timestamp"],
            project_dir=data.get("cwd"),
            original=data["prompt"],
            check=check,
        )
    finally:
        conn.close()
    if saved is None:
        return None
    return {
        "corrected_prompt": check.corrected_prompt,
        "occurrences": occurrence_fields(saved, config.RECURRING_THRESHOLD),
    }


def main() -> None:
    try:
        output: dict[str, object] | None = report(json.load(sys.stdin))
    except Exception:
        is_logged = log_error(traceback.format_exc())
        output = {"systemMessage": "Grammar tracker: failed to log (see errors.log)" if is_logged else UNWRITABLE}
    if output:
        json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
