"""The mod's scripts run on the user's Python with nothing installed, so they import only the standard library."""

import ast
import sys
from collections.abc import Iterator
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
LOCAL = {"lib"}


def imported_modules(path: Path) -> Iterator[str]:
    """The top-level names of the modules a Python file imports, relative imports left out."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.module.split(".")[0]


def test_scripts_import_only_the_standard_library() -> None:
    """No script imports a module outside the standard library and the mod's own `lib` package."""
    outside = {
        f"{path.relative_to(SCRIPTS)}: {name}"
        for path in SCRIPTS.rglob("*.py")
        for name in imported_modules(path)
        if name not in sys.stdlib_module_names and name not in LOCAL
    }
    assert not outside
