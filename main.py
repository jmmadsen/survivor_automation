#!/usr/bin/env python3
"""
March Madness Survivor Pool Automation CLI

Commands:
  update-results   --day DATE       Fetch ESPN results, update Teams & Results sheet
  update-formatted [--days DATE...] Rebuild internal Formatted sheet
  publish          [--day DATE]     Push to public participant-facing sheet
  run-all          --day DATE       update-results + update-formatted in sequence
  test-connection                   Verify Google Sheets auth and ESPN API connectivity
"""

import argparse
import logging
import os
import sys

from dotenv import load_dotenv

from src.config import GAME_DAYS
from src.results_updater import detect_days_with_results, update_results_for_day, populate_seeds
from src.formatted_builder import build_formatted_sheet
from src.publisher import publish_picks, reset_public_sheet
from src.roster_sync import populate_master_roster
from src.sheets_client import SheetsClient


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # Quiet down noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("googleapiclient").setLevel(logging.WARNING)


def load_config() -> tuple[str, str, str | None]:
    """Load env vars. Returns (creds_path, spreadsheet_id, public_spreadsheet_id)."""
    load_dotenv()
    creds_path = os.environ.get("GOOGLE_CREDS_PATH", "credentials/service_account.json")
    spreadsheet_id = os.environ.get("SPREADSHEET_ID", "")
    public_spreadsheet_id = os.environ.get("PUBLIC_SPREADSHEET_ID", "")

    if not spreadsheet_id:
        print("ERROR: SPREADSHEET_ID is not set. Copy .env.example to .env and fill it in.")
        sys.exit(1)
    if not os.path.exists(creds_path):
        print(f"ERROR: Credentials file not found at '{creds_path}'.")
        print("See README.md for Google Cloud setup instructions.")
        sys.exit(1)

    return creds_path, spreadsheet_id, public_spreadsheet_id or None


def cmd_update_results(args, private_client: SheetsClient) -> None:
    update_results_for_day(private_client, args.day)


def cmd_update_formatted(args, private_client: SheetsClient) -> None:
    if args.days_with_results:
        days = args.days_with_results
        print(f"Using specified days: {', '.join(days)}")
    else:
        days = detect_days_with_results(private_client)
        if days:
            print(f"Auto-detected completed days: {', '.join(days)}")
        else:
            print("No completed game days detected yet — all picks will appear yellow (pending).")

    if getattr(args, "dry_run", False):
        _dry_run_formatted(private_client, days)
    else:
        build_formatted_sheet(private_client, days)


def _dry_run_formatted(client: SheetsClient, days_with_results: list[str]) -> None:
    """Process the Formatted sheet data and print a summary without writing anything."""
    from src.config import GAME_DAYS as ALL_DAYS
    from src.formatted_builder import _read_master, _build_player_records, _sort_players
    from src.results_updater import read_all_available_and_losers

    print(f"\n[DRY RUN] Results loaded for: {', '.join(days_with_results)}")
    print(f"[DRY RUN] Displaying all {len(ALL_DAYS)} game days as columns\n")

    available_by_day, losers_by_day = read_all_available_and_losers(client)
    master_data = _read_master(client)
    players = _build_player_records(master_data, available_by_day, losers_by_day, days_with_results)
    players_sorted = _sort_players(players)

    alive = [p for p in players_sorted if p.still_alive]
    eliminated = [p for p in players_sorted if not p.still_alive]

    print(f"Players read from Master sheet: {len(players_sorted)}")
    print(f"  Still alive : {len(alive)}")
    print(f"  Eliminated  : {len(eliminated)}")

    result_set = set(days_with_results)
    col_w = 22
    pick_w = 14
    header = f"{'Name':<{col_w}}" + "".join(f"{d:^{pick_w}}" for d in ALL_DAYS) + "  STATUS"
    print("\n" + header)
    print("-" * len(header))

    for p in players_sorted:
        status = "ALIVE" if p.still_alive else f"OUT ({p.eliminated_on or '?'})"
        picks_str = ""
        for day in ALL_DAYS:
            pick = p.picks.get(day)
            s = p.pick_statuses.get(day) if day in result_set else None
            if s is not None and s.is_loser:
                cell = f"[X]{s.picked_team or ''}"
            elif pick:
                cell = pick
            elif s is not None and s.picked_team is None:
                cell = "(no pick)"
            else:
                cell = "-"
            picks_str += f"{cell:^{pick_w}}"
        print(f"{p.name:<{col_w}}{picks_str}  {status}")

    print(f"\n[DRY RUN] Nothing written. Remove --dry-run to write to the Formatted sheet.\n")


def cmd_test_connection(args, private_client: SheetsClient) -> None:
    """Verify Google Sheets connectivity and ESPN API, without writing anything."""
    from src.config import SHEET_MASTER, SHEET_TEAMS_RESULTS
    from src.espn_client import fetch_teams_for_day, _fetch_mascot_words_for_date

    print("=" * 50)
    print("TEST 1: Google Sheets connection")
    print("=" * 50)
    try:
        rows = private_client.read_all_values(SHEET_MASTER)
        data_rows = [r for r in rows[1:] if r and r[0].strip()]
        print(f"  Master sheet: {len(data_rows)} player rows found")
        if data_rows:
            sample = [r[0] for r in data_rows[:3]]
            print(f"  Sample names : {', '.join(sample)}")
    except Exception as e:
        print(f"  FAILED: {e}")
        return

    try:
        rows = private_client.read_all_values(SHEET_TEAMS_RESULTS)
        print(f"  Teams & Results: {len(rows)} rows found")
    except Exception as e:
        print(f"  Teams & Results FAILED: {e}")

    print("\n" + "=" * 50)
    print("TEST 2: ESPN API — 2026 tournament (3/19/2026)")
    print("=" * 50)
    test_date = "20260319"  # First day of the 2026 NCAA Tournament
    try:
        teams = fetch_teams_for_day("3/19", test_date)
        if teams:
            print(f"  ESPN returned {len(teams)} teams for 2026-03-19:")
            for i in range(0, len(teams), 8):
                print(f"    {', '.join(teams[i:i+8])}")
        else:
            print("  ESPN returned 0 teams — bracket data may not be posted yet for 3/19.")
    except Exception as e:
        print(f"  FAILED: {e}")
        return

    print("\n" + "=" * 50)
    print("TEST 3: Mascot word extraction from ESPN")
    print("=" * 50)
    try:
        mascots = _fetch_mascot_words_for_date(test_date)
        if mascots:
            print(f"  Derived {len(mascots)} mascot words from 2026-03-19 bracket data:")
            print(f"    {', '.join(sorted(mascots))}")
        else:
            print("  No mascot words derived — bracket data may not be available yet.")
    except Exception as e:
        print(f"  FAILED: {e}")
        return

    print("\n" + "=" * 50)
    print("All tests passed. Your setup is ready.")
    print("=" * 50)


def cmd_publish(args, private_client: SheetsClient, public_client: SheetsClient | None) -> None:
    if public_client is None:
        print("ERROR: PUBLIC_SPREADSHEET_ID is not set in .env. Cannot publish.")
        sys.exit(1)

    days = detect_days_with_results(private_client)
    if not days:
        print("No completed game days detected — publishing with all picks marked yellow (pending).")

    through_day = getattr(args, "day", None)
    publish_picks(private_client, public_client, days, through_day=through_day)


def cmd_populate_master(args, private_client: SheetsClient) -> None:
    populate_master_roster(private_client)


def cmd_populate_seeds(args, private_client: SheetsClient) -> None:
    populate_seeds(private_client)


def cmd_reset_public(args, private_client: SheetsClient, public_client: SheetsClient | None) -> None:
    if public_client is None:
        print("ERROR: PUBLIC_SPREADSHEET_ID is not set in .env. Cannot reset public sheet.")
        sys.exit(1)
    reset_public_sheet(public_client)


def cmd_run_all(args, private_client: SheetsClient) -> None:
    print(f"--- Step 1: Updating results for {args.day} ---")
    update_results_for_day(private_client, args.day)

    print(f"\n--- Step 2: Rebuilding Formatted sheet ---")
    days = detect_days_with_results(private_client)
    if days:
        print(f"Completed days: {', '.join(days)}")
    else:
        print(f"No final results found for {args.day} yet — picks will appear yellow (pending).")
    build_formatted_sheet(private_client, days)
    print("\nDone. Run 'python main.py publish' when ready to share picks with participants.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="March Madness Survivor Pool Automation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    # update-results
    p_results = sub.add_parser(
        "update-results",
        help="Fetch game results from ESPN and update Teams & Results sheet",
    )
    p_results.add_argument(
        "--day", required=True, choices=GAME_DAYS,
        metavar="DATE",
        help=f"Game day to update. One of: {', '.join(GAME_DAYS)}",
    )

    # update-formatted
    p_formatted = sub.add_parser(
        "update-formatted",
        help="Rebuild the internal Formatted sheet from Master + game results",
    )
    p_formatted.add_argument(
        "--days-with-results", nargs="+", choices=GAME_DAYS,
        metavar="DATE",
        help="Game days that have final results. Auto-detected if omitted.",
    )
    p_formatted.add_argument(
        "--dry-run", action="store_true",
        help="Print a summary of what would be written without touching the sheet.",
    )

    # publish
    p_publish = sub.add_parser(
        "publish",
        help="Copy Formatted data to the public participant-facing spreadsheet",
    )
    p_publish.add_argument(
        "--day", choices=GAME_DAYS,
        metavar="DATE",
        help="Reveal picks only through this game day. Defaults to all completed days.",
    )

    # run-all
    p_all = sub.add_parser(
        "run-all",
        help="Run update-results then update-formatted in sequence (does not publish)",
    )
    p_all.add_argument(
        "--day", required=True, choices=GAME_DAYS,
        metavar="DATE",
        help=f"Game day to update. One of: {', '.join(GAME_DAYS)}",
    )

    # populate-master
    sub.add_parser(
        "populate-master",
        help="Pull unique names from Signup Tracker and add them to Master sheet with email formulas",
    )

    # populate-seeds
    sub.add_parser(
        "populate-seeds",
        help="Fetch tournament seeds from ESPN and write them to the Team Seeds sheet (run once per tournament)",
    )

    # reset-public
    sub.add_parser(
        "reset-public",
        help="Delete the Public Picks tab from the public spreadsheet so it can be rebuilt clean",
    )

    # test-connection
    sub.add_parser(
        "test-connection",
        help="Verify Google Sheets auth and ESPN API connectivity (read-only)",
    )

    args = parser.parse_args()
    setup_logging(args.verbose)

    creds_path, spreadsheet_id, public_spreadsheet_id = load_config()

    private_client = SheetsClient(creds_path, spreadsheet_id)
    public_client = SheetsClient(creds_path, public_spreadsheet_id) if public_spreadsheet_id else None

    if args.command == "update-results":
        cmd_update_results(args, private_client)
    elif args.command == "update-formatted":
        cmd_update_formatted(args, private_client)
    elif args.command == "publish":
        cmd_publish(args, private_client, public_client)
    elif args.command == "run-all":
        cmd_run_all(args, private_client)
    elif args.command == "populate-master":
        cmd_populate_master(args, private_client)
    elif args.command == "populate-seeds":
        cmd_populate_seeds(args, private_client)
    elif args.command == "reset-public":
        cmd_reset_public(args, private_client, public_client)
    elif args.command == "test-connection":
        cmd_test_connection(args, private_client)


if __name__ == "__main__":
    main()
