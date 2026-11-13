# qol

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![grammar-tracker](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fchaufon%2Fqol%2Fmain%2Fplugins%2Fgrammar-tracker%2F.claude-plugin%2Fplugin.json&query=%24.version&label=grammar-tracker)](plugins/grammar-tracker)

Quality-of-life mods for Claude Code: four plugins that change Claude Code's own interface, each one installable on
its own from this marketplace.

The showcase is **[grammar-tracker](plugins/grammar-tracker)**: it checks the English of every prompt you write to
Claude, shows your mistakes beside the chat while Claude answers, and tracks the ones you keep repeating.

<!-- GIF: grammar-tracker checking a prompt, the band and the pane -->

| Mod | What it does |
| --- | --- |
| [grammar-tracker](plugins/grammar-tracker) | Checks the English grammar of each prompt, counts repeated mistakes, and shows the check in a band and a pane. Needs Python 3.10 or later as `python3`, `py` or `python`, on Linux, macOS and Windows |
| [conversation-usage](plugins/conversation-usage) | Shows the tokens and estimated cost of each request of a conversation, the totals of the 5-hour and 7-day windows, and a history of stored conversations, in a band and a pane. Needs `sqlite3`, on Linux and macOS |
| [usage-footer](plugins/usage-footer) | Shows context usage, the 5-hour and 7-day rate-limit windows and their reset times at the right of the prompt footer |
| [file-links](plugins/file-links) | Makes the file references in Claude's replies clickable and opens the file at that line in a side pane. Clicks work in the fullscreen terminal |

## Architecture

Each mod is a TypeScript hooks module that Claude Code loads into its own process. The module hooks into events
(prompt submitted, reply streaming, turn complete, UI render) and draws with Claude Code's terminal components.

```
Claude Code
├── prompt.submit ──┐
├── turn.step ──────┤        ┌── grammar-tracker ──── Python scripts ── SQLite (grammar.db)
├── turn.complete ──┼──────> ├── conversation-usage ── sqlite3 CLI ──── SQLite
└── ui.render ──────┘        ├── usage-footer
                             └── file-links
```

- Every mod is independent: it passes each event on unchanged, so any set of mods stacks in any order.
- Users install nothing beyond Claude Code (and Python for grammar-tracker). All data stays on the user's machine.
- [grammar-tracker's architecture](plugins/grammar-tracker/docs/ARCHITECTURE.md) shows one mod in depth.

## Built with Claude Code

I designed, built, tested and released these mods with Claude Code as my pair. I set the direction and the quality
bar; the agents did most of the typing. The repository keeps the parts of that workflow that make it repeatable:

- **Project instructions:** [`AGENTS.md`](AGENTS.md) holds the rules every agent follows here, and
  [`GLOSSARY.md`](GLOSSARY.md) fixes the words the mods use, so the UI and the code say the same thing.
- **A project skill:** [`typescript-standards`](.claude/skills/typescript-standards/SKILL.md) gives the agent the
  conventions that ESLint and Prettier cannot check.
- **Specs before code:** [`docs/superpowers/`](docs/superpowers) holds the design spec and implementation plan written
  before conversation-usage was built.
- **Guardrails:** strict TypeScript and typescript-eslint, Prettier, ruff, strict mypy, and tests at three levels:
  unit tests, hooks tests through Claude Code's test harness, and live tests that send real prompts to Claude and
  check the grammar it reports.
- **Review:** each release goes through an agent code review (`/code-review`), and every finding is verified before
  it is fixed.

## Install

At the prompt of a Claude Code terminal session, one line per mod:

```
/plugin install usage-footer --marketplace chaufon/qol
/plugin install grammar-tracker --marketplace chaufon/qol
/plugin install conversation-usage --marketplace chaufon/qol
/plugin install file-links --marketplace chaufon/qol
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

From a shell:

```
claude plugin install usage-footer --marketplace chaufon/qol
claude plugin install grammar-tracker --marketplace chaufon/qol
claude plugin install conversation-usage --marketplace chaufon/qol
claude plugin install file-links --marketplace chaufon/qol
```

A private repository installs only on machines that hold a git credential for github.com (an SSH key, or `gh auth login` followed by `gh auth setup-git`).

## Update

Claude Code does not update mods from this marketplace on its own. Get a new version from a shell:

```
claude plugin marketplace update qol
claude plugin update usage-footer@qol
claude plugin update grammar-tracker@qol
claude plugin update conversation-usage@qol
claude plugin update file-links@qol
```

Then run `/reload-plugins` in an open session, or start a new session.

A mod added to the marketplace after your first install is not installed by the update. Install it by name once the marketplace is updated:

```
claude plugin marketplace update qol
claude plugin install file-links@qol
```

To receive new versions without commands, turn on auto-update once: run `/plugin`, open the **Marketplaces** tab, select `qol` and choose **Enable auto-update**. New versions load in the next session or after `/reload-plugins`.

## Uninstall

Remove one mod and keep the marketplace:

```
claude plugin uninstall usage-footer@qol
claude plugin uninstall grammar-tracker@qol
claude plugin uninstall conversation-usage@qol
claude plugin uninstall file-links@qol
```

Uninstalling grammar-tracker deletes its mistake history. To keep it, uninstall with `--keep-data`:

```
claude plugin uninstall grammar-tracker@qol --keep-data
```

Remove the marketplace and every mod installed from it:

```
claude plugin marketplace remove qol
```

## Develop

The mods need nothing installed beyond Claude Code (and Python 3.10 or newer for grammar-tracker). The tools below are
for development only. They are declared at the repository root, in `package.json` and `pyproject.toml`, and no mod
loads them.

Set up the tools once, with Node.js and [uv](https://docs.astral.sh/uv/):

```
npm install
uv sync
```

Run a session with a mod loaded from this folder (repeat `--plugin-dir` to load more than one):

```
claude --plugin-dir plugins/usage-footer
```

Check every mod:

```
npm run check                 # type check, ESLint and Prettier
uv run ruff check             # Python lint
uv run ruff format --check    # Python format
uv run mypy                   # Python type check
uv run pytest                 # Python tests
claude plugin test plugins/usage-footer
claude plugin validate plugins/usage-footer
```

The type check needs `plugins/<mod>/.claude-plugin/types/`, which Claude Code writes the first time it loads the mod.

Release a new version by raising `version` in the mod's `.claude-plugin/plugin.json` in the same push as the change. Claude Code compares that field to decide whether an update exists, so a push that keeps the same `version` reaches no one.
