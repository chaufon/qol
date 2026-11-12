# grammar-tracker architecture

How the mod works, where its data lives, and how to develop it. The [README](../README.md) covers installing and using
the mod.

## Design

- **Two runtimes, one job each.** A TypeScript hooks module runs inside Claude Code: it changes the prompt, watches
  the reply and draws the UI. Python scripts own the data: they build the instruction, parse the check, and read and
  write SQLite. The scripts use the Python standard library only, so a user installs nothing beyond Python.
- **Claude does the checking.** The mod adds an instruction to each prompt and asks Claude to start its reply with a
  machine-readable `grammar-json` block. No other model or service is called.
- **The check is saved while the reply streams.** The mod saves the block as soon as it closes, so the band and the
  pane show the check while Claude is still answering.
- **Failures never block Claude Code.** Every failure goes to `errors.log`, and the prompt or reply goes on without
  the check.

## Flow

```
prompt ──> hooks module ──> prompt_context.py ──> instruction added to the prompt, for Claude alone
                                      │
Claude's reply streams: label + grammar-json block + answer
                                      │ block closes
          hooks module ──> save_check.py ──> grammar.db
                                      │
                       band "✎ ✗ 3 mistakes · ⟳ 1 recurring   g: Hide"
                                      │ the pane opens, or Show, or ctrl+x tab then g
                       pane: Last prompt (query.py trend) | Top mistakes (query.py top)
```

1. When the user submits a prompt, the hooks module runs `scripts/prompt_context.py` and attaches the text it prints
   to the prompt, for Claude alone. The text asks Claude to start the reply with the label
   `**English grammar check:**` and a `grammar-json` block, with no other text about the check. The block holds the
   input mode (typed or dictated), the corrected prompt, and one entry per mistake with its type, identifier,
   original sentence, corrected sentence and a short reason. The instruction lists the active types from the
   `mistake_types` table.
2. The hooks module watches the streamed reply of the main loop. When the `grammar-json` block closes, it runs
   `scripts/save_check.py` with the turn id, the conversation id, the folder, the prompt, the reply so far and the
   time the prompt was sent.
3. `save_check.py` reads the block, saves it to `grammar.db`, and prints the corrected prompt and each mistake with its
   reason and counter. The turn id is the key of the saved prompt, so a check is saved once.
4. The band and the pane show the check at once. The mod hides the check from the reply on screen; the stored reply
   keeps it (ctrl+o shows it).
5. `query.py rekey`, which runs at the start of each save, stores `prompt_uuid`, the id of the prompt in the
   transcript.

## Modules

### Hooks module (TypeScript)

| Path | Job |
| --- | --- |
| `hooks/register.tsx` | Entry point: the mod's state, the event handlers (prompt, turn, reply stream, render), opening and closing the pane |
| `hooks/check.ts` | Reading the reply (`stripCheck`, `checkState`) and the scripts' JSON output |
| `hooks/python.ts` | Finding Python (`python3`, then `py -3`, then `python`) and running a script |
| `hooks/draw.tsx` | Drawing the band and the pane from plain props; no state of its own |
| `hooks/format.ts` | Widths, bars, meters, sparklines, and the icon and color of each mistake type |
| `hooks/mascot.ts` | The block-character mascot, happy or worried |
| `hooks/*.test.ts` | Tests: pure modules tested directly, handlers through `claude-code/testing` |
| `hooks/hooks.json` | Names the hooks module |
| `types/index.d.ts` | Types of the mod's state |

### Scripts (Python)

| Path | Job |
| --- | --- |
| `scripts/prompt_context.py` | Prints the grammar check instruction for a prompt |
| `scripts/save_check.py` | Saves the reply's `grammar-json` block and prints the check with its counters |
| `scripts/query.py` | Command-line queries on the database: `top`, `trend`, `rekey` |
| `scripts/lib/config.py` | Paths, native languages, the recurring threshold |
| `scripts/lib/db.py` | Schema, migrations, saving and querying |
| `scripts/lib/mistake_types.py` | The text of every mistake type, and the texts the migrations replace |
| `scripts/lib/instruction.py` | The instruction text |
| `scripts/lib/transcript.py` | Reading Claude Code transcripts |
| `scripts/lib/rekey.py` | Matching saved prompts to transcript entries |
| `scripts/lib/report.py` | The JSON fields the hooks module reads |
| `scripts/lib/errorlog.py` | Writing `errors.log` |

## Data

The database is `grammar.db` in the mod's data folder, `~/.claude/plugins/data/grammar-tracker-qol/` for an install
from the `qol` marketplace. `CLAUDE_PLUGIN_DATA` points the scripts at another folder.

| Table | Holds |
| --- | --- |
| `prompts` | One row per checked prompt: turn id, transcript uuid, conversation id, time, folder, input mode, original and corrected text |
| `mistake_types` | The types of mistake that the instruction lists |
| `mistakes` | One row per distinct mistake: its type and identifier |
| `occurrences` | One row per time a mistake appears in a prompt: original and corrected sentence, reason |

A mistake's counter is the number of its occurrences. A mistake is recurring when its counter reaches
`RECURRING_THRESHOLD = 3` (`scripts/lib/config.py`).

The schema has a version (`VERSION` in `scripts/lib/db.py`). Opening an older database runs the migrations up to the
current version. A database newer than the mod refuses to open, and the error asks the user to update the mod.

### Mistake types

The `mistake_types` table:

| Column | Meaning |
| --- | --- |
| `key` | Short name that Claude writes in the `grammar-json` block and that `mistakes.type` stores |
| `label` | Name shown in the pane |
| `description` | What the type covers |
| `example` | A short example of the mistake |
| `identifier_rule` | How Claude writes the identifier of a mistake of this type, so the same mistake always gets the same identifier |
| `position` | Order of the type in the instruction |
| `deleted_at` | UTC timestamp (ISO 8601) of the deletion; `NULL` while the type is active |

- A deleted type is left out of the instruction.
- A key that is unknown or deleted is saved as `other`.
- Saved mistakes keep their type after the type is deleted.

### Native language

The `native_language` option reaches `scripts/prompt_context.py`, which checks it against `NATIVE_LANGUAGES` in
`scripts/lib/config.py` and names it in the instruction. A missing or unknown value gives Spanish, and an unknown
value also writes a line to `errors.log`. A test keeps `NATIVE_LANGUAGES` equal to the `options` of
`userConfig.native_language` in `.claude-plugin/plugin.json`.

## Query

```
python3 scripts/query.py top [N]
python3 scripts/query.py trend SESSION_ID [N]
python3 scripts/query.py rekey
```

- `top` prints the N mistakes with the largest counters (default 10) as JSON, each with its latest example.
- `trend` prints the mistake count of each of the last N prompts of one conversation (default 10), oldest first.
- `rekey` stores the transcript uuid of each saved prompt that has none, by matching the text and the closest time.
  Prompts with no match are tried again on the next run.

Run it from the mod's folder, with `py -3` or `python` in place of `python3` where that is your Python.

## Develop

Set up the development tools once from the repository root (see the [root README](../../../README.md#develop)), then:

```
claude --plugin-dir plugins/grammar-tracker     # a session with this folder's mod loaded
npm run check                                   # type check, ESLint, Prettier
claude plugin test plugins/grammar-tracker      # hooks module tests
uv run pytest                                   # Python tests
uv run mypy                                     # Python type check (strict)
```

A session started with `--plugin-dir` uses the same data folder as an install.

`tests/test_live_check.py` tests the grammar check itself. It sends prompts with mistakes typical of each native
language, and correct prompts, to Claude through `claude -p` with the mod loaded, and checks what the check reports.
These tests cost tokens and depend on the model's answer, so pytest skips them unless `GRAMMAR_TRACKER_LIVE=1` is set.
`GRAMMAR_TRACKER_LIVE_MODEL` picks the model. They write nothing to the real `grammar.db`.

```
GRAMMAR_TRACKER_LIVE=1 uv run pytest plugins/grammar-tracker/tests/test_live_check.py
```
