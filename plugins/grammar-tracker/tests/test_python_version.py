import subprocess
import sys

import pytest
from conftest import ROOT, script_env

# Runs a script as `python3 <script>` would, on a Python that reports itself as 3.9.
OLD_PYTHON = "import runpy, sys; sys.version_info = (3, 9, 6); sys.argv = sys.argv[1:]; " \
             "runpy.run_path(sys.argv[0], run_name='__main__')"


@pytest.mark.parametrize("script, args", [("prompt_hook.py", []), ("stop_hook.py", []), ("query.py", ["top"])])
def test_script_on_old_python_logs_and_exits_with_the_version(tmp_path, script, args):
    result = subprocess.run([sys.executable, "-c", OLD_PYTHON, str(ROOT / "scripts" / script), *args], input="{}",
                            capture_output=True, text=True, check=False, cwd=ROOT / "scripts",
                            env=script_env(tmp_path, CLAUDE_PLUGIN_DATA=str(tmp_path)))
    error = "Grammar tracker needs Python 3.10 or newer, found 3.9.6"
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.strip() == error
    assert error in (tmp_path / "errors.log").read_text()
    assert not (tmp_path / "grammar.db").exists()
