import logging
import gspread
import gspread.utils
from google.oauth2.service_account import Credentials

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]


class SheetsClient:
    def __init__(self, creds_path: str, spreadsheet_id: str):
        self._spreadsheet_id = spreadsheet_id
        creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
        self._gc = gspread.authorize(creds)
        self._spreadsheet = self._gc.open_by_key(spreadsheet_id)
        self._ws_cache: dict[str, gspread.Worksheet] = {}

    def get_worksheet(self, tab_name: str) -> gspread.Worksheet:
        if tab_name not in self._ws_cache:
            self._ws_cache[tab_name] = self._spreadsheet.worksheet(tab_name)
        return self._ws_cache[tab_name]

    def get_or_create_worksheet(self, tab_name: str, rows: int = 200, cols: int = 30) -> gspread.Worksheet:
        try:
            ws = self._spreadsheet.worksheet(tab_name)
        except gspread.WorksheetNotFound:
            logger.info(f"Creating new worksheet: '{tab_name}'")
            ws = self._spreadsheet.add_worksheet(title=tab_name, rows=rows, cols=cols)
        self._ws_cache[tab_name] = ws
        return ws

    def read_all_values(self, tab_name: str) -> list[list[str]]:
        ws = self.get_worksheet(tab_name)
        return ws.get_all_values()

    def read_as_records(self, tab_name: str) -> list[dict]:
        ws = self.get_worksheet(tab_name)
        return ws.get_all_records()

    def clear_and_write(self, tab_name: str, rows: list[list], create_if_missing: bool = False) -> None:
        if create_if_missing:
            ws = self.get_or_create_worksheet(tab_name, rows=max(len(rows) + 10, 200), cols=30)
        else:
            ws = self.get_worksheet(tab_name)
        ws.clear()
        if rows:
            ws.update("A1", rows, value_input_option="USER_ENTERED")
        logger.info(f"Wrote {len(rows)} rows to '{tab_name}'")

    def update_range(self, tab_name: str, a1_range: str, values: list[list]) -> None:
        ws = self.get_worksheet(tab_name)
        ws.update(a1_range, values, value_input_option="USER_ENTERED")
        logger.info(f"Updated range {a1_range} in '{tab_name}' ({len(values)} rows)")

    def batch_format_cells(self, tab_name: str, formats: list[dict]) -> None:
        if not formats:
            return
        ws = self.get_worksheet(tab_name)
        ws.batch_format(formats)
        logger.info(f"Applied {len(formats)} format ranges to '{tab_name}'")

    def clear_formatting(self, tab_name: str, a1_range: str) -> None:
        ws = self.get_worksheet(tab_name)
        ws.format(a1_range, {
            "backgroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
            "textFormat": {"strikethrough": False, "bold": False, "foregroundColor": {"red": 0, "green": 0, "blue": 0}},
        })

    def delete_worksheet(self, tab_name: str) -> bool:
        """
        Delete a worksheet by name. Returns True if deleted, False if it didn't exist.
        Clears the cached reference so a subsequent get_or_create_worksheet starts fresh.
        """
        try:
            ws = self._spreadsheet.worksheet(tab_name)
            self._spreadsheet.del_worksheet(ws)
            self._ws_cache.pop(tab_name, None)
            logger.info(f"Deleted worksheet '{tab_name}'")
            return True
        except gspread.WorksheetNotFound:
            logger.info(f"Worksheet '{tab_name}' not found, nothing to delete")
            return False

    def invalidate_cache(self, tab_name: str = None) -> None:
        if tab_name:
            self._ws_cache.pop(tab_name, None)
        else:
            self._ws_cache.clear()


def col_letter(col_index: int) -> str:
    """Convert 1-based column index to A1 column letter(s). col_index=1 → 'A', 27 → 'AA'."""
    return gspread.utils.rowcol_to_a1(1, col_index)[:-1]
