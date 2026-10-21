"""Print report data from the grammar tracker database as JSON for the mod's pane.

Usage:
    python3 query.py top [N]    the N most frequent mistakes across all prompts (default 10), with the fields of the
                                stop hook's `occurrences`
"""
import argparse
import json
import sys

from lib import config
from lib.db import NewerDatabaseError, connect, top_mistakes
from lib.errorlog import UNWRITABLE
from lib.report import occurrence_fields


def top(conn, args):
    return occurrence_fields(top_mistakes(conn, args.limit), config.RECURRING_THRESHOLD)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Print report data from the grammar tracker database as JSON.")
    commands = parser.add_subparsers(required=True, metavar="command")
    top_parser = commands.add_parser("top", help="the most frequent mistakes across all prompts")
    top_parser.add_argument("limit", nargs="?", type=int, default=10, help="number of mistakes (default 10)")
    top_parser.set_defaults(run=top)
    args = parser.parse_args(argv)
    try:
        conn = connect(config.DB_PATH)
    except NewerDatabaseError as error:
        sys.exit(str(error))
    except OSError:
        sys.exit(UNWRITABLE)
    try:
        print(json.dumps(args.run(conn, args)))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
