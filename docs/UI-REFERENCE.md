# Claude Code mod UI reference

What the mod API offers for drawing, as of Claude Code 2.1.325. The API is early access and moves between releases:
the authority is the declaration file the engine writes into each loaded mod,
`plugins/<name>/.claude-plugin/types/claude-code/index.d.ts` (grep it for `Pane: {`, `AbovePrompt`, `BoxProps`). To
refresh this file, load the `plugin-authoring` skill and read its `reference.md`, `look.md` and `types/claude-code.d.ts`.

How the qol mods use these pieces is in [`DESIGN.md`](../DESIGN.md).

## Surfaces

- A `ui.render` hook gets:
  - `e.surface`: `terminal`, `desktop`, `vscode` or `mobile`;
  - `e.component` and `e.requestId`;
  - `e.props`;
  - `e.viewport`: `columns` and `rows` in cells, and `isFullscreen`.
- Take elements from `$.ui.resolve(e)`. There are no element globals.
- Every surface has Box, Text, Button, Input, Select, Link, Code, Markdown and Progress.
  - The terminal adds Raster and Image.
  - Desktop, vscode and mobile add Svg.
  - An element a surface does not know draws as a fragment.
- Changing the width re-runs every render hook. Changing only the height redraws nothing.
- Themes ("looks") are drawn only by the desktop and mobile apps. The terminal draws the person's own theme.

## Elements

**Box**
- Layout:
  - `flexDirection`, `flexGrow`, `flexShrink`, `flexWrap`, `alignItems`, `alignSelf`, `justifyContent`;
  - `width`, `height`, `minWidth`, `minHeight`;
  - `overflow` (`visible | hidden`), `display` (`flex | none`).
- Spacing:
  - `gap`, `columnGap`, `rowGap`;
  - `margin*` and `padding*` (`X`, `Y`, `Top`, `Bottom`, `Left`, `Right`).
  - Each takes a number of cells or a step: `xs sm md lg xl`. On the terminal that is 1 1 2 3 4 columns across and
    0 0 1 1 2 rows down.
  - Prefer `gap` on the parent to margins on each child.
- Border and fill:
  - `borderStyle`: `single`, `double`, `round`, `bold`, `singleDouble`, `doubleSingle`, `classic`, `arrow`, `dashed`
    or `quote`. Any other value draws no border.
  - `borderColor`, `borderDimColor`, `backgroundColor`.
- `position="absolute"` with `top`, `left`, `right`, `bottom`: the Box leaves the flow and paints over earlier
  siblings, clipped to its site.
- A `key` makes a Box a hover scope. `hover` overrides its border, background, `display` and offsets.

**Text**
- Color: `color`, `backgroundColor`, `dimColor`.
- Style:
  - `weight`: `regular | medium | semibold | bold`. The terminal draws semibold and bold as bold.
  - `italic`, `underline`, `strikethrough`, `inverse`.
  - `bold` is deprecated: use `weight`.
- `wrap`: `wrap | end | middle | truncate | truncate-start | truncate-middle | truncate-end`.
- The terminal ignores `size`, `mono` and `tabular`.

**Button**
- Content: `label`, or children made of strings and Text.
- Required: `onPress`.
- `key`: defaults to the label. Give each Button in a list its own key.
- `hotkey`: one digit or lowercase letter. When two mods use the same hotkey, it presses neither.
- `plain`: drops the brackets. The terminal draws `[ label ]` otherwise.
- `dimColor`.
- `variant`: `primary | secondary`. `plain` wins over it.
- Also: `action`, `autoFocus`, `role: 'dismiss'`.

**Others**
- `Code`: `source`, `language`, `path`, `startLine`, `format` (`source | diff`), `wrap`.
- `Markdown`: `text`, `pressableLinks`, `onLinkPress`.
- `Link`: `href`, `label`.
- `Progress`: `label` (read by screen readers), `value`, `max`, `valueText`, `color`.
- `Input` and `Select`.
- Terminal only:
  - `Raster`, for any grid of colored cells (never one Box per cell);
  - `Image`, with `alt`, for kitty or iTerm2 graphics.

A tree draws at most its first 100,000 characters of text.

## Color

- `Color` is a theme key or any raw color string such as `#C8102E`. A theme key follows the person's light or dark
  theme. A raw color does not, and the mod cannot tell which theme is on.
- Theme keys:
  - Text: `text`, `inverseText`, `inactive`, `subtle`.
  - Status: `success`, `error`, `warning`, `suggestion`, `remember`, `merged`.
  - Prompt box and modes: `claude`, `permission`, `planMode`, `autoAccept`, `ide`, `promptBorder`, `bashBorder`.
  - Diffs: `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`, `diffAddedWord`, `diffRemovedWord`.
- The docs give no hex values for these keys: they come from the person's theme.

## Panes

**`$.ui.open({ id, title, ... })`**
- `id`: 1 to 64 letters, digits, `_` or `-`. Opening an id that is already open only changes its title.
- `title`: drawn as a tab only while more than one pane is open.
- `focus`: granted only while the prompt has the keys and is empty.
- `closeOnEscape`: Esc closes the pane, raising `ui.close` with origin `person`.
- `holdToasts`: holds toasts while the pane shows. For dialogs.
- `rows`: the height when inline (default a third). `columns`: the width when docked (at most 45% of the terminal,
  at least 24).
- `backgroundColor`.

**Placement**
- A pane the person asked for is placed at any width.
- A pane the mod opens on its own is placed from 144 columns, or 110 once the person has opened that id. Below that it
  waits, and `open` resolves `{ isPlaced: false, reason }`.
- Fullscreen docks a pane from 110 columns. The main screen draws it inline above the prompt.

**Render props** (`ui.render` on `{ component: 'Pane', requestId: id }`)
- `bodyColumns`: the width inside the frame. Size the tree to it, not to the viewport.
- `scroll`: `{ offset, bodyRows }`, owned by the engine.
- `placement` (`dock | inline | widget`), `isFocused`, `isPromptCovered`, `title`, `view`.

**Closing, scrolling, focus**
- The person moves focus with ctrl+x tab and closes the pane with its close mark or ctrl+x x.
- `$.ui.close({ id })` raises `ui.close` with `origin.kind` `plugin`, `person` or `unload`.
- Also: `$.ui.scroll`, `$.ui.focus`, `$.ui.panes()`.
- The engine draws no footer: a mod that wants one draws it at
  `top = scroll.offset + scroll.bodyRows - <its rows>`.

## Band above the prompt

- A `ui.render` hook on `{ component: 'AbovePrompt' }` answers the mod's own row. A row that does not validate draws
  nothing and leaves the other rows alone.
- Props:
  - `hasSurvey`: give way to the survey.
  - `isCollapsed`: still return a tree; nothing shows.
  - `isWorking`.
  - `maxRows`: capped at half the terminal. A taller tree scrolls.
  - `bodyColumns`: the width minus 5 cells.
  - `scroll`, `view`.
- The person collapses the band with ctrl+x ctrl+a or `[-]`.
- Bare digit hotkeys work only for Buttons fully in view.
- `AbovePromptList` can hide, reorder or wrap the rows it is given.

## Status line, hint, toasts, tool rows

- `$.ui.status(text)`: one pinned line per mod under the prompt. `undefined` clears it.
- `PromptHint`: rewrite the dim hint line under the prompt, or add a `tail`.
- `$.ui.toast(text, { timeoutMs })`:
  - The default timeout is 4,000 ms. Toasts stack at the top right. A click removes one; hover holds it.
  - A new toast replaces only the mod's own toast.
- `ToolUse` rows get `tool`, `input`, `isRunning`, `isErrored`, `isExpanded`, `output`. A compact custom row returns
  `next(e)` while `isExpanded` is true, so ctrl+o still shows everything.

## Accessibility and motion

- `alt` is required on Image and Svg. Progress reads its `label` aloud.
- Keep meaning in color: red for danger, green for success, amber for warning.
- The docs say nothing about reduced motion, and a mod cannot read such a setting. Keep animation short, and make the
  final frame stand on its own.
