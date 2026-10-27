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

Claude Code gives the data folder, `CLAUDE_PLUGIN_DATA`, to the mod's command hooks and not to its hooks module
(`hooks/register.tsx`). The scripts the hooks module runs find the folder by the name Claude Code gives it,
`grammar-tracker-qol`, in Claude Code's plugins folder: `$CLAUDE_CODE_PLUGIN_CACHE_DIR/data/`, else
`$CLAUDE_CONFIG_DIR/plugins/data/`, else `~/.claude/plugins/data/` (`PLUGIN_DATA` in `scripts/lib/config.py`). This
works from the first prompt after an install and `/reload-plugins`, for an install from GitHub or from a local copy of
the `qol` marketplace.

When `CLAUDE_PLUGIN_DATA` and `PLUGIN_DATA` differ, `scripts/prompt_hook.py` writes both paths to the `errors.log`
in `CLAUDE_PLUGIN_DATA` on each prompt. That happens when the mod is installed from a marketplace with another name,
or loaded with `--plugin-dir`.

`grammar.db` stores its schema version in the SQLite file header (`PRAGMA user_version`). On each connection,
`scripts/lib/db.py` upgrades an older file to its `VERSION` and refuses a newer one: the file stays unchanged, the
error goes to `errors.log`, and the toast or the **Top mistakes** tab asks you to update the mod.

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
2. At the end of each turn, the mod's hooks module (`hooks/register.tsx`) runs `scripts/stop_hook.py` with the session
   id and Claude's last reply.
3. `stop_hook.py` reads the `grammar-json` block, saves it to SQLite (`grammar.db`), and prints the corrected prompt
   and each mistake with its reason and counter.
4. The mod keeps that check for the band and the pane, and hides the grammar check from the reply on screen. The stored
   reply keeps it (ctrl+o shows it).

```
prompt ──> prompt_hook.py ──> Claude's reply: label + grammar-json block + answer
                                     │
              turn ends ──> mod ──> stop_hook.py ──> grammar.db
                                     │
                       band "Grammar: 3 mistakes, 1 recurring   g: Show"
                                     │ click Show, or ctrl+x tab then g
                       pane: Last prompt | Top mistakes (query.py top)
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

- The band above the prompt shows one line for the last prompt: `Grammar: 3 mistakes, 1 recurring   g: Show`,
  `Grammar check does not apply to the last prompt`, or `Grammar: no check for the last prompt` (a new session, a
  skipped check, or a failed one). Its `Show` button is always there, so the **Top mistakes** tab is always reachable.
- A mistake is recurring when its counter, across all prompts, reaches `RECURRING_THRESHOLD = 3`
  (`scripts/lib/config.py`).
- Open the `grammar` pane with a click on `Show` (fullscreen terminal) or with `ctrl+x tab` then `g`. Close it with
  `Hide` in the band or the pane, with `g` while the band has the focus, or with Esc in the pane. It is closed by
  default and stays open across replies.
- Claude Code places the pane: a sidebar on the right in the fullscreen layout at 110 columns or more, otherwise a box
  above the prompt.
- **Last prompt** tab: one card per mistake. The card's border shows the number, type, identifier and counter
  (`1 · Word choice · "looks like" ×3 ⟳`). Inside are the original sentence in red (`✗`), the corrected sentence in
  green (`✓`), Claude's reason, and the type's description and example, dimmed. Recurring mistakes have a yellow
  border and `⟳`. The corrected prompt is in its own card at the end.
- **Top mistakes** tab: a table of the 10 most frequent mistakes with rank, type, identifier and a bar with the
  counter. A click on a row opens a card under it, and a second click closes it; one row is open at a time. The card's
  border shows the type's description (cut with `…` when the border is too short, and then repeated in full inside).
  Inside are the type's example and the most recent original sentence, corrected sentence and reason.
- Failures go to `errors.log` next to the database and never block Claude Code. A failure of the stop hook or of the
  pane's query also shows a toast; a failure of the prompt hook shows nothing.
- When the data folder cannot be created or written (for example, a `CLAUDE_CONFIG_DIR` without write access), the
  hooks and the pane show `Grammar tracker: cannot write to the data folder <path>` instead.

## Query

`top` prints the mistakes you make most often as a JSON list, each with its counter and its latest example, with the
fields of the stop hook's `occurrences`. The optional `N` sets how many (default 10). The pane uses it.

```
python3 scripts/query.py top [N]
```

Run it from the mod's folder. It reads the data folder described in [Data folder](#data-folder); set
`CLAUDE_PLUGIN_DATA` to read another one.

## Layout

| Path | Purpose |
|---|---|
| `scripts/prompt_hook.py` | `UserPromptSubmit` hook: grammar check instruction |
| `scripts/stop_hook.py` | Saves the reply's `grammar-json` block and prints the check with its counters |
| `scripts/query.py` | Command line query on the database (`top`) |
| `scripts/lib/` | Configuration, error log, instruction text, transcript parsing, database, report formatting |
| `.claude-plugin/plugin.json` | Mod manifest |
| `hooks/hooks.json` | Names the hooks module and the `UserPromptSubmit` command hook |
| `hooks/register.tsx` | Hooks module: runs `stop_hook.py`, draws the band and the pane, hides the check from the reply |
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
