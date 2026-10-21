"""The error log in the data folder, where the scripts write their failures instead of blocking Claude Code."""
from datetime import datetime

from lib import config

# The warning a script shows when the data folder cannot be created or written.
UNWRITABLE = f"Grammar tracker: cannot write to the data folder {config.HOME}"


def log_error(text: str) -> bool:
    """Append text to the error log under a timestamp line. Return False when the data folder cannot be written."""
    try:
        config.HOME.mkdir(parents=True, exist_ok=True)
        with config.ERROR_LOG.open("a") as log:
            log.write(f"--- {datetime.now().isoformat(timespec='seconds')}\n{text}")
    except OSError:
        return False
    return True
