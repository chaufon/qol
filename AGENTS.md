# qol

A Claude Code plugin marketplace: four mods in `plugins/<name>/`, listed in `.claude-plugin/marketplace.json`.

## Rules

- **Each mod stands alone.** A mod imports only from `'claude-code'` and its own folder, and never needs another mod
  installed. It draws in its own places (its own band line, pane or command) and passes every event on with
  `next(e)`, so mods stack in any load order.
- **End users install nothing.** At runtime a mod uses what Claude Code provides, plus the Python standard library for
  grammar-tracker's scripts (Python 3.10+). Development tools live at the root, in `package.json` and `pyproject.toml`.
- **Words follow `GLOSSARY.md`.** For example, "conversation" and "5-hour window", never "session".
- **A release raises `version`** in `plugins/<name>/.claude-plugin/plugin.json`: minor for a feature, patch for a
  fix. Claude Code offers an update only when that field changes.
- **TypeScript follows the `typescript-standards` skill** (`.claude/skills/typescript-standards/`).

## Checks

From the repository root, after `npm install` and `uv sync`:

```
npm run check                      # tsc, ESLint, Prettier for every mod
claude plugin test plugins/<name>  # a mod's tests
uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest   # grammar-tracker's Python
```

A change is done when these are green and the mod works in a session started with
`claude --plugin-dir plugins/<name>`.
