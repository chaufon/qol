"""Code shared by the grammar tracker scripts. Importing it on a Python older than MIN_PYTHON logs the error and
exits with it, before any module that needs a newer Python loads. This file keeps to syntax that older Pythons
parse."""
import sys

MIN_PYTHON = (3, 10)

if sys.version_info < MIN_PYTHON:
    from lib.errorlog import log_error

    found = ".".join(str(part) for part in sys.version_info[:3])
    error = f"Grammar tracker needs Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} or newer, found {found}"
    log_error(f"{error}\n")
    sys.exit(error)
