def occurrence_fields(occurrences, threshold):
    return [{"type": o.type, "type_label": o.type_label, "type_description": o.type_description,
             "type_example": o.type_example, "identifier": o.identifier, "original": o.original,
             "corrected": o.corrected, "reason": o.reason, "count": o.count, "is_recurring": o.count >= threshold}
            for o in occurrences]
