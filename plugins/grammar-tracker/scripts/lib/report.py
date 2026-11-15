import sqlite3
from collections.abc import Iterable
from typing import Any

from lib.db import RankedMistake, SavedOccurrence, fading_mistake, rising_mistake, top_mistakes, totals


def occurrence_fields(occurrences: Iterable[SavedOccurrence], threshold: int) -> list[dict[str, str | int | None]]:
    return [
        {
            "type": o.type,
            "type_label": o.type_label,
            "type_description": o.type_description,
            "type_example": o.type_example,
            "identifier": o.identifier,
            "original": o.original,
            "corrected": o.corrected,
            "reason": o.reason,
            "count": o.count,
            "is_recurring": o.count >= threshold,
        }
        for o in occurrences
    ]


def _type_fields(o: SavedOccurrence) -> dict[str, str | None]:
    return {
        "type": o.type,
        "type_label": o.type_label,
        "type_description": o.type_description,
        "type_example": o.type_example,
    }


def _main_type(top: list[RankedMistake]) -> dict[str, Any] | None:
    """The type with the most rows in the top list, the larger sum of counts breaking a tie; None when no type has two
    rows."""
    rows: dict[str, list[RankedMistake]] = {}
    for o in top:
        rows.setdefault(o.type, []).append(o)
    if not rows:
        return None
    group = max(rows.values(), key=lambda g: (len(g), sum(o.count for o in g)))
    if len(group) < 2:
        return None
    return {"kind": "type", **_type_fields(group[0]), "rows": len(group), "count": sum(o.count for o in group)}


def top_report(conn: sqlite3.Connection, *, limit: int, since: str, threshold: int) -> dict[str, Any]:
    """The Top mistakes tab: the totals, the `limit` most frequent mistakes with their occurrences since `since`, and
    up to three things to focus on, in this order: the type that fills most of the top list, the mistake that occurred
    most above its usual rate since `since`, and the most frequent recurring mistake that no prompt made since then."""
    top = top_mistakes(conn, limit, since)
    focus: list[dict[str, Any]] = []
    main_type = _main_type(top)
    if main_type:
        focus.append(main_type)
    rising = rising_mistake(conn, since)
    if rising:
        o = rising.mistake
        focus.append(
            {
                "kind": "rising",
                **_type_fields(o),
                "identifier": o.identifier,
                "recent": o.recent,
                "above_usual": rising.above_usual,
            }
        )
    fading = fading_mistake(conn, threshold, since)
    if fading:
        focus.append({"kind": "fading", **_type_fields(fading), "identifier": fading.identifier})
    t = totals(conn, threshold)
    return {
        "totals": {
            "mistakes": t.mistakes,
            "prompts": t.prompts,
            "clean_prompts": t.clean_prompts,
            "recurring": t.recurring,
        },
        "mistakes": [
            {**fields, "recent": o.recent} for fields, o in zip(occurrence_fields(top, threshold), top, strict=True)
        ],
        "focus": focus,
    }
