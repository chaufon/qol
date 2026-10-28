# conversation-usage: design

A Claude Code mod in the qol repo at `plugins/conversation-usage/`. It shows a hidden-by-default pane with two tabs:
- **Conversation**: every request of the current conversation.
- **History**: every stored conversation, grouped by date, by project or by window.

It saves every request it sees to a local SQLite database.

Terms follow `GLOSSARY.md` at the repo root: conversation, 5-hour window, 7-day window, request, subagent, the four token types, total tokens, estimated cost, conversation total, window total. The mod's text never says "session".

## Intent

The user has a subscription and wants to see where the usage goes:
- which requests of a conversation were expensive and what they called
- how much a subagent used
- how much the current 5-hour and 7-day windows hold
- over time, how usage splits across days, projects and windows

Dollar figures are a measure of usage at API prices, not a bill.

## Goals

- See each request of the current conversation, with its tokens by type, its estimated cost and the tools it called.
- See each subagent as one row with its totals, and open it to see its own requests.
- See the conversation total and the two window totals.
- Keep every request in a database, and browse past conversations in the History tab.

## Non-goals

- **Importing transcripts that already exist on disk.** This is a separate, later task. History holds only the conversations the mod has seen while it was loaded. A conversation that was already running when the mod loaded is stored in full, because its whole transcript is read.
- The "total cards" layout (style 3 in the brainstorm). Leave it out.
- Showing a bill or the subscription's real cost.

## Anti-goals

- The pane never opens by itself. It must not take space until the user asks for it.
- No figure may count a request twice. A transcript writes one response as several lines (see Data).
- The mod's text never uses "session" for a conversation or a window.

## Where it shows

- **The Usage line:** one line in the band above the prompt (a `ui.render` hook on `{ component: 'AbovePrompt' }`), the way `grammar-tracker` draws its line (`plugins/grammar-tracker/hooks/register.tsx:206`).
  - The hook calls `next(e)` first and adds its line below the result, so it stacks with other mods' lines in either load order.
  - It returns `next(e)` alone while a survey shows (`e.props.hasSurvey`), as `grammar-tracker` does.
  - The line is dim text with the conversation total, then a plain `Button` that opens or closes the pane. For example: `Usage · 372.3k tokens · $0.74   Show`. The button reads `Hide` while the pane is open.
  - The button's hotkey is `u`. `grammar-tracker`'s band button already uses `g`.
- **The mod depends on no other mod.** It works alone, and also beside `usage-footer` and `grammar-tracker`.
- **Slash command:** `/conversation-usage` opens the pane, or closes it if it is open.
- **The pane** is opened with `$.ui.open({ id, title })` and drawn by a `ui.render` hook on `{ component: 'Pane', requestId: id }`. It is hidden by default. Size the tree to `e.props.bodyColumns`. The mockups are about 72 columns wide.
- **Tabs:** the pane draws its own tab row, `Conversation` and `History`. Press `t` or click a tab to switch. The engine's own pane tabs are not used, because they would mix in other mods' panes.

## Conversation tab

### Rows

One row per request, in order:
- the request number
- the time (HH:MM)
- the tools called (comma-separated names, `—` for none)
- input, cache write, cache read, output and total tokens

Output tokens include thinking tokens.

### Subagents

- A subagent is a normal row in the same columns, holding its totals. Its numbers change with the view like any other row.
- Its name is cyan, underlined and clickable, and the row ends with `▸ N`, where N is its request count.
- Click it, or focus it and press Enter, to open it. `▾` shows it is open.
- Its requests appear under it in the same columns, not indented, with a cyan `┃` on the left. They are numbered 1, 2, 3.
- Its requests count in the conversation total.
- **My call: placement.**
  - The request that launched the subagent stays a normal numbered row, with its own tokens and `Agent` among its tools.
  - Each subagent it launched gets its own row directly below it. That row is not numbered: the number column shows `↳`.
  - Parallel subagents give several rows, in launch order.
  - Main requests are numbered 1, 2, 3 without counting subagent rows. A subagent's own total holds only its own requests.
- **My call: nested subagents.** A subagent launched by another subagent (`spawnDepth` 2 in its meta file, `toolUseId` pointing into the parent subagent's transcript) is a subagent row inside its parent's opened requests. Its own requests carry a second `┃`. Store a parent link for each subagent.

### Totals

Under a rule, three rows:
1. **Conversation**: on a darker band.
2. **5-hour window (HH:MM)**: the label in the accent color, the time being the window's reset time.
3. **7-day window (Ddd)**: likewise, with the reset day.

A window total is the sum of every stored request made inside that window, in any conversation and any project. A conversation that began before the window opened counts only the requests made after it opened.

### Four views on one switch

Press `v` or click the switch to cycle: **Tokens → Cost → Both → Chart → Tokens**. The current view applies to both tabs.

- **Tokens:** token counts.
- **Cost:** the estimated cost per token type, plus a total.
- **Both:** two lines per row, tokens then costs.
- **Chart:**
  - One bar per request, built from the four token types, with total tokens and total cost beside it.
  - Request bars share one scale, so the largest request fills the column.
  - Each total row's bar fills the column and shows only the token mix.
  - A legend sits above the bars.

### Style

Use the colors in the `C` dict of `/tmp/mockgen/gen.py`:

| Item | Color |
|---|---|
| input | blue `#61afef` |
| cache write | amber `#e5c07b` |
| cache read | green `#98c379` |
| output | purple `#c678dd` |
| total | bold white |
| costs | yellow `#f0c674` |
| subagents | cyan `#56b6c2` |
| window labels | accent `#d19a66` |
| dim text | `#7f848e` |

- Alternate rows are striped.
- The conversation total sits on a darker band.
- In fullscreen, the row under the pointer gets a lighter background (`hover` on a keyed `Box`).

The approved look is `.superpowers/brainstorm/326453-1793154900/content/four-views.html`. That folder is ignored through `.git/info/exclude`. Where the mockups differ from this document, the document wins:
- The mockups show `$` on the view switch, but the key is `v`.
- The mockups merge a subagent into the request that launched it, but the subagent goes on a row of its own (see Subagents).

## History tab

The mockups are `history-tab-v2.html` and `history-groups.html` in the same folder. Proposal **A** of `history-groups.html` is the chosen one.

### Groupings

A switch with three choices, cycled with `g` or by clicking:

| Grouping | Levels |
|---|---|
| **By date** (default) | day → project card → conversation |
| **By project** | project card → day → conversation |
| **By window** | 7-day window → 5-hour window card → conversation |

- Days, newest first, labeled `Today · Wed 28 Oct`, `Yesterday · Tue 27 Oct`, then `Mon 26 Oct`.
- A **project** is the working directory the conversation started in. Its label is the last path segment.
- The four views (`v`) apply here too.
- The window totals do **not** appear at the bottom of History. The By window grouping covers them.

### Cards

- Each project inside a day, and each 5-hour window inside a 7-day window, is a **card**: a `Box` with `borderStyle="round"`.
- A border cannot hold text, so the card's first row is its label and totals.
- **Each project has its own border color**, from a fixed palette. The same project keeps the same color in every grouping and every day (for example, by hashing the project path into the palette).
- In By window, the current 5-hour window has the accent border, and past windows have a dim border.

### Collapsing

- Every group collapses: days, project cards, 7-day windows, 5-hour window cards and conversations.
- A collapsed group shows one row with its totals, ending in `▸ N`, where N is the number of entries inside it. An expanded group shows `▾ N` and its contents.
- Collapsing everything gives a list of totals only. For example, one 7-day window with a totals row for each of its 5-hour windows.
- The default state is: the newest day (or project, or window) expanded down to its conversations, and everything else collapsed. Conversations start collapsed.

### Conversation rows

- Two lines: the start time (HH:MM, dim) and the full title (white, underlined), then the totals on the line below. A long title is never cut.
- **Title:** the last `custom-title` entry of the transcript (set by `/rename`). Without one, the last `ai-title` entry. Without either, the start of the first prompt.
- Click or Enter expands it in place. Its requests appear in the same columns as in the Conversation tab, marked by a dim `│` on the left. A subagent inside it opens the same way as in the Conversation tab.

### By window

- Each window is shown with its real start and end, for example `7-day window · Thu 22 Oct → Thu 29 Oct` and `5-hour · 12:00–17:00`. The current one is marked `now`.
- A conversation that spans two windows appears in both. Each copy counts only the requests made inside that window, and the copy in the later window is marked `↳ continued`.
- Only windows the mod has observed can be shown (see Windows under Data).

## Keys

| Key | Action | Where |
|---|---|---|
| `u` | open or close the pane | the band above the prompt |
| `t` | switch tab | pane |
| `v` | next view | both tabs |
| `g` | next grouping | History |
| Enter or click | open or close the focused row or card | both tabs |

- All keys are `Button` hotkeys. They work while the band or the pane holds the focus (ctrl+x tab, or a click).
- Each clickable row, card label or subagent name is a `Button` with `plain` and colored `Text` children. Tab reaches it and Enter presses it.
- Give every `Button` in a list its own `key`.
- The switches show their key, for example `Tokens Cost Both Chart  v`.

## Data

### Sources

- **Main transcript:** `~/.claude/projects/<project-slug>/<conversation-id>.jsonl`. Each `type: "assistant"` line has:
  - `message.usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`
  - `message.model`, `message.id`, `requestId` and `timestamp`
  - `cwd` for the project
- **Subagent transcripts:** `~/.claude/projects/<project-slug>/<conversation-id>/subagents/agent-<agentId>.jsonl`, with a sibling `agent-<agentId>.meta.json`. The meta file holds `agentType`, `description` and `toolUseId`. `toolUseId` is the id of the `Agent` tool call in the parent transcript, which places the subagent's row.
  - Subagent name shown: its `description`, else its `agentType`.
- **Titles:** lines with `type: "custom-title"` (`customTitle`) and `type: "ai-title"` (`aiTitle`).

### Deduplication

- One API response is written as several lines (one per content block), all with the same `message.id` and `requestId`. A request is that pair.
- Collect the `tool_use` blocks across all its lines.
- Keep the largest `output_tokens` seen. Whether it grows across the lines is not verified.

### Reading transcripts

- `$.fs.read` rejects files over 4 MiB, and 24 of the 459 transcripts on this machine are larger.
- Read new bytes from the last stored offset, through `$.process` (for example `tail -c +<offset>`), and store the offset per file.
- Transcripts grow during a conversation, so the import must be idempotent: upsert on (`message.id`, `requestId`).
- Refresh the current conversation after each response.

### Windows

- `session.measure` and `$.session.usage()` report `rateLimits`: `kind` (`five_hour`, `seven_day`), `percentUsed` and `resetsAt`.
- On every reading, record the window:
  - **start** = `resetsAt` − 5 hours (or − 7 days)
  - **end** = `resetsAt`
- Anthropic sometimes resets a window early or moves its reset time. Detect it when a reading arrives while the stored window's end is still in the future:
  - `resetsAt` differs and `percentUsed` dropped to near 0: the window was reset. Close the stored window at the time of this reading, and open a new one from this reading.
  - `resetsAt` differs and `percentUsed` did not drop: the same window was moved. Update its end.
- A window can therefore last less than 5 hours or 7 days. Totals always use the stored start and end, never an assumed length.
- Past windows exist only from the day the mod was installed.

### Store

- SQLite, one file at `~/.claude/conversation-usage.db`.
- The module has no Node APIs. Reach SQLite through `$.process` and the `sqlite3` command-line tool.
  - On this machine it is on the `PATH` at `~/Android/Sdk/platform-tools/sqlite3`, version 3.50.6.
  - If `sqlite3` is missing, the pane says so in one line and still shows the current conversation, read straight from its transcript.
- Suggested tables:
  - `conversations`: id, project path, title, started_at
  - `requests`: conversation id, `message.id`, `requestId`, subagent id or null, timestamp, model, the token counts (cache write split into 5m and 1h), tools
  - `subagents`: id, conversation id, parent subagent id or null, name, `toolUseId`
  - `windows`: kind, start, end
  - `files`: path, byte offset read
- Several Claude Code processes may write at once. Use SQLite's busy timeout or retries.

## Estimated cost

- Prices per model and token type: input, cache write 5m, cache write 1h, cache read and output.
- Take them from the `claude-api` skill, not from memory.
- A model missing from the table shows `?` for its cost, and adds nothing to cost totals.

## Constraints

- Panes are character cells, not HTML. Available: `Box`, `Text`, `Button`, `Input`, `Select`, `Link`, `Code`, `Markdown`, `Client`, `Raster` and `Image`. `Svg` is desktop-only. Draw bars with block characters in colored `Text`.
- The pane docks beside the transcript in fullscreen from 110 columns, and sits above the prompt otherwise.
- Values the drawing reads go in `atom(...)` and are declared in `types/index.d.ts`. `$.store` persists across conversations.
- Repo layout follows the other mods:
  - `.claude-plugin/plugin.json` at version `0.1.0`
  - `hooks/`, with `*.test.ts(x)` beside the source
  - `types/` and `README.md`
  - an entry in the repo `README.md`
- Checks: `claude plugin validate`, `tsc -p` and `claude plugin test` on the mod folder.
- New terms go in `GLOSSARY.md`: History, project, card.

## Left to the builder

- How the code splits into modules, and the exact SQL schema.
- When to refresh beyond "after each response", and how to keep the pane cheap to redraw.
- The palette for project colors (6 to 8 colors that read on the dark background and differ from the token-type colors).
- What the pane shows when there is no data yet, or when the conversation has no requests.
- Number formatting (`12`, `18.4k`, `3.1M`; costs to the cent).
