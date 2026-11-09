from datetime import datetime, timezone

from lib.config import CLAUDE_DIR
from lib.transcript import find_transcript, user_prompts


def _seconds(timestamp):
    """The time of an ISO 8601 timestamp as seconds since the epoch, or None when it cannot be read."""
    try:
        moment = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp()


def rekey(conn, projects_dir=CLAUDE_DIR / "projects"):
    """Store the transcript uuid of every saved prompt that has none. The prompt is the user entry of the session's
    transcript with the same text and the closest timestamp, among the entries no saved prompt owns. A prompt with no
    match stays as it is. Return the number of prompts that got a uuid."""
    rows = conn.execute("SELECT id, session_id, created_at, original FROM prompts WHERE prompt_uuid IS NULL"
                        " AND session_id IS NOT NULL ORDER BY created_at, id").fetchall()
    taken = {uuid for (uuid,) in conn.execute("SELECT prompt_uuid FROM prompts WHERE prompt_uuid IS NOT NULL")}
    transcripts = {}
    count = 0
    for prompt_id, session_id, created_at, original in rows:
        if session_id not in transcripts:
            path = find_transcript(session_id, projects_dir)
            transcripts[session_id] = user_prompts(path) if path else []
        candidates = [p for p in transcripts[session_id] if p.uuid not in taken and p.text.strip() == original.strip()]
        if not candidates:
            continue
        wanted = _seconds(created_at)

        def distance(candidate):
            found = _seconds(candidate.timestamp)
            return abs(found - wanted) if wanted is not None and found is not None else float("inf")

        best = min(candidates, key=distance)
        with conn:
            conn.execute("UPDATE prompts SET prompt_uuid = ? WHERE id = ?", (best.uuid, prompt_id))
        taken.add(best.uuid)
        count += 1
    return count
