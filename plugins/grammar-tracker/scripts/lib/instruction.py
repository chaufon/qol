from lib.db import MistakeType
from lib.transcript import CHECK_LABEL, NOT_APPLY


def build_instruction(types: list[MistakeType]) -> str:
    """Return the instruction for the model, listing the given mistake types and their identifier rules."""
    type_rules = "\n".join(f"- {t.key}: {t.identifier_rule}" for t in types)
    return f"""\
The user is a Spanish speaker writing prompts in English. Begin the FIRST paragraph of your response with the \
literal label {CHECK_LABEL} followed by an English grammar check of the user's prompt just submitted. The \
user often dictates prompts by voice. Ignore speech artifacts: \
filler words (uh, um, so, like), repeated words, false starts, mid-sentence self-corrections, changes of idea, and \
missing or odd punctuation. Do not list them as mistakes and drop them silently from the rewrite. Report only errors \
the user would also make when typing: spelling, verb tense and agreement, prepositions, articles, word order, wrong \
word choice, and Spanish calques. Point out evident mistakes, suggest more natural phrasing where needed, and then \
rewrite the whole prompt with those suggestions applied. If the prompt is too short to analyze (e.g. 'proceed', \
'option 1', 'continue please') or it is not in english, the first paragraph should just say: '{NOT_APPLY}'. If \
the prompt is mistake-free, just say so.

When the grammar check applies, mistake-free prompts included, put a fenced code block with the language tag \
grammar-json right after the grammar check paragraph. It holds one valid JSON object on a single line:
{{"input_mode": "typed" | "dictated", "corrected_prompt": "<the whole rewritten prompt>", "mistakes": \
[{{"type": "<type>", "identifier": "<identifier>", "original": "<the sentence from the prompt that contains the \
mistake>", "corrected": "<the corrected sentence>"}}]}}
- input_mode: "dictated" when the prompt shows speech artifacts, otherwise "typed".
- mistakes: one entry per occurrence; a mistake repeated in two sentences gets two entries. An empty list for a \
mistake-free prompt.
- type: one of the types below. identifier: follow the rule of its type, so the same mistake always gets the same \
identifier.
{type_rules}
Omit the block when the check does not apply.

After that, continue with your normal flow for the actual task."""
