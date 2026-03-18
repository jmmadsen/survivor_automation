import logging

from src.config import SHEET_MASTER, SHEET_SIGNUP
from src.sheets_client import SheetsClient

logger = logging.getLogger(__name__)

_NAME_KEYWORDS = ["your name", "name"]
_EMAIL_KEYWORDS = ["email", "e-mail"]


def populate_master_roster(client: SheetsClient) -> None:
    """
    Pull unique names and emails from the Signup Tracker and add any participants
    not already in the Master sheet. Writes names to Column A and emails to Column B.
    Only appends — never overwrites existing rows.
    """
    # --- Read Signup Tracker ---
    signup_rows = client.read_all_values(SHEET_SIGNUP)
    if not signup_rows or len(signup_rows) < 2:
        print("Signup Tracker is empty or has no data rows.")
        return

    headers = signup_rows[0]
    name_col = _find_column(headers, _NAME_KEYWORDS, fallback=1, label="name")
    email_col = _find_column(headers, _EMAIL_KEYWORDS, fallback=2, label="email")

    logger.info(
        f"Signup Tracker — name col: {name_col} ('{headers[name_col]}'), "
        f"email col: {email_col} ('{headers[email_col]}')"
    )

    # Extract unique (name, email) pairs in order of appearance
    entries: list[tuple[str, str]] = []
    seen: set[str] = set()
    for row in signup_rows[1:]:
        name = row[name_col].strip() if len(row) > name_col else ""
        email = row[email_col].strip() if len(row) > email_col else ""
        if name and name not in seen:
            entries.append((name, email))
            seen.add(name)

    if not entries:
        print("No names found in Signup Tracker.")
        return

    print(f"Found {len(entries)} unique participants in Signup Tracker.")

    # --- Read existing Master names ---
    master_rows = client.read_all_values(SHEET_MASTER)
    existing_names: set[str] = set()
    last_data_row = 1  # 1-indexed; row 1 is the header
    if master_rows:
        for i, row in enumerate(master_rows[1:], start=2):
            if row and row[0].strip():
                existing_names.add(row[0].strip())
                last_data_row = i

    # --- Determine new entries to add ---
    new_entries = [(n, e) for n, e in entries if n not in existing_names]
    if not new_entries:
        print("Master sheet is already up to date — no new participants to add.")
        return

    print(f"Adding {len(new_entries)} new participant(s) to Master sheet...")

    # --- Batch write names + emails to Columns A and B ---
    start_row = last_data_row + 1
    end_row = start_row + len(new_entries) - 1

    rows_to_write = [[name, email] for name, email in new_entries]
    client.update_range(SHEET_MASTER, f"A{start_row}:B{end_row}", rows_to_write)

    print(f"Done. Added rows {start_row}–{end_row} to Master sheet.")
    for name, email in new_entries:
        print(f"  + {name} ({email or 'no email'})")


def _find_column(headers: list[str], keywords: list[str], fallback: int, label: str) -> int:
    """Return the index of the first header containing any keyword (case-insensitive)."""
    lower = [h.lower() for h in headers]
    for keyword in keywords:
        for i, h in enumerate(lower):
            if keyword in h:
                return i
    logger.warning(
        f"Could not find a {label} column in Signup Tracker headers {headers}. "
        f"Defaulting to column index {fallback}."
    )
    return fallback
