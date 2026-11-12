"""The text of the mistake types: SEED, which a new database gets, and the earlier texts that the migrations of
lib/db.py rewrite to the SEED text."""

# A mistake type as (key, label, description, example, identifier rule shown to the model).
SeedRow = tuple[str, str, str, str | None, str]

# The types in their order; position is the index + 1.
SEED: tuple[SeedRow, ...] = (
    (
        "spelling",
        "spelling",
        "A word written with wrong, missing or extra letters.",
        '"necesity" instead of "necessity"',
        'the correct word ("necessity" for "necesity")',
    ),
    (
        "irregular_verb",
        "irregular verb",
        "An irregular verb in the wrong form, usually its past or past participle.",
        '"know" instead of "known"',
        'the base form of the verb, never the past forms ("know" for "I have know")',
    ),
    (
        "phrasal_verb",
        "phrasal verb",
        "The wrong verb + particle combination for the meaning.",
        '"get off" instead of "get out"',
        'the correct phrasal verb ("get out" for "get off the house")',
    ),
    (
        "wrong_tense",
        "wrong tense",
        "A real tense, but not the one the meaning needs.",
        '"simple past" instead of "present perfect"',
        'the used tense and the correct one, as is ("\\"simple past\\" instead of \\"present perfect\\"")',
    ),
    (
        "malformed_tense",
        "malformed tense",
        "The right tense built wrong: auxiliaries wrong, missing, extra or in the wrong place.",
        '"you have been at the mall?" instead of "have you been at the mall?"',
        'the correct auxiliaries in correct order ("have you been" for "you have been at the mall?", "have arrived" for '
        '"I am arrived")',
    ),
    (
        "word_order",
        "word order",
        "Words in the order your native language uses instead of the order English uses.",
        '"the strategy of my cousin" instead of "my cousin\'s strategy"',
        'the pattern the user was replicating from their native language ("expressing belonging" for "the strategy of '
        'my cousin")',
    ),
    (
        "native_expression",
        "native expression",
        "Correct English that a native speaker would say another way.",
        '"a practical course will be preferred" instead of "a hands-on course would be preferred"',
        'the correct native expression ("hands-on" for "a practical course")',
    ),
    (
        "preposition",
        "preposition",
        "A wrong, missing or extra preposition.",
        '"depend of" instead of "depend on"',
        'the correct word and preposition ("depend on" for "depend of")',
    ),
    (
        "article",
        "article",
        'A wrong, missing or extra "a/an" or "the".',
        '"the people are selfish" instead of "people are selfish"',
        'the correct article use: "a/an", "the" or "no article" ("no article" for "the people are selfish")',
    ),
    (
        "agreement",
        "agreement",
        "A verb, noun or adjective that does not match its subject or its number.",
        '"he have" instead of "he has"',
        'the agreement rule: "third person -s", "there is/there are", "plural noun", "adjectives take no plural" '
        '("different" for "differents options"), ...',
    ),
    (
        "word_choice",
        "word choice",
        "A real English word that does not mean what you meant.",
        '"button" instead of "key"',
        'the correct word ("key" for "press the G button")',
    ),
    (
        "false_friend",
        "false friend",
        "An English word that looks like a word of your native language but means something else.",
        '"actually" instead of "currently"',
        'the false friend used, never the correct word ("actually" for "I am actually working on it", meant as '
        '"currently")',
    ),
    (
        "countability",
        "countability",
        "An uncountable noun used with a/an or in the plural.",
        '"a research" instead of "research"',
        'the noun in its correct form ("research" for "a research", "information" for "informations")',
    ),
    (
        "missing_subject",
        "missing subject",
        "A clause without its subject, which English always needs.",
        '"is important" instead of "it is important"',
        'the missing subject ("it" for "is important to test")',
    ),
    (
        "verb_pattern",
        "verb pattern",
        "The wrong form after a verb or a preposition: to-infinitive, base form, -ing or that-clause.",
        '"I want that you check" instead of "I want you to check"',
        'the word and the form it takes ("want + object + to-infinitive" for "I want that you check")',
    ),
    (
        "question_form",
        "question form",
        "A direct question without inversion or do, or an indirect question in question order.",
        '"tell me what is it" instead of "tell me what it is"',
        'the rule broken: "no inversion in a direct question", "question order in an indirect question", '
        '"missing do/does/did" or "missing if/whether"',
    ),
    (
        "pronoun",
        "pronoun",
        "A wrong pronoun or possessive: he or she for a thing, a possessive that agrees with the thing owned instead of "
        "the owner, or a subject pronoun where an object pronoun belongs, or the reverse.",
        '"my sister and his husband" instead of "my sister and her husband"',
        'the rule broken: "it for things" ("she returns" for a function), "possessive follows the owner" ("his husband" '
        'for my sister\'s husband), "subject pronoun" ("me and my team will"), "object pronoun" ("between you and I"), ...',
    ),
    ("other", "other", "Any mistake that fits none of the types above.", None, "a short description of the mistake"),
)

# Types that version 2 adds, and the word_choice text of version 1 that version 2 rewrites.
ADDED_IN_2 = ("false_friend", "countability", "missing_subject", "verb_pattern", "question_form")
WORD_CHOICE_1: tuple[str, str, str] = (
    "A real English word that does not mean what you meant, false friends included.",
    '"actually" instead of "currently"',
    'the correct word, false friends included ("currently" for "actually")',
)
# The (description, identifier_rule) of each type that names Spanish up to version 4, which version 5 rewrites to
# name no language.
SPANISH_TEXTS_4: dict[str, tuple[str, str]] = {
    "word_order": (
        "Words in the order Spanish uses instead of the order English uses.",
        'the pattern the user was replicating from Spanish ("expressing belonging" for "the strategy of my cousin")',
    ),
    "false_friend": (
        "An English word that looks like a Spanish word but means something else.",
        'the false friend used, never the correct word ("actually" for "I am actually working on it", '
        'meant as "currently")',
    ),
    "missing_subject": (
        'A clause without its subject, as Spanish allows ("es importante").',
        'the missing subject ("it" for "is important to test")',
    ),
}

# The type that version 6 adds, and the (description, identifier_rule) of each type that version 6 rewrites to cover
# mistakes of Romance-language speakers, as they are up to version 5.
ADDED_IN_6 = ("pronoun",)
ROMANCE_TEXTS_5: dict[str, tuple[str, str]] = {
    "malformed_tense": (
        "The right tense built wrong: auxiliaries missing, extra or in the wrong place.",
        'the auxiliaries in correct order ("have you been" for "you have been at the mall?")',
    ),
    "agreement": (
        "A verb or noun that does not match its subject or its number.",
        'the agreement rule: "third person -s", "there is/there are", "plural noun", ...',
    ),
}
