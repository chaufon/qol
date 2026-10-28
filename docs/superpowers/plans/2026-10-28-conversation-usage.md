# conversation-usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `conversation-usage` mod: a hidden-by-default pane (Conversation and History tabs) and a band line that show tokens and estimated cost per request, per subagent, per conversation and per rate-limit window, stored in SQLite.

**Architecture:** Pure modules (prices, format, transcript parsing, window tracking, SQL text, row and tree models) hold all logic and carry unit tests. Two IO modules reach the outside only through `$.process.run`: `db.ts` (the `sqlite3` CLI) and `sync.ts` (reading transcripts with `tail`, `find`, `cat`). `register.tsx` wires hooks and atoms; `draw.tsx` turns rows into `Box`/`Text`/`Button` trees.

**Tech Stack:** Claude Code function-hook mod (TypeScript + JSX against `claude-code`), `claude plugin test`, `sqlite3` CLI, `npx -y tsx` for the SQL check against a real `sqlite3`.

**Spec:** `docs/superpowers/specs/2026-10-28-conversation-usage-design.md`. Read it in full before your task. Terms: `GLOSSARY.md`.

## Global Constraints

- Mod folder: `plugins/conversation-usage/`. Copy the layout of `plugins/grammar-tracker` (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/*.ts(x)` with `*.test.ts(x)` beside the source, `types/index.d.ts`, `tsconfig.json` extending `./.claude-plugin/types/tsconfig.json`, `README.md`).
- `plugin.json`: `name` `conversation-usage`, `version` `0.1.0`, `license` `MIT`, `author` `{ "name": "Chaufon", "url": "https://github.com/chaufon" }`, `types` `./types/index.d.ts`.
- API reference: `/tmp/claude-1000/bundled-skills/2.1.311/14daaa40be7563e416b482f9d5316bb1/plugin-authoring/types/claude-code.d.ts` (22k lines: grep it, never read it whole). Examples: `.../plugin-authoring/examples/` (`pane.tsx`, `pane.test.tsx`, `band.tsx`). Long form: `.../plugin-authoring/reference.md`.
- The module has no Node and no DOM. Everything outside goes through `$`. All file and database access goes through `$.process.run` (no shell; argv only).
- The mod's text never says "session". Use the GLOSSARY terms: conversation, 5-hour window, 7-day window, request, subagent, input, cache write, cache read, output, total, estimated cost.
- Comments and docs describe current behavior only. No history ("previously", "now", "no longer").
- Do **not** commit. The user commits. Never stage or touch `.gitignore` or `plugins/grammar-tracker/*`: they hold the user's own uncommitted work. Reviewers read the work with `git status --short plugins/conversation-usage` and by reading the files.
- No mod may require another mod (memory: mods are independent). The band hook calls `next(e)` first and adds its own line below.
- Checks for every task that touches the mod (run from the repo root):
  - `claude plugin validate plugins/conversation-usage`
  - `claude plugin test plugins/conversation-usage`
  - `npx -y -p typescript tsc -p plugins/conversation-usage` (needs `plugins/conversation-usage/.claude-plugin/types/`; if absent, type-check with the `tsconfig.json` printed in the header of the API types file, kept outside the mod folder, `include` naming that file and the mod's `hooks`).

## Shared types (`types/index.d.ts`, written in Task 1, used by every task)

```ts
export type Tokens = { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number }
export type Costs = { input: number; cacheWrite: number; cacheRead: number; output: number; total: number }
// cost is null when no request inside has a known price.
export type Usage = { tokens: Tokens; cost: Costs | null }

// One API request: the (messageId, requestId) pair. at = epoch ms of its first transcript line.
export type Request = {
  messageId: string; requestId: string; agentId: string | null; at: number; model: string; isFast: boolean
  tokens: Tokens; tools: string[]; toolUseIds: string[]
}
// name: meta description, else agentType. toolUseId: the Agent tool call that launched it.
export type Subagent = { agentId: string; parentAgentId: string | null; name: string; toolUseId: string | null }
export type Conversation = {
  id: string; project: string; title: string; startedAt: number; requests: Request[]; subagents: Subagent[]
}

export type WindowKind = 'five_hour' | 'seven_day'
export type Window = { kind: WindowKind; start: number; end: number; percentUsed: number }
export type WindowTotal = { window: Window; usage: Usage }

export type Tab = 'conversation' | 'history'
export type View = 'tokens' | 'cost' | 'both' | 'chart'
export type Grouping = 'date' | 'project' | 'window'

export type HistoryConversation = {
  id: string; project: string; title: string; startedAt: number; usage: Usage; requestCount: number
}
// The part of one conversation that falls inside one stored window.
export type HistorySlice = {
  kind: WindowKind; windowStart: number; conversationId: string; usage: Usage; requestCount: number; firstAt: number
}
export type HistoryData = { conversations: HistoryConversation[]; windows: Window[]; slices: HistorySlice[] }
export type History = HistoryData | { error: string } | null

declare module 'claude-code' {
  interface PluginState {
    'conversation-usage': {
      isOpen: boolean; tab: Tab; view: View; grouping: Grouping
      expanded: Record<string, boolean>          // row/group key → open; absent = its default
      current: Conversation | null               // the current conversation, read from its transcript
      windowTotals: WindowTotal[]                 // the current 5-hour and 7-day windows, from the database
      history: History
      details: Record<string, Conversation>       // History conversations loaded on expand, by id
      notice: string | null                       // one line, e.g. sqlite3 missing
      now: number                                 // epoch ms of the last refresh, for Today/Yesterday labels
    }
  }
}
```

## Review Focus

1. A transcript larger than 4 MiB (24 such files exist on this machine): reading must loop over `tail -c +N` chunks, cut at the last newline, and advance the offset by UTF-8 bytes, not characters. Test with a chunk that holds a multi-byte character (Task 3).
2. A request split across several lines, and across two reads (the last line of one read has the same `message.id` as the first of the next): counted once, tools merged, largest `output_tokens` kept (Task 2, Task 3).
3. `sqlite3` missing: the pane shows one line and still shows the current conversation from its transcript; no toast loop, no throw on every refresh (Task 4, Task 8).
4. An early reset of a window (`resetsAt` moves while `percentUsed` drops near 0) versus a moved reset time (Task 5).
5. A subagent whose `toolUseId` matches no request (meta missing, or launch request not yet written): it still appears, after the last row, and its requests still count (Task 6).

---

### Task 1: Scaffold, prices and formatting

**Files:**
- Create: `plugins/conversation-usage/.claude-plugin/plugin.json`, `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), `tsconfig.json`, `types/index.d.ts` (exactly the block above), `hooks/register.tsx` (stub: `export const register: Register = () => {}`)
- Create: `hooks/prices.ts`, `hooks/prices.test.ts`, `hooks/format.ts`, `hooks/format.test.ts`

**Interfaces:**
- Produces:
  - `PRICES: Record<string, { input: number; cacheRead: number; output: number }>` (USD per million tokens)
  - `costOf(r: Pick<Request, 'model' | 'tokens' | 'isFast'>): Costs | null`
  - `addTokens(a: Tokens, b: Tokens): Tokens`, `ZERO_TOKENS: Tokens`, `totalTokens(t: Tokens): number`, `addCosts(a: Costs | null, b: Costs | null): Costs | null` (null + x = x)
  - `fmtTokens(n: number): string`, `fmtCost(c: number | null): string`, `hhmm(ms: number): string`, `weekday(ms: number): string`, `dayLabel(ms: number, now: number): string`, `projectLabel(path: string): string`, `projectColor(path: string): string`
  - `COLORS` (the spec's Style table): `{ input: '#61afef', cacheWrite: '#e5c07b', cacheRead: '#98c379', output: '#c678dd', cost: '#f0c674', subagent: '#56b6c2', accent: '#d19a66', dim: '#7f848e' }`
  - `PROJECT_PALETTE = ['#e06c75', '#f78c6c', '#ff6ac1', '#4fd6be', '#c3e88d', '#82aaff', '#b4befe', '#eba0ac']`

Prices, from the `claude-api` skill (USD per million tokens). Cache write 5m = 1.25 × input, cache write 1h = 2 × input, for every model:

| model | input | cache read | output |
|---|---|---|---|
| claude-fable-5-1, claude-mythos-5-1 | 10 | 0.25 | 50 |
| claude-fable-5, claude-mythos-5 | 10 | 1 | 50 |
| claude-opus-5-5 | 4 | 0.20 | 20 |
| claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6 | 5 | 0.50 | 25 |
| claude-sonnet-5-5 | 2 | 0.20 | 10 |
| claude-sonnet-5 | 2 | 0.20 | 10 |
| claude-sonnet-4-6 | 3 | 0.30 | 15 |
| claude-haiku-5-5 | 0.10 | 0.01 | 0.50 |
| claude-haiku-4-5 | 1 | 0.10 | 5 |

- Model ids in transcripts may carry a suffix (`claude-opus-5-5[1m]`) or a date (`claude-haiku-4-5-20251001`): match the longest table key that the id starts with.
- Claude Haiku 5.5 costs 5 × its rates (input, cache, output) for a request whose input + cache write + cache read exceeds 100,000 tokens.
- Fast mode (`isFast`): 2 × every rate, for `claude-opus-5-5` and `claude-opus-5` only.
- `<synthetic>` and any unknown model: `null`.

- [ ] **Step 1: Write the failing tests**

`prices.test.ts`:
- `costOf` of claude-opus-5-5 with tokens `{input: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000, output: 1_000_000}` → `{input: 4, cacheWrite: 5 + 8, cacheRead: 0.2, output: 20, total: 37.2}` (compare with `toBeCloseTo`).
- `claude-opus-5-5[1m]` prices like `claude-opus-5-5`; `claude-haiku-4-5-20251001` like `claude-haiku-4-5`; `claude-opus-5` does not take `claude-opus-5-5`'s price (longest prefix wins).
- Haiku 5.5 with 150k input → input cost `150_000 / 1e6 * 0.5`.
- fast claude-opus-5-5, 1M output → output 40.
- `<synthetic>` → `null`; `addCosts(null, c)` → `c`.

`format.test.ts`:
- `fmtTokens`: 0→`0`, 12→`12`, 999→`999`, 18_400→`18.4k`, 372_300→`372.3k`, 3_100_000→`3.1M`, 46_900_000→`46.9M`, 1_000→`1.0k`.
- `fmtCost`: 0.744→`$0.74`, 0→`$0.00`, 75.514→`$75.51`, `null`→`?`.
- `dayLabel` with `now` on Wed 28 Oct 2026 (local time): same day → `Today · Wed 28 Oct`, the day before → `Yesterday · Tue 27 Oct`, two days before → `Mon 26 Oct`.
- `projectLabel('/home/centos/PycharmProjects/claude/qol')` → `qol`.
- `projectColor` is stable for one path and always in `PROJECT_PALETTE`.

- [ ] **Step 2:** Run `claude plugin test plugins/conversation-usage`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `prices.ts` and `format.ts`. `projectColor`: FNV-1a 32-bit hash of the path, modulo the palette length. Dates use the local time zone (`Date` getters).
- [ ] **Step 4:** Run the three checks of Global Constraints. Expected: all pass.

---

### Task 2: Transcript parsing (pure)

**Files:**
- Create: `plugins/conversation-usage/hooks/transcript.ts`, `hooks/transcript.test.ts`

**Interfaces:**
- Produces:
  - `type TranscriptState` (opaque; holds a `Map` keyed `${messageId}|${requestId}` and the title fields)
  - `newTranscript(agentId: string | null): TranscriptState`
  - `feed(state: TranscriptState, lines: string[]): void` — mutates
  - `requestsOf(state): Request[]` — in order of first appearance
  - `titleOf(state): string | null` — last `custom-title` (`customTitle`), else last `ai-title` (`aiTitle`), else the first line of the first user prompt, cut to 100 characters
  - `cwdOf(state): string | null` — `cwd` of the first line that has one; `startedOf(state): number | null` — the first line's `timestamp`
  - `completeLines(chunk: string): { lines: string[]; rest: string }` — lines up to the last `\n`; `rest` is what follows it
  - `utf8Length(text: string): number`

Line rules:
- A request: a line with `type: "assistant"`, `message.id`, `requestId`, `message.usage`, and `message.model` other than `<synthetic>`. Tokens: `input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens` (if `cache_creation` is absent, all of `cache_creation_input_tokens` goes to 5m), `cache_read_input_tokens`, `output_tokens`. `isFast`: `usage.speed === 'fast'`. `at`: `Date.parse(timestamp)` of the first line seen.
- Tools: each `message.content` block with `type: "tool_use"` adds `name` to `tools` (no duplicates, in order) and `id` to `toolUseIds`.
- Merging: same key → keep the largest `output_tokens`, merge tools, keep the other counts of the first line.
- First prompt: the first `type: "user"` line whose `message.content` is a string, or whose first `text` block exists, skipping `isMeta: true` lines and text starting with `<` (command wrappers).
- Blank or invalid JSON lines are skipped.

- [ ] **Step 1: Write the failing tests** (build lines with a small helper `assistant({id, requestId, output, tools, at})`):
  - Three lines of one request (`msg_1`/`req_1`) with tools `Read`, `Read`, `Grep` and outputs 10, 40, 40 → one request, `tools: ['Read', 'Grep']`, `tokens.output: 40`.
  - Same request fed in two `feed` calls → still one request.
  - `cache_creation` `{ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50}` → `cacheWrite5m: 100, cacheWrite1h: 50`.
  - `<synthetic>` model line → no request.
  - Title: ai-title `A`, then custom-title `B`, then ai-title `C` → `B`; only ai-titles `A`, `C` → `C`; none → first prompt text.
  - `completeLines('a\nb\nc')` → `{lines: ['a', 'b'], rest: 'c'}`; `utf8Length('é€😀')` → 9.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three checks. Expected: pass.

---

### Task 3: Reading the current conversation from disk (`sync.ts`)

**Files:**
- Create: `plugins/conversation-usage/hooks/sync.ts`, `hooks/sync.test.ts`

**Interfaces:**
- Consumes: Task 2 (`newTranscript`, `feed`, `requestsOf`, `titleOf`, `cwdOf`, `startedOf`, `completeLines`, `utf8Length`).
- Produces:
  - `type Reader` (opaque; per-file `{ offset: number; state: TranscriptState }`, the conversation id, the transcript path)
  - `newReader(): Reader`
  - `configDir($: EngineInterface): Promise<string>` — `$.env.get("CLAUDE_CONFIG_DIR")`, else `${HOME}/.claude`
  - `readConversation($, reader: Reader, conversationId: string): Promise<Conversation | null>` — null when no transcript file is found yet

Behavior:
- A new `conversationId` (after `/clear`) resets the reader.
- Locate the transcript once per conversation: `find <configDir>/projects -maxdepth 2 -name <id>.jsonl`.
- Read new bytes: `tail -c +<offset + 1> <path>`. Take `completeLines(stdout)`, feed the lines, advance `offset` by `utf8Length` of the consumed text (lines plus their newlines). When `isStdoutTruncated`, read again from the new offset until it is not.
- Subagents: `find <dir>/<id>/subagents -maxdepth 1 -name 'agent-*.meta.json'` (dir = the transcript's folder). For each new meta file, `cat` it once: `name` = `description` ?? `agentType`, `toolUseId`. Read each `agent-<agentId>.jsonl` the same incremental way, with `newTranscript(agentId)`.
- `parentAgentId`: the subagent whose requests hold `toolUseId` in `toolUseIds`; `null` when the main transcript holds it or nobody does.
- `project` = `cwdOf` of the main transcript (fallback `await $.session.cwd()`); `startedAt` = `startedOf` (fallback first request's `at`); `title` = `titleOf` ?? `''`.
- A command that exits non-zero or rejects for a subagent file skips that file this round; for the main transcript it returns `null`.

- [ ] **Step 1: Write the failing tests.** Mock `process.run` with an in-memory file map: `find` answers matching paths, `cat` the content, `tail -c +N` the content from byte N−1 (byte-accurate: encode with a UTF-8 helper in the test) cut to a `limit` the test sets, with `isStdoutTruncated` true when cut.
  - A main transcript with two requests and a subagent (meta `{"agentType":"Explore","description":"Find the hooks","toolUseId":"toolu_1"}`) whose launching request holds `toolu_1` → `subagents[0]` `{agentId, name: 'Find the hooks', parentAgentId: null, toolUseId: 'toolu_1'}` and the subagent's requests carry its `agentId`.
  - A nested subagent whose `toolUseId` is in the first subagent's transcript → `parentAgentId` = the first subagent.
  - `limit` 300 bytes over a transcript of ~2 KB holding `é` and `😀` in prompts → the same requests as an unlimited read.
  - Append a line to the file and call again → only the new request is added, no duplicate.
  - A different conversation id → requests of the other file only.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three checks. Expected: pass.

---

### Task 4: SQL text and the database runner

**Files:**
- Create: `plugins/conversation-usage/hooks/sql.ts` (pure: SQL strings, quoting, row mapping), `hooks/sql.test.ts`, `hooks/db.ts` (runner), `hooks/db.test.ts`, `tests/sql-check.ts` (runs against a real `sqlite3`)

**Interfaces:**
- Consumes: `costOf` (Task 1).
- Produces (`sql.ts`, no imports from `claude-code` at run time):
  - `SCHEMA: string`
  - `quote(v: string | number | null): string` — `NULL`, numbers as written (finite only), strings in `'…'` with `'` doubled
  - `upsertConversation(c: Conversation): string`, `upsertRequests(conversationId: string, rs: Request[]): string`, `upsertSubagents(conversationId: string, ss: Subagent[]): string`, `upsertWindow(w: Window): string`
  - `selectWindows(): string`, `selectWindowTotal(w: Window): string`, `selectHistory(): string`, `selectSlices(): string`, `selectConversation(id: string): string`, `selectSubagents(id: string): string`
  - row mappers: `toWindow(row)`, `toUsage(row)`, `toRequest(row)`, `toSubagent(row)`, `toHistoryConversation(row)`, `toSlice(row)`
- Produces (`db.ts`):
  - `type Db = { path: string }`
  - `openDb($): Promise<Db | { error: string }>` — creates the schema; `{ error: 'Usage history needs sqlite3 on the PATH' }` when `sqlite3` cannot start
  - `exec($, db: Db, sql: string): Promise<void>`, `query<T>($, db: Db, sql: string, map: (row: Record<string, unknown>) => T): Promise<T[]>`
  - `saveConversation($, db, c: Conversation): Promise<void>` (conversation, subagents, requests in one `exec`)
  - `saveWindow($, db, w: Window): Promise<void>`, `loadWindows($, db): Promise<Window[]>`, `loadWindowTotal($, db, w): Promise<Usage>`, `loadHistory($, db): Promise<HistoryData>`, `loadConversation($, db, id): Promise<Conversation | null>`

Schema (exact):

```sql
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project TEXT NOT NULL, title TEXT NOT NULL, started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subagents (agent_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, parent_agent_id TEXT, name TEXT NOT NULL, tool_use_id TEXT);
CREATE TABLE IF NOT EXISTS requests (
  message_id TEXT NOT NULL, request_id TEXT NOT NULL, conversation_id TEXT NOT NULL, agent_id TEXT,
  at INTEGER NOT NULL, model TEXT NOT NULL, is_fast INTEGER NOT NULL,
  input INTEGER NOT NULL, cache_write_5m INTEGER NOT NULL, cache_write_1h INTEGER NOT NULL, cache_read INTEGER NOT NULL, output INTEGER NOT NULL,
  cost_input REAL, cost_cache_write REAL, cost_cache_read REAL, cost_output REAL,
  tools TEXT NOT NULL, tool_use_ids TEXT NOT NULL,
  PRIMARY KEY (message_id, request_id));
CREATE INDEX IF NOT EXISTS requests_at ON requests (at);
CREATE INDEX IF NOT EXISTS requests_conversation ON requests (conversation_id);
CREATE TABLE IF NOT EXISTS windows (kind TEXT NOT NULL, start INTEGER NOT NULL, "end" INTEGER NOT NULL, percent_used REAL NOT NULL, PRIMARY KEY (kind, start));
```

- Database file: `<configDir>/conversation-usage.db` (`configDir` from Task 3).
- Every call: `$.process.run(['sqlite3', '-json', path], { stdin: '.timeout 5000\n' + sql, timeoutMs: 20_000 })`. Non-zero exit → throw with `stderr`. `-json` prints nothing for an empty result: map `''` to `[]`.
- Upserts: `INSERT … ON CONFLICT DO UPDATE SET` every column to `excluded`. Costs are computed with `costOf` when written; `NULL` costs for an unknown model. `tools` and `tool_use_ids` are JSON arrays.
- Usage sums: `SUM(cost_x)` ignores NULLs; `cost` is `null` when `COUNT(cost_input) = 0`.
- `selectWindowTotal`: requests with `at >= start AND at < end`, any conversation.
- `selectHistory`: every conversation with its usage and request count, `ORDER BY started_at DESC`.
- `selectSlices`: `windows JOIN requests ON at >= start AND at < "end"`, grouped by window and conversation, with `MIN(at)` as `firstAt`.

- [ ] **Step 1: Write the failing tests.** `sql.test.ts`: `quote("it's")` → `'it''s'`; `quote(null)` → `NULL`; `upsertRequests` of a `<synthetic>`-free request with an unknown model holds `NULL` costs; `toUsage` of a row with `cost_count 0` gives `cost: null`. `db.test.ts` (mocked `process.run`): `openDb` when `process.run` throws → `{ error: 'Usage history needs sqlite3 on the PATH' }`; `query` maps `''` to `[]`; the stdin starts with `.timeout 5000`.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement `sql.ts` and `db.ts`.
- [ ] **Step 4: Check the SQL against a real sqlite3.** `tests/sql-check.ts` (Node, `child_process.execFileSync('sqlite3', ['-json', tmpDb], { input })`) imports `../hooks/sql.ts`, applies `SCHEMA`, upserts one conversation with two requests (one written twice with different `output`), one subagent, a 5-hour window, and asserts: one row per request, the window total sums both requests, `selectHistory` returns one conversation with `requestCount` 2, `selectSlices` returns one slice. Run: `npx -y tsx plugins/conversation-usage/tests/sql-check.ts`. Expected: prints `sql-check: ok`, exit 0.
- [ ] **Step 5:** Run the three checks. Expected: pass.

---

### Task 5: Window tracking (pure)

**Files:**
- Create: `plugins/conversation-usage/hooks/windows.ts`, `hooks/windows.test.ts`

**Interfaces:**
- Produces:
  - `WINDOW_MS: Record<WindowKind, number>` (5 h, 7 d)
  - `type Reading = { kind: string; percentUsed: number; resetsAt?: string }` (the engine's `SessionRateLimit`)
  - `observe(stored: Window[], reading: Reading, now: number): Window[]` — the windows to upsert (0, 1 or 2)
  - `currentWindows(stored: Window[], now: number): Window[]` — for each kind, the stored window with `start <= now < end`, five-hour first

Rules (`live` = the stored window of that kind with the latest `start` whose `end > now`):
- Ignore kinds other than `five_hour`/`seven_day`, and readings without `resetsAt`.
- No `live`: new window `start = max(resetsAt − length, end of the latest stored window of that kind)`, `end = resetsAt`.
- `live.end === resetsAt`: return `[{ ...live, percentUsed }]` only if `percentUsed` changed, else `[]`.
- Differs and `percentUsed <= 1 && percentUsed < live.percentUsed`: reset → `[{ ...live, end: now }, { kind, start: now, end: resetsAt, percentUsed }]`.
- Differs otherwise: moved → `[{ ...live, end: resetsAt, percentUsed }]`.

- [ ] **Step 1: Write the failing tests:** first reading `resetsAt` 17:00 → window 12:00–17:00; same reading again → `[]`; `resetsAt` 18:00 at 40 % → end becomes 18:00; at 14:00 a reading with `resetsAt` 19:00 at 0 % after 60 % → old window ends 14:00, new 14:00–19:00; a first reading whose computed start falls before a past window's end starts at that end; `currentWindows` at 13:00 returns the 12:00–17:00 window and the live 7-day one, five-hour first.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three checks. Expected: pass.

---

### Task 6: Row and tree models (pure)

**Files:**
- Create: `plugins/conversation-usage/hooks/model.ts`, `hooks/model.test.ts`

**Interfaces:**
- Consumes: Task 1 (`costOf`, `addTokens`, `addCosts`, `dayLabel`, `projectLabel`, `projectColor`, `hhmm`, `weekday`), shared types.
- Produces:
  - `sumUsage(rs: Request[]): Usage`
  - `type Row =`
    - `| { kind: 'request'; key: string; number: number; depth: number; at: number; tools: string[]; usage: Usage }`
    - `| { kind: 'subagent'; key: string; agentId: string; name: string; depth: number; count: number; isOpen: boolean; usage: Usage }`
  - `conversationRows(c: Conversation, isOpen: (key: string) => boolean, prefix: string, range?: [number, number]): Row[]`
  - `type Node = { key: string; kind: 'day' | 'project' | 'week' | 'fiveHour' | 'conversation'; label: string; usage: Usage; count: number; isOpen: boolean; color: string | null; isNow: boolean; isContinued: boolean; conversationId: string | null; range: [number, number] | null; startedAt: number | null; children: Node[] }`
  - `historyTree(h: HistoryData, grouping: Grouping, now: number, expanded: Record<string, boolean>): Node[]`

`conversationRows`:
- Main requests (`agentId === null`), in `at` order, numbered 1, 2, 3, `depth` 0.
- After each request, one subagent row per subagent whose `toolUseId` is in that request's `toolUseIds`, in `toolUseIds` order. Subagent `depth` = the depth of the request that launched it; its `usage` and `count` cover its own requests only.
- When open (`isOpen(key)`), its requests follow at `depth + 1`, numbered 1, 2, 3, with nested subagents placed the same way.
- A subagent of this context with no matching request goes after the context's last row.
- Key: `${prefix}sub:${agentId}`; request key `${prefix}req:${messageId}|${requestId}`.
- `range` keeps only requests with `range[0] <= at < range[1]` (History by window).

`historyTree`:
- By date: `day` nodes (local date of `startedAt`, newest first, label `dayLabel`) → `project` cards (label `projectLabel`, `color` `projectColor`, newest activity first) → `conversation` nodes.
- By project: `project` cards → `day` nodes → `conversation` nodes.
- By window: `week` nodes (`7-day window · Thu 22 Oct → Thu 29 Oct`, newest first) → `fiveHour` cards (`5-hour · 12:00–17:00`) inside it → `conversation` nodes built from slices: usage and count of the slice, `range` = the 5-hour window, `isContinued` when the conversation has requests before the window (`startedAt < window.start`). `isNow` for the window with `start <= now < end`; `fiveHour` `color` null (draw uses accent when `isNow`, dim otherwise).
- `usage` of a group = sum of its children; `count` = number of children; for a conversation, its request count.
- Keys: `day:<yyyy-mm-dd>`, `project:<path>`, `week:<start>`, `fiveHour:<start>`, child keys prefixed by the parent key and `/`, conversation `…/conv:<id>`.
- `isOpen` = `expanded[key]` when set, else the default: the first top-level node and every non-conversation node inside it are open; everything else is closed; conversations are closed.

- [ ] **Step 1: Write the failing tests:**
  - Main requests R1 (tools `Agent`, toolUseIds `t1`, `t2`), R2; subagents A (`t1`, 2 requests) and B (`t2`, 1 request) → rows `1, A(↳, count 2), B(↳, count 1), 2` with `isOpen` false; open A → `1, A, A1, A2, B, 2`, A's requests at depth 1 numbered 1, 2.
  - Nested C launched from A's request → under open A, C row at depth 1; open C → its requests at depth 2.
  - Orphan subagent (toolUseId `zz`) → last row.
  - `sumUsage` of a known and a `<synthetic>`-priced request → cost of the known one only; of only unknown models → `cost: null`.
  - By date with conversations today (projects `/a/qol` and `/a/web`) and yesterday → `[Today (open, 2 project cards open, conversations closed), Yesterday (closed)]`; `expanded['day:…today']: false` closes it.
  - By window: a conversation with requests in two 5-hour windows appears in both; the later copy has `isContinued` true, and each copy's usage is its slice.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three checks. Expected: pass.

---

### Task 7: Drawing — rows, four views, both tabs (`draw.tsx`)

**Files:**
- Create: `plugins/conversation-usage/hooks/draw.tsx`, `hooks/draw.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`fmtTokens`, `fmtCost`, `hhmm`, `weekday`, `COLORS`), Task 6 (`Row`, `Node`, `conversationRows`), shared types.
- Produces (each returns a JSX tree; `ui` is `$.ui.resolve(e)`; handlers are closures the caller supplies):
  - `type Actions = { toggle(key: string, isOpen: boolean): void; nextView(): void; nextTab(): void; nextGrouping(): void; selectTab(t: Tab): void; selectView(v: View): void; selectGrouping(g: Grouping): void; hide(): void; loadDetails(conversationId: string): void }`
  - `drawPane(ui, p: { width: number; tab: Tab; view: View; grouping: Grouping; current: Conversation | null; windowTotals: WindowTotal[]; history: History; details: Record<string, Conversation>; expanded: Record<string, boolean>; notice: string | null; now: number; isFullscreen: boolean }, actions: Actions): JSX.Element`
  - `barSegments(tokens: Tokens, scale: number, width: number): [number, number, number, number]` — cells for input, cache write, cache read, output; sums to `round(total / scale * width)`, at least 1 for a non-zero total, largest-remainder rounding

Layout (match `.superpowers/brainstorm/326453-1793154900/content/four-views.html`, `history-tab-v2.html`, proposal A of `history-groups.html`; the spec wins where they differ):
- Top row: tab buttons `Conversation` `History` (current one bold/inverse), key `t`; then the view switch `Tokens  Cost  Both  Chart   v` (current one highlighted), key `v`; on History also the grouping switch `Date  Project  Window   g`, key `g`; then `Hide`.
- Columns: `#` 3 (`↳` on a subagent row, `┃` repeated `depth` times before the number for nested requests, colored `COLORS.subagent`), time 6, tools `width − 3 − 6 − 5 × 8 − 5` (min 8, comma-separated, `—` for none, cut with `…`), input / c.write / c.read / output / total 8 each right-aligned, marker 5 (`▸ N`/`▾ N`). A header row in dim text names the columns (`#  time  tools  input  c.write  c.read  output  total`).
- Token colors: input, cache write, cache read, output in their `COLORS`; total bold white; costs `COLORS.cost`.
- Cost view: costs per type and total; `?` for an unknown price. Both: tokens line, then costs line. Chart: legend line above (`█ input █ c.write █ c.read █ output` in colors), then per row `#`, time, tools (narrower: 12), a bar of `barSegments` with all requests on one scale (the largest request total fills it), then total tokens and total cost; each total row's bar fills the bar column and shows only the mix.
- Rows: every clickable row is `<Button key=… plain onPress=…>` with colored `Text` children. A subagent's name is cyan and underlined. Each row sits in a keyed `Box` with `hover={{ backgroundColor: '#3a3f4b' }}` when `isFullscreen`; alternate rows striped with `backgroundColor="#23272e"`.
- Totals (Conversation tab): a rule `─` across the width, then `Conversation` on a darker band (`#1b1e23`), then `5-hour window (HH:MM)` and `7-day window (Ddd)` with the label in `COLORS.accent` and the reset time/day of the window's `end`. A window with no total is left out.
- History: day and week groups are header rows; project and 5-hour cards are `<Box borderStyle="round" borderColor=…>` whose first row is the label and totals; conversation rows are two lines: `HH:MM` dim then the full title white underlined (wrapping, never cut; `↳ continued` prefix when `isContinued`), then the totals line. Collapsed: one row with totals ending `▸ N`; open `▾ N`. An open conversation shows `conversationRows(details[id], …, prefix = node.key + '/', node.range)` with a dim `│` before each row; while `details[id]` is missing it calls `actions.loadDetails(id)` on press and shows `Loading…`.
- Empty states: no current conversation or no requests → `No requests yet in this conversation.`; History `null` → `Loading…`; `{ error }` → the error in `error` color; empty data → `No stored conversations yet.`; `notice` → one dim line above the tab content.

This task also writes, in `register.tsx`, the atoms (Task 8's list), the Pane render hook (`on('ui.render', { component: 'Pane', requestId: 'conversation-usage' }, …)` reading the atoms and returning `drawPane`), and the actions that only write atoms (`toggle`, `nextView`, `nextTab`, `nextGrouping`, `select*`). `hide` and `loadDetails` are filled in by Task 8; leave them as functions Task 8 replaces.

- [ ] **Step 1: Write the failing tests** (`draw.test.tsx`, pattern `examples/pane.test.tsx`: seed the atoms with an `on('state.get', …)` hook answering per `e.key`, mount the pane with `$.ui.mount`, loop over `['terminal', 'desktop'] as const`): with a conversation of 2 requests and one subagent:
  - Tokens view text contains `18.4k` for a request with 18,400 cache-write tokens, `↳` and the subagent name, and `▸ 1`.
  - Cost view contains `$` amounts and `?` for an unknown model.
  - Chart view contains the legend and `█`.
  - `barSegments({input: 0, cacheWrite5m: 50, cacheWrite1h: 0, cacheRead: 50, output: 0}, 100, 10)` → `[0, 5, 5, 0]`; a tiny non-zero total gives at least one cell.
  - History by date shows `Today · ` and a card label with the project name; a collapsed conversation row ends with `▸`.
  - Pressing the subagent's row button opens it: its requests appear with `┃`.
  - Pressing the view switch four times returns to Tokens.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Grep the API types for `BoxProps`, `ButtonProps`, `hover`, `borderStyle` before writing; check the `Pane` and `AbovePrompt` props (`bodyColumns`, `hasSurvey`) and `e.viewport?.isFullscreen`.
- [ ] **Step 4:** Run the three checks. Expected: pass.

---

### Task 8: Wiring — band, pane, command, refresh, windows (`register.tsx`)

**Files:**
- Modify: `plugins/conversation-usage/hooks/register.tsx` (add to Task 7's atoms, pane hook and actions)
- Create: `hooks/register.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: the `register` export.

Behavior:
- Atoms: one per `PluginState` key, `atom({ plugin: 'conversation-usage', key } as const, initial)`; initial: `isOpen false`, `tab 'conversation'`, `view 'tokens'`, `grouping 'date'`, `expanded {}`, `current null`, `windowTotals []`, `history null`, `details {}`, `notice null`, `now 0`.
- Module variables: one `Reader`, a `Db | { error } | undefined` opened once, a refresh chain (one refresh in flight, at most one queued after it).
- `refresh($)`: `$.session.id()` → `readConversation` → `update(current)`; if the db opened, `saveConversation`, then `loadWindows` → `currentWindows(now)` → `loadWindowTotal` each → `update(windowTotals)`; if the pane is open on History, reload `history`. `update(now)` with `$.clock.now()`. Any error: `update(notice, …)` with one line; never throw out of a hook.
- `session.start`: `await next(e)` first, then start a refresh (not awaited by the hook).
- `session.measure`: for each `e.rateLimits` reading, `observe` against `loadWindows`, `saveWindow` each result; then queue a refresh. Return `next(e)`.
- `turn.complete`: `await next(e)`, then queue a refresh (main loop and subagents).
- `ui.close` for the pane id: set `isOpen` false.
- Band: `on('ui.render', { component: 'AbovePrompt' }, …)`: `if (e.props.hasSurvey) return next(e)`; else a column `Box` holding `await next(e)` and a row: dim `Usage · <fmtTokens(total)> tokens · <fmtCost>   ` and `<Button key="toggle" hotkey="u" plain>` reading `Show`/`Hide`. With no current conversation: `Usage · no requests yet`.
- Pane: id `conversation-usage`, `$.ui.open({ id, title: 'Usage', focus: true, closeOnEscape: true })`; `on('ui.render', { component: 'Pane', requestId: id }, …)` returns `drawPane` with `width = e.props.bodyColumns`, `isFullscreen = e.viewport?.isFullscreen === true`. Opening loads `history` if it is `null`.
- Actions: `nextTab` cycles `conversation → history`, loading `history` when entering History; `nextView` cycles `tokens → cost → both → chart → tokens`; `nextGrouping` `date → project → window → date`; `toggle(key, isOpen)` writes `expanded[key] = !isOpen`; `loadDetails(id)` loads `loadConversation` into `details[id]`.
- Slash command: in `session.start` register `{ name: 'conversation-usage', description: 'Open or close the usage pane' }`; a `command.run` hook matching it toggles the pane and returns `{ text: '' }` (check `CommandRunResult` in the types for the exact shape).
- The pane never opens unless the person asks (`u`, the button, or the command).

- [ ] **Step 1: Write the failing tests** (pattern: `plugins/grammar-tracker/hooks/register.test.ts`; mock `process.run` with the file map of Task 3 and a fake `sqlite3` that records stdin and answers canned JSON, `session.id`, `session.cwd`, `env.get`, `clock`):
  - After `session.start` and a `turn.complete`, the band reads `Usage · 19.6k tokens · $` and `Show`; pressing `toggle` calls `ui.open` with id `conversation-usage`; the band then reads `Hide`.
  - `/conversation-usage` opens the pane, and again closes it.
  - With `sqlite3` failing to start, the pane text holds `Usage history needs sqlite3 on the PATH` and the current conversation's rows.
  - `session.measure` with `rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt }]` sends an `INSERT` into `windows` to sqlite.
  - Pressing the tab switch (`t`) to History triggers a history query; expanding a History conversation triggers its `loadConversation` query.
  - With `hasSurvey: true`, the band is `next(e)` alone.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three checks. Expected: pass.

---

### Task 9: Docs

**Files:**
- Create: `plugins/conversation-usage/README.md` (what it shows, keys table, where data lives, `sqlite3` requirement, that History holds only conversations seen while the mod was loaded, Linux/macOS only: it uses `find`, `tail`, `cat`)
- Modify: `README.md` (table row, install / update / uninstall lines like the other mods), `GLOSSARY.md` (add **History**, **Project**, **Card** in the glossary's format)

Definitions for `GLOSSARY.md`:
- **History**: the pane tab that lists every stored conversation, grouped by date, by project or by window. _Avoid_: Log, archive
- **Project**: the working directory a conversation started in, shown by its last path segment. _Avoid_: Repo, workspace
- **Card**: a bordered box in History that groups the conversations of one project, or of one 5-hour window. _Avoid_: Panel, tile

- [ ] **Step 1:** Write the three files.
- [ ] **Step 2:** Check that no line in the mod's README or code says "session" for a conversation or a window: `grep -rni session plugins/conversation-usage --include=*.md --include=*.tsx --include=*.ts | grep -v '\$\.session\|session\.\(start\|measure\|id\|cwd\)'`. Expected: no output.
