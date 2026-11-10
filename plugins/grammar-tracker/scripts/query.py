"""Print report data from the grammar tracker database as JSON for the mod's pane.

Usage:
    python3 query.py top [N]    the N most frequent mistakes across all prompts (default 10), with the fields of
                                save_check.py's `occurrences`
    python3 query.py trend SESSION_ID [N]
                                the mistake count of each of the last N prompts (default 10) of one conversation,
                                oldest first
    python3 query.py rekey      store the transcript uuid of saved prompts that have none; prints how many got one
"""
import argparse
import json
import sqlite3
import sys

from lib import config
from lib.db import NewerDatabaseError, connect, session_trend, top_mistakes
from lib.errorlog import UNWRITABLE
from lib.rekey import rekey as rekey_prompts
from lib.report import occurrence_fields


def top(conn, args):
    return occurrence_fields(top_mistakes(conn, args.limit), config.RECURRING_THRESHOLD)


def trend(conn: sqlite3.Connection, args: argparse.Namespace) -> list[int]:
    return session_trend(conn, args.session_id, args.limit)


def rekey(conn, args):
    return {"rekeyed": rekey_prompts(conn)}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Print report data from the grammar tracker database as JSON.")
    commands = parser.add_subparsers(required=True, metavar="command")
    top_parser = commands.add_parser("top", help="the most frequent mistakes across all prompts")
    top_parser.add_argument("limit", nargs="?", type=int, default=10, help="number of mistakes (default 10)")
    top_parser.set_defaults(run=top)
    trend_parser = commands.add_parser("trend", help="the mistakes per prompt of one conversation")
    trend_parser.add_argument("session_id", help="the conversation id")
    trend_parser.add_argument("limit", nargs="?", type=int, default=10, help="number of prompts (default 10)")
    trend_parser.set_defaults(run=trend)
    rekey_parser = commands.add_parser("rekey", help="store the transcript uuid of saved prompts that have none")
    rekey_parser.set_defaults(run=rekey)
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
