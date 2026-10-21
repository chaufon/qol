# usage-footer

Shows three readings at the right of the prompt footer, after the mode labels:

```
📚 103k (10%) ┊ █░░░░░░░░░ 14% 🔔 14:30 (3h 18m)
```

| Segment | Meaning | Colors |
| --- | --- | --- |
| `📚 103k (10%)` | Context size in tokens, and its share of the model's window | green below 100k, yellow up to 150k, red above |
| `█░░░░░░░░░ 14%` | Use of the 5-hour rate-limit window | green below 70%, yellow up to 90%, red above |
| `🔔 14:30 (3h 18m)` | When the 5-hour window resets, and the time left | green, red at 30 minutes or less |

The readings update after each response, after `/compact` and automatic compaction, and after `/clear`, `/rewind`, `/resume` and `/model`. Until a conversation has its first response, the size is a local estimate. The time left updates every 30 seconds.

When the terminal is too narrow for one line, the footer wraps the readings onto a second line.

## Install

```
/plugin install usage-footer --marketplace chaufon/qol
```

The [marketplace README](../../README.md) has the shell command, updates and uninstalling.
