# conversation-usage

Shows where the usage of a subscription goes: the tokens and the estimated cost of each request of the current
conversation, the totals of the current 5-hour and 7-day windows, and a history of every stored conversation. The
figures are a measure of usage at API prices, not a bill.

A line in the band above the prompt holds the conversation total and a `Show` button:

```
Usage · 372.3k tokens · $0.74   Show
```

The button opens a `Usage` pane. The pane is closed by default and never opens by itself.

## Pane

- **Conversation** tab: one row per request, with its number, its time, the tools it called, and its input, cache
  write, cache read, output and total tokens. A subagent has a row of its own under the request that launched it,
  with its totals and its request count (`▸ N`). A click on its name opens its requests. Under a rule, three totals
  follow: the conversation, the current 5-hour window and the current 7-day window.
- **History** tab: every stored conversation, with its start time, title and totals, in cards that open and close.
  A **card** groups the conversations of one project, or of one 5-hour window. Three groupings:
  - **Date**: day, then project card, then conversation.
  - **Project**: project card, then day, then conversation.
  - **Window**: 7-day window, then 5-hour window card, then conversation. A conversation that spans two windows
    appears in both, and each copy counts only the requests made inside that window.
- Four views show the same rows: **Tokens**, **Cost** (estimated cost per token type), **Both**, and **Chart** (one
  bar per request, split by token type).

A conversation's title is its last `/rename` title, else its generated title, else the start of its first prompt. Its
project is the last segment of the working directory it started in.

## Keys

| Key | Action | Where |
| --- | --- | --- |
| `u` | Open or close the pane | the band above the prompt |
| `t` | Switch tab | the pane |
| `v` | Next view | the pane |
| `g` | Next grouping | the History tab |
| Enter or click | Open or close the focused row or card | the pane |
| Esc | Close the pane | the pane |

The keys work while the band or the pane has the focus (click it, or press ctrl+x then tab). The `/conversation-usage`
command opens the pane, or closes it when it is open.

## Requirements

- Linux or macOS. The mod reads transcripts with `find`, `tail` and `cat`, and measures a line of a transcript that is
  too large for one read with `sh`. Windows is not supported.
- `sqlite3` on the `PATH`. Without it the History tab shows `Usage history needs sqlite3 on the PATH`.

## Data

- Transcripts are read from `<config folder>/projects`. The config folder is `CLAUDE_CONFIG_DIR`, else `~/.claude`.
- The database is `<config folder>/conversation-usage.db`. The mod saves each request it reads, and counts a request
  once however many transcript lines it spans. Updates keep the file, and uninstalling leaves it in place.
- History holds only the conversations the mod has seen while it was loaded. A conversation that was already running
  when the mod loaded is stored in full, because the mod reads its whole transcript. Transcripts that were never
  open while the mod was loaded are not imported.
- A window appears in the totals and in History once the mod has observed it from the rate limits Claude Code reports.

## Install

```
/plugin install conversation-usage --marketplace chaufon/qol
```

The [marketplace README](../../README.md) has the shell command, updates and uninstalling.

## Develop

From the repository root:

```
claude --plugin-dir plugins/conversation-usage
claude plugin validate plugins/conversation-usage
claude plugin test plugins/conversation-usage
npx -y -p typescript tsc -p plugins/conversation-usage
```

The type check needs `plugins/conversation-usage/.claude-plugin/types/`, which Claude Code writes the first time it
loads the mod.
