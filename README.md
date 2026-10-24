# qol

Quality-of-life mods for Claude Code.

| Mod | What it does |
| --- | --- |
| [usage-footer](plugins/usage-footer) | Shows context usage, the 5-hour rate-limit window and its reset time at the right of the prompt footer |
| [grammar-tracker](plugins/grammar-tracker) | Checks the English grammar of each prompt, counts repeated mistakes, and shows the check in a band and a pane. Needs Python 3.10 or later as `python3`, on Linux, macOS and Windows |
| [file-links](plugins/file-links) | Makes the file references in Claude's replies clickable and opens the file at that line in a side pane. Clicks work in the fullscreen terminal |

## Install

At the prompt of a Claude Code terminal session, one line per mod:

```
/plugin install usage-footer --marketplace chaufon/qol
/plugin install grammar-tracker --marketplace chaufon/qol
/plugin install file-links --marketplace chaufon/qol
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

From a shell:

```
claude plugin install usage-footer --marketplace chaufon/qol
claude plugin install grammar-tracker --marketplace chaufon/qol
claude plugin install file-links --marketplace chaufon/qol
```

A private repository installs only on machines that hold a git credential for github.com (an SSH key, or `gh auth login` followed by `gh auth setup-git`).

## Update

Claude Code does not update mods from this marketplace on its own. Get a new version from a shell:

```
claude plugin marketplace update qol
claude plugin update usage-footer@qol
claude plugin update grammar-tracker@qol
claude plugin update file-links@qol
```

Then run `/reload-plugins` in an open session, or start a new session.

To receive new versions without commands, turn on auto-update once: run `/plugin`, open the **Marketplaces** tab, select `qol` and choose **Enable auto-update**. New versions load in the next session or after `/reload-plugins`.

## Uninstall

Remove one mod and keep the marketplace:

```
claude plugin uninstall usage-footer@qol
claude plugin uninstall grammar-tracker@qol
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

Run a session with a mod loaded from this folder (repeat `--plugin-dir` to load both):

```
claude --plugin-dir plugins/usage-footer
```

Check a mod:

```
claude plugin validate plugins/usage-footer
claude plugin test plugins/usage-footer
npx -y -p typescript tsc -p plugins/usage-footer
```

The type check needs `plugins/<mod>/.claude-plugin/types/`, which Claude Code writes the first time it loads the mod. grammar-tracker also has a pytest suite; see its README.

Release a new version by raising `version` in the mod's `.claude-plugin/plugin.json` in the same push as the change. Claude Code compares that field to decide whether an update exists, so a push that keeps the same `version` reaches no one.
