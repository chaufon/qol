from lib.db import MistakeType
from lib.transcript import CHECK_LABEL, NOT_APPLY


def build_instruction(types: list[MistakeType]) -> str:
    """Return the instruction for the model, listing the given mistake types and their identifier rules."""
    type_rules = "\n".join(f"- {t.key}: {t.identifier_rule}" for t in types)
    return f"""\
The user is a Spanish speaker writing prompts in English. Begin your response with an English grammar check of the \
user's prompt just submitted: the literal label {CHECK_LABEL} on its own line, then a fenced code block with the \
language tag grammar-json. Write no other text about the check. The user often dictates prompts by voice. Ignore \
speech artifacts: filler words (uh, um, so, like), repeated words, false starts, mid-sentence self-corrections, \
changes of idea, and missing or odd punctuation. Do not list them as mistakes and drop them silently from the \
rewrite. Report only errors the user would also make when typing: spelling, verb tense and agreement, prepositions, \
articles, word order, wrong word choice, and Spanish calques. Report evident mistakes, use more natural phrasing \
where needed, and rewrite the whole prompt with those changes applied.

The block holds one valid JSON object on a single line:
{{"input_mode": "typed" | "dictated", "corrected_prompt": "<the whole rewritten prompt>", "mistakes": \
[{{"type": "<type>", "identifier": "<identifier>", "original": "<the sentence from the prompt that contains the \
mistake>", "corrected": "<the corrected sentence>", "reason": "<why it is a mistake, in a few words>"}}]}}
- input_mode: "dictated" when the prompt shows speech artifacts, otherwise "typed".
- mistakes: one entry per occurrence; a mistake repeated in two sentences gets two entries. An empty list for a \
mistake-free prompt.
- reason: a short phrase about this sentence, not the type's general rule ("present perfect for a state that \
continues now").
- type: one of the types below. identifier: follow the rule of its type, so the same mistake always gets the same \
identifier.
{type_rules}

If the prompt is too short to analyze (e.g. 'proceed', 'option 1', 'continue please') or it is not in English, write \
no label and no block: the first paragraph is just '{NOT_APPLY}'.

After that, continue with your normal flow for the actual task."""
