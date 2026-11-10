# grammar-tracker

Tracks the English mistakes in the prompts a Spanish speaker writes to Claude Code, counts how often each mistake
repeats, and shows the check of the last prompt in a band above the prompt and in a `grammar` pane.

## Requirements

- Python 3.10 or later, run as `python3`. The scripts use the standard library only.
  - The prompt hook (`hooks/hooks.json`) runs `python3` directly, with no shell.
  - The scripts the hooks module runs use the first of `python3`, `py -3` and `python` that starts and is Python 3.
- On Windows, `python3` must be a real `python3.exe` on the `PATH`, such as the one Python from the Microsoft Store
  installs. A python.org install provides only `py` and `python`: the band and the pane then work, but Claude gets no
  grammar check instruction, so no check reaches them.
- On macOS, the `python3` of Apple's Command Line Tools (`/usr/bin/python3`) can be older than 3.10, and the mod then
  shows `Grammar tracker needs Python 3.10 or newer`. Install a newer Python (Homebrew or python.org) and start Claude
  Code from a terminal whose `PATH` finds it first. The Desktop app, started from the Dock, may not see a Homebrew
  `PATH`.
- The database (`grammar.db`) and the error log (`errors.log`) live in the plugin's data folder, which Claude Code
  creates as `~/.claude/plugins/data/grammar-tracker-qol/` for an install from the `qol` marketplace. Updates keep
  it. Uninstalling deletes it, unless you uninstall with `claude plugin uninstall grammar-tracker@qol --keep-data`.

## Data folder

The mod saves your grammar checks in a SQLite database named `grammar.db`. By default, the database is in this
folder:

```
~/.claude/plugins/data/grammar-tracker-qol/
```

The same folder holds `errors.log`, where the mod writes any errors.

## Install

```
/plugin install grammar-tracker --marketplace chaufon/qol
```

The [marketplace README](../../README.md) has the shell command, updates and uninstalling.

## Skip the check for one prompt

Start the prompt with `Claude, do not grammar check` (or `don't grammar check`, `skip grammar check`,
`no grammar check`).

## How it works

1. `scripts/prompt_hook.py` (the mod's `UserPromptSubmit` hook, in `hooks/hooks.json`) asks Claude to start each reply
   with a grammar check of the prompt: the label `**English grammar check:**` and a `grammar-json` block, with no other
   text about the check. The block holds the input mode (typed or dictated), the corrected prompt, and one entry per
   mistake with its type, identifier, original sentence, corrected sentence and a short reason. The instruction lists
   the active types from the `mistake_types` table.
2. The mod's hooks module (`hooks/register.tsx`) watches the streamed reply of the main loop. When the `grammar-json`
   block closes, it runs `scripts/save_check.py` with the turn id, the conversation id, the folder, the prompt, the
   reply so far and the time the prompt was sent. It does not wait for the end of the reply.
3. `save_check.py` reads the `grammar-json` block, saves it to SQLite (`grammar.db`), and prints the corrected prompt
   and each mistake with its reason and counter. The turn id is the key of the saved prompt, so a check is saved once.
4. The band and the pane show the check at once, while the answer still streams. The mod hides the grammar check from
   the reply on screen. The stored reply keeps it (ctrl+o shows it).
5. `prompt_uuid`, the id of the prompt in the transcript, is stored later by `query.py rekey`, which runs at the start
   of each save.

```
prompt ──> prompt_hook.py ──> Claude's reply streams: label + grammar-json block + answer
                                     │
          block closes ──> mod ──> save_check.py ──> grammar.db
                                     │
                       band "✎ ✗ 3 mistakes · ⟳ 1 recurring   g: Hide"
                                     │ the pane opens, or click Show, or ctrl+x tab then g
                       pane: Last prompt (query.py trend) | Top mistakes (query.py top)
```

## Mistake types

The `mistake_types` table in the database holds the types of mistake. Its columns:

| Column | Meaning |
|---|---|
| `key` | Short name that Claude writes in the `grammar-json` block and that `mistakes.type` stores |
| `label` | Name shown in reports |
| `description` | What the type covers |
| `example` | A short example of the mistake |
| `identifier_rule` | How Claude writes the identifier of a mistake of this type |
| `position` | Order of the type in Claude's instruction |
| `deleted_at` | UTC timestamp (ISO 8601) of the deletion; `NULL` while the type is active |

- A type is deleted by setting its `deleted_at`. Deleted types are not in Claude's instruction.
- A key that is unknown or deleted is saved as `other`.
- Saved mistakes keep their type, even after the type is deleted.

## Band and pane

- The band above the prompt shows one line of colored chips for the last prompt, after a teal `✎`: `⠋ Checking…`
  while the reply streams, `✗ 3 mistakes · ⟳ 1 recurring   g: Show` (red and yellow) once the check block closes
  (the pane may be closed; the recurring chip is left out when no mistake is recurring),
  `✓ No mistakes` (green) when the check finds none,
  `Grammar check does not apply to the last prompt` as soon as that line streams, or
  `Grammar: no check for the last prompt` (a new conversation, an interrupted reply, a reply without a check block, or
  a failed save), both dim. Its `Show` button is always there, so the **Top mistakes** tab is always reachable.
- A mistake is recurring when its counter, across all prompts, reaches `RECURRING_THRESHOLD = 3`
  (`scripts/lib/config.py`).
- Open the `✎ Grammar` pane with a click on `Show` (fullscreen terminal) or with `ctrl+x tab` then `g`. Close it with
  `Hide` in the band or the pane, with `g` while the band has the focus, or with `h` or Esc in the pane. It stays open
  across replies.
- The pane opens by itself, without taking the focus and on the **Last prompt** tab, when a saved check arrives. It does
  not open for a check with no mistakes, a check that does not apply, a skipped, interrupted or failed check, or after you hid it by hand. `Show`
  opens it again with the focus and turns the automatic opening back on. An open pane keeps its tab and refreshes. A
  pane the mod opens unasked is held back below 144 columns (110 once you opened it by hand); the band stays the signal.
- To keep the pane closed until you open it, set the `autoOpenPane` option to `false` in `/config` (setting
  `pluginConfigs["grammar-tracker"].options.autoOpenPane` in `settings.json`). The default is `true`. With `false`, the band
  still shows each check, and `Show` opens the pane as usual.
- Claude Code places the pane: a sidebar on the right in the fullscreen layout at 110 columns or more, otherwise a box
  above the prompt.
- The pane's top row switches between its two tabs; the shown one has a colored background. Its last row holds the
  keys, `t: Tab` and `h: Hide`, under a line, and both stay at the bottom while the pane scrolls. `t` switches the tab while the pane
  has the focus.
- **Last prompt** tab: while the reply streams, the tab shows only `⠋ Checking this prompt…`. Then:
  - A mascot drawn with block characters and a headline. The mascot smiles; it looks worried when a mistake of the
    check is recurring. The headline counts the mistakes (`3 mistakes, 1 you keep repeating.`), and the line under it
    names the most frequent recurring mistake (`Watch out for "it" (×59)`). A check with no mistakes shows
    `✓ No mistakes. Great English, keep it up!` in green.
  - Three tiles: **Mistakes** and **Recurring** of this check, and **Clean streak**, the prompts of this
    conversation, counted back from the last one, with no mistake. `–` stands for a streak that failed to load.
  - A trend line, `Conversation ▅▁█▁▁ last 5 prompts`, with one block per prompt of this conversation (the last 10),
    as tall as its mistake count: green and lowest for a clean prompt, yellow otherwise.
  - One card per mistake. The card's border shows an icon of the mistake's type, the type, the identifier, and at the
    right end five dots that fill as the mistake repeats, the counter and `⟳` for a recurring mistake
    (`⇄ Preposition · "check + no preposition"   ●●○○○ ×2`). Inside are the original sentence in red (`✗`), the
    corrected sentence in green (`✓`), Claude's reason, and the type's description and example, dimmed. Recurring
    mistakes have a yellow border. The corrected prompt is in its own card at the end.
- **Top mistakes** tab: the 10 most frequent mistakes, read again each time the tab is shown. It starts with the
  mascot, worried while a mistake recurs and happy otherwise, a headline (`2 mistakes you keep repeating.`) and the
  mistake to watch out for. Three tiles follow: the sum of the counters, the recurring mistakes and the types. Under
  them a bar shows the share of each type in the sum, in the type's color, with the icon and the percentage of each
  type under it. Then one row per mistake: rank, the type's icon, type, identifier, a bar and the counter. The bar is
  as long as the counter's share of the largest counter, and the bar and the counter are yellow for a recurring
  mistake and green otherwise. A click on a row opens a card under it and marks
  the row with `▾`, and a second click closes it; one row is open at a time. The card's
  border shows the type's description (cut with `…` when the border is too short, and then repeated in full inside).
  Inside are the type's example and the most recent original sentence, corrected sentence and reason.
- Every icon is a single character and the mascot is block characters, so the pane needs no image support from the
  terminal. A font without a glyph shows its own placeholder for that icon.
- Failures go to `errors.log` next to the database and never block Claude Code. A failure of the save or of the
  pane's query also shows a toast; a failure of the prompt hook shows nothing.
- When the data folder cannot be created or written (for example, a `CLAUDE_CONFIG_DIR` without write access), the
  hooks and the pane show `Grammar tracker: cannot write to the data folder <path>` instead.

## Query

`top` prints the mistakes you make most often as a JSON list, each with its counter and its latest example, with the
fields of `save_check.py`'s `occurrences`. The optional `N` sets how many (default 10). The pane uses it.

`trend SESSION_ID [N]` prints the mistake count of each of the last `N` prompts (default 10) of one conversation, oldest
first, as a JSON list. The pane uses it for the clean streak and the trend line.

`rekey` stores the transcript uuid of each saved prompt that has none: it finds the user entry of the conversation's
transcript with the same text and the closest time. It prints the number of prompts that got a uuid. Prompts with no
match stay as they are, and a later run tries them again.

```
python3 scripts/query.py top [N]
python3 scripts/query.py trend SESSION_ID [N]
python3 scripts/query.py rekey
```

Run it from the mod's folder. It reads the data folder described in [Data folder](#data-folder); set
`CLAUDE_PLUGIN_DATA` to read another one.

## Layout

| Path | Purpose |
|---|---|
| `scripts/prompt_hook.py` | `UserPromptSubmit` hook: grammar check instruction |
| `scripts/save_check.py` | Saves the reply's `grammar-json` block and prints the check with its counters |
| `scripts/query.py` | Command line query on the database (`top`, `trend`, `rekey`) |
| `scripts/lib/` | Configuration, error log, instruction text, transcript parsing, re-keying, database, report formatting |
| `.claude-plugin/plugin.json` | Mod manifest |
| `hooks/hooks.json` | Names the hooks module and the `UserPromptSubmit` command hook |
| `hooks/register.tsx` | Hooks module: watches the streamed reply, runs `save_check.py`, draws the band and the pane, hides the check from the reply |
| `hooks/register.test.ts` | Tests of the hooks module (`claude plugin test`) |
| `tsconfig.json` | TypeScript settings for the type check |
| `types/index.d.ts` | Type contract of the mod's `$.state` values |
| `tests/` | pytest suite of the Python scripts |

## Develop

From the repository root:

```
claude --plugin-dir plugins/grammar-tracker
claude plugin validate plugins/grammar-tracker
claude plugin test plugins/grammar-tracker
npx -y -p typescript tsc -p plugins/grammar-tracker
python3 -m pytest plugins/grammar-tracker
```

`pytest` must be installed for the last command. The type check needs `plugins/grammar-tracker/.claude-plugin/types/`,
which Claude Code writes the first time it loads the mod.

In a session started with `--plugin-dir`, the command hooks use `~/.claude/plugins/data/grammar-tracker-inline/` and
the scripts the hooks module runs use `grammar-tracker-qol/`.

## Status

- Grammar check, `grammar-json` block, database storage, band and pane work in the terminal.
- The Desktop app is not verified yet.
- The Claude mobile app (Remote Control) draws no mods: it shows the full reply with the grammar check, and no band or
  pane.
- Sessions that run in Anthropic's cloud (Claude Code on the web) have no access to the mod or the local database.
