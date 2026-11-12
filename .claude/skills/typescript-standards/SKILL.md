---
name: typescript-standards
description: TypeScript standards for this repo's mods. Use when writing, changing or reviewing TypeScript under plugins/*/hooks/.
---

# TypeScript standards for qol mods

ESLint (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`), Prettier and `tsc` enforce most rules: read
`eslint.config.js` and `.prettierrc.json` rather than guessing. This file holds what the tools cannot check. For
anything neither covers, follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html).

## Module layout

Each mod is self-contained: it imports from `'claude-code'`, its own `hooks/` and its own `types/`, and never from
another mod. Split `hooks/` by job, one job per module:

| Module | Holds |
| --- | --- |
| `register.tsx` | The `register` export, the mod's atoms and module state, event handlers, and the actions handlers pass to drawing |
| `draw.tsx` | Pure drawing: `drawX(ui, props, actions)` returns elements. No `$`, no atom reads |
| `format.ts` | Pure helpers: widths, cells, colors, icons, numbers to text |
| One module per boundary | Parsing what crosses into the mod (a reply, a script's output, a transcript), or running a process |

A module that reads like two jobs is two modules. Types shared by several modules, and the mod's `PluginState`, live in
`types/index.d.ts`.

## Rules the tools miss

- **Event handlers return their promise.** Claude Code awaits what `onPress` and other handlers return and handles a
  rejection; write `onPress={() => closePane($)}`. Type action props as `() => Promise<void>`.
- **External data is `unknown` at the boundary.** `JSON.parse` output, transcript lines and script output are parsed in
  one function per boundary, then narrowed with a type guard or a typed `as T` at that single point. Everything past
  the boundary is fully typed.
- **Indexing yields `T | undefined`** (`noUncheckedIndexedAccess`). Handle it with `??`, an early return, or a loop that
  cannot miss. Non-null assertions (`!`) belong in tests only.
- **Text weight is `weight="semibold"`**, and React `key` props are strings: `` key={`row-${n}`} ``.
- **User-facing strings are named constants** at the top of the module that shows them.
- **Booleans read as yes/no questions:** `isOpen`, `hasLabel`, `isRecurring`.

## Comments

- A declaration's comment is JSDoc (`/** ... */`): its contract, its units, or why it exists. Editors show it on hover.
- A comment inside a body explains why, in one line. The code says what.
- Comments describe the code as it is.

## Tests

- A pure module gets `<module>.test.ts` beside it, calling its functions directly.
- Handler behavior is tested in `register.test.ts(x)` through `claude-code/testing`: mount the surface, press keys,
  read the drawn text.
- Test names are sentences about behavior: `'a check with no mistakes leaves an open pane open'`.

## Done

A change is done when both are green, from the repo root:

```
npm run check
claude plugin test plugins/<mod>
```
