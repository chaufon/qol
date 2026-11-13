import sqlite3
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

from lib.config import CLAUDE_DIR
from lib.transcript import Prompt, find_transcript, user_prompts


def _seconds(timestamp: str) -> float | None:
    """The time of an ISO 8601 timestamp as seconds since the epoch, or None when it cannot be read."""
    try:
        moment = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp()


def rekey(conn: sqlite3.Connection, projects_dir: Path = CLAUDE_DIR / "projects") -> int:
    """Store the transcript uuid of every saved prompt that has none. The prompt is the user entry of the session's
    transcript with the same text and the closest timestamp, among the entries no saved prompt owns. A prompt with no
    match stays as it is. Return the number of prompts that got a uuid."""
    rows = conn.execute(
        "SELECT id, session_id, created_at, original FROM prompts WHERE prompt_uuid IS NULL"
        " AND session_id IS NOT NULL ORDER BY created_at, id"
    ).fetchall()
    taken = {uuid for (uuid,) in conn.execute("SELECT prompt_uuid FROM prompts WHERE prompt_uuid IS NOT NULL")}
    transcripts: dict[str, list[Prompt]] = {}
    count = 0
    for prompt_id, session_id, created_at, original in rows:
        if session_id not in transcripts:
            path = find_transcript(session_id, projects_dir)
            transcripts[session_id] = user_prompts(path) if path else []
        candidates = [p for p in transcripts[session_id] if p.uuid not in taken and p.text.strip() == original.strip()]
        if not candidates:
            continue
        best = min(candidates, key=partial(_distance, wanted=_seconds(created_at)))
        with conn:
            conn.execute("UPDATE prompts SET prompt_uuid = ? WHERE id = ?", (best.uuid, prompt_id))
        taken.add(best.uuid)
        count += 1
    return count


def _distance(candidate: Prompt, wanted: float | None) -> float:
    """Seconds between a transcript prompt and the saved prompt's time; infinite when either time is unknown."""
    found = _seconds(candidate.timestamp)
    return abs(found - wanted) if wanted is not None and found is not None else float("inf")
