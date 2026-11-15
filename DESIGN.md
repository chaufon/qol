# Design

The shared look of the qol mods. Every mod draws in a terminal first, next to Claude Code's own interface, so a mod
looks like part of Claude Code: quiet chrome, theme colors, and color only where it carries meaning.

Each mod stands alone (see `AGENTS.md`), so this file defines conventions, not a shared library: a mod copies the
recipe it needs into its own `hooks/`. What the engine allows (elements, props, theme keys, pane rules) is in
[`docs/UI-REFERENCE.md`](docs/UI-REFERENCE.md).

## Principles

1. **Read at a glance.** The first row a person sees answers the question the mod exists for. Say each fact once: a
   number shown in a stat is not repeated in a sentence next to it, unless the sentence adds what the number means
   (`10 in a row, 3 more to beat your best`).
2. **Color means something.** Red is a problem, yellow needs attention, green is fine, dim is metadata. Plain text
   carries everything else. Never color for decoration.
3. **Theme keys, not hex.** The person's theme can be light or dark, and a mod cannot tell which. A theme key follows
   it; a hex color is right in one of the two at best. The one exception is a mod's own icon or logo, drawn in fixed
   brand colors that read on both.
4. **Every symbol is explained.** A glyph or meter sits next to the word or number it stands for (`●●●○○ ×3`), or is
   replaced with words.
5. **Mods stack.** A mod draws only in its own places (its band row, its pane, its status line) and passes every
   event on with `next(e)`.

## Color

| Meaning | Theme key | Used for |
| --- | --- | --- |
| Problem | `error` | mistakes, failures, a limit reached, `✗` lines |
| Attention | `warning` | something recurring or close to a limit |
| Fine | `success` | clean results, `✓` lines, values within limits |
| Accent | `planMode` | the selected tab or switch, a mod's mark in its band row, the checking line |
| Suggestion | `suggestion` | a box holding text for the person to use, such as a corrected prompt |
| Quiet border | `inactive` | borders of stats and of cards with no status |
| Text on accent | `inverseText` | the label of the selected tab |
| Highlight | `subtle` (background) | the focused line of a code view |
| Removed words | `diffRemovedWord` (background), text in `text` | the words a correction takes out of a wrong sentence |
| Added words | `diffAddedWord` (background), text in `text` | the words a correction puts into the corrected sentence |
| Metadata | `dimColor` on Text | labels, captions, separators, rules, hints, empty states |

- Name the accent once per mod: `const ACCENT = 'planMode'`.
- Use categorical colors (one per mistake type, per token type, per project) only where the categories are the
  point of the view, and take them from theme keys too (`remember`, `permission`, `ide`, `autoAccept`, `claude`,
  `merged`).
- No background fills for stripes or bands in hex: they look wrong on a light theme. Separate rows with space or a
  rule instead.

## Glyphs

| Glyph | Meaning |
| --- | --- |
| `✓` / `✗` | right / wrong, in `success` / `error` |
| `⟳` | recurring |
| `▸` / `▾` | closed / open row, or a button that shows / hides a section (`▸ Show rule`) |
| `↳` | why this case is what it is: a line that follows from the lines above it |
| `→` | the general rule behind a case |
| `●○` | a meter of five dots, always next to the count it scales (`●●●○○ ×3`) |
| `·` | separator between items on one line, dim |
| `─` | rule across the pane, dim |
| `╌` | divider inside a card, before a section the person opened, dim |
| `█` / `░` | bar fill / bar track (track dim) |
| `–` | no value, or none in a count column, in `success` when none is good (Top mistakes' last 7 days) |
| `×N` | a count of times (the `×` sign, not the letter x) |
| `…` | truncated text, or work in progress (`Loading…`, `Checking…`) |

A mod's mark is one glyph that leads its pane title and its band row: `✎` grammar-tracker, `◔` conversation-usage,
`≡` file-links.

## Spacing

The terminal counts spacing in cells: one column across, one row down. Put `gap` on the parent rather than margins on
each child.

- **One blank row between blocks.** Blocks are the stats row, each card, a caption with its chart, and a list. Do
  this with `gap={1}` on the column that holds them, not with a `marginTop` on each block.
- **No blank row inside a block.** A card's lines, a table's rows and a legend sit on consecutive rows.
- **One column of padding** inside a bordered box: `paddingX={1}`.
- **One column between boxes in a row**: `gap={1}`.
- **Two columns between items on one line** of a legend or footer.

## Components

Every component below exists in at least one mod. The file named after it is the reference recipe.

### Pane chrome

`grammar-tracker/hooks/draw.tsx` `drawPane`

```
──────────────────────────────────────────
 Last prompt   Top mistakes
──────────────────────────────────────────
<tab body>
──────────────────────────────────────────
Tab  Hide
```

- A dim rule, the tab row, a dim rule, then the body.
- The outer Box has `width={bodyColumns}`, `minHeight={scroll.bodyRows}`, and `paddingBottom` equal to the footer's
  rows, so the body never runs under the footer.
- Size everything to `e.props.bodyColumns`, never to the viewport.
- `$.ui.open` with `closeOnEscape: true`, and `focus: true` only when the person asked for the pane.
- Title: the mod's mark, then one word (`✎ Grammar`, `◔ Usage`).

### Tab or switch

`grammar-tracker` `tabButton`, `conversation-usage` `switchView`

- A plain Button per option, in a row with `gap={1}`.
- Selected: ` label ` (one space each side), `weight="semibold"`, `color="inverseText"`, `backgroundColor={ACCENT}`.
- Not selected: the same padded label, `dimColor`.

### Footer

`grammar-tracker` `footer`

- Absolutely positioned on the last rows the pane shows: `top={scroll.offset + scroll.bodyRows - rows}`, so it
  stays in place while the body scrolls.
- A dim rule, then one plain dim Button per key, two spaces apart, the row padded with spaces to the full width.
- Shared keys: `t` next tab, `h` hide. A mod adds its own keys after them.

### Band row

`grammar-tracker` `drawBand`

```
✎ ✗ 3 mistakes · ⟳ 1 recurring   Hide
```

- Keep what is above with `await next(e)`, then add one row.
- The row is the mod's mark in `ACCENT`, the status as short chips separated by a dim `·`, three spaces, then a plain
  Button with the mod's hotkey that says `Show` or `Hide`.
- A chip is colored by meaning. A neutral one is dim.
- Draw nothing new when `e.props.hasSurvey` is true.

### Stat

`grammar-tracker` `tile`

```
╭──────────╮ ╭──────────╮ ╭──────────────╮
│    3     │ │    1     │ │      0       │
│ Mistakes │ │Recurring │ │ Clean streak │
╰──────────╯ ╰──────────╯ ╰──────────────╯
```

- A round border in `inactive`, with two centered lines: the value in semibold, colored by meaning (dim when
  neutral), and the label, dim.
- Stats come three or four to a row: each is `floor((bodyColumns - (n - 1)) / n)` wide for `n` stats, `gap={1}`. A
  label must fit a quarter of a narrow pane, about 9 cells (`Best`, not `Best streak`).
- A stats row goes first in a tab body and holds that tab's headline numbers. Nothing else in the tab repeats them.

### Card

`grammar-tracker` `card`

```
╭─ ⇄ Word order · "adjective before noun" ── ●●●○○ ×4 ⟳ ─╮
│ ✗ update the [marketplace] qol                         │
│ ✓ update the qol [marketplace]                         │
│ ↳ the name of the marketplace goes before it           │
│ ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ │
│ → A pattern copied from your native language.          │
╰──────────────────────────────────────── ▾ Hide rule ───╯
```

- A round border, `paddingX={1}`, with its title painted over the top border at column 2 in semibold, in the border
  color, and cut with `…` where the border is too short.
- An optional short label is painted over the right end of the top border, and an optional plain Button over the
  right end of the bottom border (`position="absolute"`, `bottom={0}`). Each is left out when its border has no room.
  A whole card cannot be a Button: a Button holds only text.
- Extra information the person opens goes below a dim `╌` divider inside the card, drawn in the padding so it never
  depends on where lines wrap. A footer key opens it on every card, the card's own button on that card, and a mod
  option sets which way it starts.
- Border color is the card's status: `warning` for something that needs attention, `suggestion` for text to use,
  `inactive` otherwise.
- The card's own Box has no margin; the column that holds the cards spaces them with `gap={1}`.

### Correction lines

`grammar-tracker` `sentences`

- `✗ <wrong>` in `error`, `✓ <right>` in `success`, then `↳ <reason>`, dim. Always in that order.
- The words the correction changed carry the removed / added word backgrounds. Case and punctuation at a word's ends
  do not count as a change, and a highlight never starts or ends with a space.

### Bar

`grammar-tracker` `topRow`, `usage-footer` `bar`

- A bar is a fixed number of cells: the filled part in `█`, the rest in `░`, dim. The fill is colored by meaning, or
  plain where every bar would get the same color (every Top mistakes row is recurring).
- A non-zero value fills at least one cell.
- A bar split by category takes its cells by largest remainder, so the parts add up to the bar's width.

### Table row

`conversation-usage` `rowBox`

- Fixed columns with `cell()`: cut with `…` or padded, numbers aligned to the right.
- An openable row starts with `▸` or `▾`. A nested row starts with a dim `│ `.

### States

| State | Draw |
| --- | --- |
| Loading | `Loading…`, dim |
| Waiting on the model | `⠋ <Doing>…`, in `ACCENT` |
| Empty | one sentence that says what will fill the view, dim (`Click a file reference in a reply to show the file here.`) |
| Success | one line in `success`, semibold, that says what the person achieved (`✓ No mistakes. 4 prompts in a row!`) |
| Failed | the error in `error` inside the view, and a toast when the person did not ask for the view |

## Copy

- Sentence case everywhere: titles, tabs, labels, buttons, column headers.
- A full sentence ends with a period. A label, chip, title or button does not.
- Counts use a plural helper: `1 mistake`, `3 mistakes`, `1 line`.
- Toasts start with the mod's name in sentence case, then a colon: `Grammar tracker: failed to read the trend (…)`.
- Words follow `GLOSSARY.md`.

## Conformance

Where the mods differ from this file today:

- **conversation-usage**:
  - Draws with hex colors and fills rows with dark-only backgrounds (`STRIPE`, `BAND`, `HOVER`).
  - Has a second accent (`#d19a66`) next to `planMode`.
  - Its band row has no mark, and only one space before its button.
  - Uses lowercase column headers and `x 1.5` for a multiplier.
- **file-links**:
  - Its toast starts with `file-links:`.
  - It writes `N lines` with no plural helper.
- **usage-footer**: separates with `┊` instead of `·`. This is the status line, which follows Claude Code's own status
  line look.
- **grammar-tracker**:
  - Ends some empty states with a period and some without.
