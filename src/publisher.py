import logging

import gspread

from src.config import GAME_DAYS, SHEET_PUBLIC
from src.formatted_builder import (
    _read_master, _build_player_records, _sort_players,
    _build_header_row, _build_player_row, _build_format_requests,
)
from src.results_updater import read_all_available_and_losers
from src.sheets_client import SheetsClient

logger = logging.getLogger(__name__)


def publish_picks(
    private_client: SheetsClient,
    public_client: SheetsClient,
    game_days_with_results: list[str],
    through_day: str | None = None,
) -> None:
    """
    Build the formatted picks data from the private spreadsheet and write it
    directly to the Public Picks tab in the public spreadsheet.

    Args:
        private_client: SheetsClient for the private master spreadsheet (read-only).
        public_client:  SheetsClient for the public participant-facing spreadsheet (write).
        game_days_with_results: Days that have final results (drives coloring).
        through_day: If set, only show columns through this game day. Picks for later
                     days are hidden so participants can't see future rounds. None = all days.
    """
    display_days = _resolve_display_days(through_day)

    # Only color days that are both in results AND within the visible window
    visible_result_days = [d for d in game_days_with_results if d in set(display_days)]

    # Read and process data from private spreadsheet.
    # Use visible_result_days (not game_days_with_results) so that results beyond
    # the --day cutoff don't affect elimination status or pick coloring.
    available_by_day, losers_by_day = read_all_available_and_losers(private_client)
    master_data = _read_master(private_client)
    players = _build_player_records(master_data, available_by_day, losers_by_day, visible_result_days)
    players_sorted = _sort_players(players)

    # Build output
    header_row = _build_header_row(display_days)
    data_rows = [_build_player_row(p, display_days) for p in players_sorted]
    all_rows = [header_row] + data_rows

    # Write values then formatting to the public spreadsheet
    public_client.clear_and_write(SHEET_PUBLIC, all_rows, create_if_missing=True)
    formats = _build_format_requests(players_sorted, display_days, visible_result_days)
    public_client.batch_format_cells(SHEET_PUBLIC, formats)

    alive_count = sum(1 for p in players_sorted if p.still_alive)
    day_label = f"through {through_day}" if through_day else "all days"
    print(f"Published '{SHEET_PUBLIC}': {len(players_sorted)} players ({alive_count} alive), {day_label}.")


def reset_public_sheet(public_client: SheetsClient) -> None:
    """
    Reset the Public Picks tab in the public spreadsheet.

    Preferred: delete the tab entirely so the next publish recreates it fresh.
    Fallback: if it's the only sheet in the workbook (Google won't allow deletion),
    clear all content and reset all formatting instead.
    """
    try:
        deleted = public_client.delete_worksheet(SHEET_PUBLIC)
        if deleted:
            print(f"Reset complete: '{SHEET_PUBLIC}' tab deleted from public spreadsheet.")
            print("Run 'python main.py publish' to rebuild it.")
        else:
            print(f"Nothing to reset: '{SHEET_PUBLIC}' tab did not exist in the public spreadsheet.")
    except gspread.exceptions.APIError as e:
        if "can't remove all the sheets" in str(e).lower() or "deletsheet" in str(e).lower():
            # Only sheet in the workbook — clear content and formatting instead
            public_client.clear_and_write(SHEET_PUBLIC, [], create_if_missing=False)
            public_client.clear_formatting(SHEET_PUBLIC, "A1:Z500")
            print(f"Reset complete: '{SHEET_PUBLIC}' content and formatting cleared.")
            print("(Tab was kept because it's the only sheet in the workbook.)")
            print("Run 'python main.py publish' to rebuild it.")
        else:
            raise


def _resolve_display_days(through_day: str | None) -> list[str]:
    """Return columns to show: all GAME_DAYS, or truncated at through_day."""
    if through_day is None:
        return GAME_DAYS
    if through_day not in GAME_DAYS:
        raise ValueError(f"Invalid --day '{through_day}'. Valid options: {GAME_DAYS}")
    through_index = GAME_DAYS.index(through_day)
    return [d for d in GAME_DAYS if GAME_DAYS.index(d) <= through_index]
