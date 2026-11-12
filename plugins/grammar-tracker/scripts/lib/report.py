from collections.abc import Iterable

from lib.db import SavedOccurrence


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
