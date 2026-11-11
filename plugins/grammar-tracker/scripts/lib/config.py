import os
from pathlib import Path

# Claude Code's configuration folder, which holds the session transcripts under projects/.
CLAUDE_DIR = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")

# Claude Code's plugins folder, which holds the plugins' data folders under data/.
PLUGINS_DIR = Path(os.environ.get("CLAUDE_CODE_PLUGIN_CACHE_DIR") or CLAUDE_DIR / "plugins")
# The data folder Claude Code gives grammar-tracker@qol: the plugin id with "@" replaced by "-".
PLUGIN_DATA = PLUGINS_DIR / "data" / "grammar-tracker-qol"

# The plugin's data folder: PLUGIN_DATA, or CLAUDE_PLUGIN_DATA when it is set (the tests and the query command line
# set it to read another folder).
HOME = Path(os.environ.get("CLAUDE_PLUGIN_DATA") or PLUGIN_DATA)
DB_PATH = HOME / "grammar.db"
ERROR_LOG = HOME / "errors.log"

# A mistake is recurring once its counter, across all prompts, reaches this value.
RECURRING_THRESHOLD = 3

# The values of the mod's native_language option, the first one its default. They match the options of
# userConfig.native_language in .claude-plugin/plugin.json.
NATIVE_LANGUAGES = ("Spanish", "Portuguese", "French", "Italian")
DEFAULT_NATIVE_LANGUAGE = NATIVE_LANGUAGES[0]
