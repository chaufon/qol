# file-links

Makes the file references in Claude's replies clickable. A click opens the file in a pane beside the transcript, scrolled to the referenced line, with that line highlighted.

## What counts as a reference

- A path with an extension in plain text: `src/app.ts`, `src/app.ts:42`, `src/app.ts:42:7`, `src/app.ts:42-58`, `src/app.ts#L42`.
- Any path inside a code span, with or without an extension: `` `Makefile` ``, `` `src/app.ts:42` ``.
- A bare file name such as `app.ts` links when exactly one file in the project has that name.

On Windows, a path may start with a drive (`C:\proj\src\app.ts`) and use `\` or `/` between its parts.

Only references to files that exist become links. Paths are resolved against the session's working directory, with the file list from `git ls-files` (tracked and untracked, ignored files left out) and the disk for the rest. Text in code fences, markdown links and URLs is left as written.

## Use

Click a reference with a plain single click. Links are added only in the fullscreen terminal, the one surface that reports a click on a link to the mod; the main screen, the desktop and mobile apps and other surfaces draw replies as written. A ctrl or alt click opens the link with the system instead. Press Esc or the pane's close mark to close the pane.

The pane draws up to 300 lines above the referenced line and as many after it as fit in 90,000 characters. A binary file is not drawn.

The project's file list is read again after each turn. Replies already drawn get new links only when that list changes, that is, when a file is added or deleted.

## With other mods

Claude Code does not let a mod choose its place among the installed mods that draw a reply. file-links adds its links last wherever it sits: it lets every other mod rewrite the reply first (grammar-tracker hides its check this way), then links the text as Claude Code draws it.

A mod that draws a reply itself, instead of handing a rewritten text on, keeps its drawing: file-links adds no links to that reply and shows a toast naming the mod, once per session.

## Known limits

- A mod that draws a reply itself and sits outside file-links never hands the reply on, so file-links never sees it: that reply has no links and no toast names the mod.
- Paths are resolved against the session's working directory. A path written from the repository root does not link in a session started in a subfolder.

## Install

```
/plugin install file-links --marketplace chaufon/qol
```

The [marketplace README](../../README.md) has the shell command, updates and uninstalling.
