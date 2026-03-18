# Sheet tab names (must match exactly in the Google Sheet)
SHEET_MASTER = "Master"
SHEET_PICKS = "Picks"
SHEET_TEAMS_RESULTS = "Teams & Results"
SHEET_FORMATTED = "Formatted"
SHEET_PUBLIC = "Public Picks"
SHEET_SIGNUP = "Signup Tracker"

# Game days in tournament order
GAME_DAYS = [
    "3/19", "3/20",          # Round of 64
    "3/21", "3/22",          # Round of 32
    "3/26", "3/27",          # Sweet 16
    "3/28", "3/29",          # Elite Eight
    "4/4",                   # Final Four
    "4/6",                   # Championship
]

# Maps game day label → YYYYMMDD for ESPN API calls
GAME_DAY_TO_ESPN_DATE = {
    "3/19": "20260319",
    "3/20": "20260320",
    "3/21": "20260321",
    "3/22": "20260322",
    "3/26": "20260326",
    "3/27": "20260327",
    "3/28": "20260328",
    "3/29": "20260329",
    "4/4":  "20260404",
    "4/6":  "20260406",
}

# Master sheet column header names (as they appear in the sheet)
MASTER_COL_NAME = "Name"
MASTER_COL_EMAIL = "Email"
MASTER_COL_PAID = "Paid?"
MASTER_COL_ELIMINATED = "Eliminated?"
MASTER_COL_ELIM_ON = "Eliminated On"
MASTER_PICK_PREFIX = "Pick "    # e.g. "Pick 3/19"
MASTER_VALID_PREFIX = "Valid? " # e.g. "Valid? 3/19"

# Teams & Results sheet layout (0-indexed)
TR_ROW_TITLE = 0      # Title row
TR_ROW_DATES = 1      # Round date labels row
TR_ROW_HEADERS = 2    # "Available Teams" / "Losers" header row
TR_DATA_START = 3     # First data row (0-indexed)
TR_COLS_PER_DAY = 3   # Available Teams col, Losers col, blank spacer

# ESPN API
ESPN_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/"
    "basketball/mens-college-basketball/scoreboard"
)

# Cell background colors (Google Sheets API format: 0.0–1.0 RGB floats)
COLOR_WHITE = {"red": 1.0, "green": 1.0, "blue": 1.0}
COLOR_RED = {"red": 0.918, "green": 0.600, "blue": 0.600}     # losing pick
COLOR_YELLOW = {"red": 1.0, "green": 0.949, "blue": 0.800}    # no pick submitted
COLOR_GRAY = {"red": 0.851, "green": 0.851, "blue": 0.851}    # eliminated player row
COLOR_GREEN = {"red": 0.576, "green": 0.769, "blue": 0.490}   # correct pick cell
COLOR_GREEN_ROW = {"red": 0.851, "green": 0.918, "blue": 0.827}  # alive player row (subtle)
COLOR_HEADER_BG = {"red": 0.267, "green": 0.267, "blue": 0.267}  # dark header background
COLOR_HEADER_TEXT = {"red": 1.0, "green": 1.0, "blue": 1.0}      # white header text

# Validation strings used in Master sheet Valid? columns
VALID_CHECK = "✓"
VALID_WARN = "⚠ INVALID"

# Status strings used in Master sheet Eliminated? column
STATUS_ALIVE = "✅ Alive"
STATUS_OUT = "❌ OUT"
