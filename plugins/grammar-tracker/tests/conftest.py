import json
import os
import sys
import tempfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
# Keeps lib.config, imported by the tests, away from the real data folder. Tests that touch the database run the scripts
# with a folder of their own.
os.environ.setdefault("CLAUDE_PLUGIN_DATA", tempfile.mkdtemp(prefix="grammar-tracker-"))


def script_env(home: Path, **env: str) -> dict[str, str]:
    """The environment of a script run by a test: the given variables, the home folder on Linux, macOS (HOME) and
    Windows (USERPROFILE), and SYSTEMROOT, which Python needs to start on Windows."""
    system = {"SYSTEMROOT": os.environ["SYSTEMROOT"]} if "SYSTEMROOT" in os.environ else {}
    return {**system, "HOME": str(home), "USERPROFILE": str(home), **env}


def user(uuid: str, content: object, **extra: object) -> dict[str, Any]:
    return {
        "type": "user",
        "uuid": uuid,
        "timestamp": "2026-10-17T12:00:00.000Z",
        "message": {"role": "user", "content": content},
        **extra,
    }


def assistant(uuid: str, text: str) -> dict[str, Any]:
    return {
        "type": "assistant",
        "uuid": uuid,
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    }


def block(payload: object) -> str:
    return "**English grammar check:**\n```grammar-json\n" + json.dumps(payload) + "\n```\n\nRest of the reply."


@pytest.fixture
def write_transcript(tmp_path: Path) -> Callable[[Iterable[object]], Path]:
    def write(entries: Iterable[object]) -> Path:
        path = tmp_path / "transcript.jsonl"
        path.write_text("".join(json.dumps(e) + "\n" for e in entries))
        return path

    return write
