"""Save the grammar-json block of the last reply to the database and print the check for the grammar-tracker mod.

The mod (hooks/register.tsx) runs this at the end of each turn with the Stop hook input fields `session_id`, `cwd` and
`last_assistant_message` (`transcript_path` is optional). It prints `summary` (the check text), `corrected_prompt` and
`occurrences` (each saved mistake with its counter and its type's label, description and example), which the mod
draws in its band and pane. When the reply says the check does not apply, it prints `does_not_apply` alone. Never blocks
Claude Code: failures go to the error log and print `systemMessage`, a one-line warning that the mod shows as a toast."""
import json
import sys
import time
import traceback

from lib import config
from lib.db import connect, save_check
from lib.errorlog import UNWRITABLE, log_error
from lib.report import occurrence_fields
from lib.transcript import does_not_apply, extract_check, find_transcript, last_turn

LAG_ATTEMPTS = 10
LAG_DELAY = 0.05  # seconds


def read_reply(hook_input):
    """Return the last turn of the transcript and its whole reply, or (None, None) when the transcript does not hold
    the last prompt.

    The transcript file can lag behind the last message, which Claude Code passes in the hook input. The file is read
    again until its last turn holds that message. A last turn with no reply yet takes the message as its reply. A last
    turn with another reply belongs to an older prompt, so its check is never read."""
    transcript = hook_input.get("transcript_path") or find_transcript(hook_input["session_id"])
    if transcript is None:
        return None, None
    message = hook_input.get("last_assistant_message", "").strip()
    for attempt in range(LAG_ATTEMPTS):
        if attempt:
            time.sleep(LAG_DELAY)
        turn = last_turn(transcript)
        if turn is None:
            return None, None
        if message in turn.reply:
            return turn, turn.reply
    return (turn, message) if not turn.reply.strip() else (None, None)


def report(hook_input):
    turn, reply = read_reply(hook_input)
    if turn is None:
        return None
    if does_not_apply(reply):
        return {"does_not_apply": True}
    check = extract_check(reply)
    if check is None:
        return None
    conn = connect(config.DB_PATH)
    try:
        saved = save_check(conn, prompt_uuid=turn.prompt_uuid, session_id=hook_input.get("session_id"),
                           created_at=turn.timestamp, project_dir=hook_input.get("cwd"), original=turn.prompt,
                           check=check)
    finally:
        conn.close()
    if saved is None:
        return None
    return {"summary": check.summary, "corrected_prompt": check.corrected_prompt,
            "occurrences": occurrence_fields(saved, config.RECURRING_THRESHOLD)}


def main():
    try:
        output = report(json.load(sys.stdin))
    except Exception:
        is_logged = log_error(traceback.format_exc())
        output = {"systemMessage": "Grammar tracker: failed to log (see errors.log)" if is_logged else UNWRITABLE}
    if output:
        json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
