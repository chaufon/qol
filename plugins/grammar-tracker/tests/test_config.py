import subprocess
import sys

from conftest import ROOT, script_env


def data_folder(home, **env):
    result = subprocess.run([sys.executable, "-c", "from lib import config; print(config.HOME)"], capture_output=True,
                            text=True, env=script_env(home, **env), cwd=ROOT / "scripts", check=True)
    return result.stdout.strip()


def test_data_folder_is_in_the_home_claude_folder_by_default(tmp_path):
    assert data_folder(tmp_path) == str(tmp_path / ".claude" / "plugins" / "data" / "grammar-tracker-qol")


def test_data_folder_follows_claude_config_dir(tmp_path):
    expected = tmp_path / "config" / "plugins" / "data" / "grammar-tracker-qol"
    assert data_folder(tmp_path, CLAUDE_CONFIG_DIR=str(tmp_path / "config")) == str(expected)


def test_data_folder_follows_claude_code_plugin_cache_dir(tmp_path):
    folder = data_folder(tmp_path, CLAUDE_CONFIG_DIR=str(tmp_path / "config"),
                         CLAUDE_CODE_PLUGIN_CACHE_DIR=str(tmp_path / "plugins"))
    assert folder == str(tmp_path / "plugins" / "data" / "grammar-tracker-qol")


def test_claude_plugin_data_wins(tmp_path):
    assert data_folder(tmp_path, CLAUDE_PLUGIN_DATA=str(tmp_path / "given")) == str(tmp_path / "given")
