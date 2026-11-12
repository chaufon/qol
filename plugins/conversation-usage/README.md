# conversation-usage

Shows where the usage of a subscription goes: the tokens and the estimated cost of each request of the current
conversation, the totals of the current 5-hour and 7-day windows, and a history of every stored conversation. The
figures are a measure of usage at API prices, not a bill.

A line in the band above the prompt holds the conversation total and a `Show` button:

```
Usage · 372.3k tokens · $0.74   Show
```

The button opens a `◔ Usage` pane. The pane is closed by default and never opens by itself.

## Pane

The pane's top row switches the tab. Its bottom rows switch the view (on the left) and the grouping (on the right),
then hold the keys of the tab on show, each under a line. They stay at the bottom while the pane scrolls. The shown
tab, view and grouping have a colored background. Each table has a dashed line under its column names. A row that
opens and closes starts with a triangle: `▸` while it is closed, `▾` while it is open. Its count is at the end of the
row.

- **Conversation** tab: one row per prompt, with its number, its time, its first line, the totals of every request
  it started, and its request count (`req`). A click on a prompt opens its requests; the last prompt is open until
  it is clicked. A slash command counts as a prompt, and a prompt that made no request, such as `/clear`, has no
  row. A request row holds its number, its time, the tools it called (`—` when it called none, as in a final
  answer), and its input, cache write, cache read, output and total tokens. A subagent has a row of its own under
  the request that launched it, with its totals and its request count. A click on its name opens its requests.
  Under a dashed line, three totals follow: the conversation, the current 5-hour window and the current 7-day window. A
  conversation with no requests yet shows only these totals.
- **History** tab: every stored conversation on one row, with its start time, title and totals, under headings
  that open and close. A conversation opens to its prompts, as in the Conversation tab, all closed. A heading
  that holds other headings is on a darker band. A heading that holds conversations has a dashed line under it
  while it is open. Every level starts at the left edge. Three groupings:
  - **Date**: day, then project, then conversation.
  - **Project**: project, then day, then conversation.
  - **Window**: 7-day window, then 5-hour window, then conversation. A conversation that spans two windows
    appears in both, and each copy counts only the requests made inside that window. A copy that starts before its
    window has `↳` before its title.
- **Prices** tab: the newest price list, one row per model in USD per million tokens, for input, a 5-minute cache
  write, a 1-hour cache write, a cache read and output. A model priced by prompt length has a second row, such as
  `claude-haiku-5-5 >100,000`, with the prices of a request whose prompt (input, cache writes and cache reads) is
  over that many tokens. Under a dashed line, bullets give where the list comes from, the date it took effect and
  the date it was last checked, the error of the last download when it failed, and the fast mode factors. See
  [Prices](#prices).
- Four views show the same rows in the Conversation and History tabs: **Tokens**, **Cost** (estimated cost per token type), **Both**, and **Chart** (one
  bar per request, split by token type).

A conversation's title is its last `/rename` title, else its generated title, else the start of its first prompt. Its
project is the last segment of the working directory it started in.

## Prices

The cost of a request is its tokens of each type times the prices of its model. The prices come from the official
pricing page, `https://platform.claude.com/docs/en/about-claude/pricing.md`. No Anthropic API returns prices.

- **Download.** When the mod refreshes, it downloads the page if the newest downloaded list was checked more than a day
  ago, or if no list has been downloaded yet. After a failed download it waits an hour before it tries again. It
  downloads nothing while `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.
- **Dated lists.** Each list is stored in the database with the date it took effect. A download with the same prices
  as the newest list only updates its check date. A download with different prices starts a new list that takes
  effect at the time of the download. A request is priced with the newest list in effect when it ran. A request
  older than every list that names its model takes that model's oldest list.
- **Built-in prices.** The mod holds the prices read from the page on 11 Nov 2026. They are in effect for every
  request older than the first downloaded list, and for every model no downloaded list names. They are also used
  until a download succeeds.
- **Stored costs.** Whenever prices change, every stored request is priced again, so History and the window totals
  always use the current lists.
- **Model ids.** The page names models, such as `Claude Opus 5.5`. The mod turns a name into its model id:
  `claude-opus-5-5`. A request's model id is the one the API returned. It prices only under the exact id, with or
  without a trailing date (`-20251001`, `@20251001`) or tag (`[1m]`). A new model, or a new version of a model, has no
  cost, shown as `?`, until a list names it.
- **Factors.** Fast mode multiplies every price by the model's fast input price over its base input price. Effort does
  not change the price per token: higher effort uses more tokens, which are counted. The 1.1x price of US-only
  inference (`inference_geo`) is not applied.

## Keys

| Key | Action | Where |
| --- | --- | --- |
| `u` | Open or close the pane | the band above the prompt |
| `t` | Switch tab | the pane |
| `v` | Next view | the Conversation and History tabs |
| `g` | Next grouping | the History tab |
| `h` | Close the pane | the pane |
| Enter or click | Open or close the focused row | the pane |
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
  once however many transcript lines it spans. It also holds the price lists. Updates keep the file, and
  uninstalling leaves it in place.
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
npm run typecheck
npx -y tsx plugins/conversation-usage/tests/sql-check.ts
```

`tests/sql-check.ts` runs the SQL against a real `sqlite3` and checks that the stored costs equal the costs the mod
computes in memory.

The type check needs `plugins/conversation-usage/.claude-plugin/types/`, which Claude Code writes the first time it
loads the mod.
