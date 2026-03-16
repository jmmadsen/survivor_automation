import difflib
import logging
import requests

from src.config import ESPN_SCOREBOARD_URL
from src.models import GameResult

logger = logging.getLogger(__name__)

# Mascot words are derived from ESPN data on first use (see _get_mascot_words).
# None means "not yet loaded"; empty set means "loaded but ESPN returned nothing".
_mascot_words_cache: set[str] | None = None


def _get_mascot_words() -> set[str]:
    """
    Return the mascot word set for the current tournament, derived from ESPN's own data.

    ESPN provides both team["location"] (e.g. "Houston") and team["displayName"]
    (e.g. "Houston Cougars"). The mascot is whatever follows the location string.
    Fetching the first two game days covers all 64 first-round teams.

    Result is cached for the lifetime of the process. Falls back to an empty set
    if ESPN is unreachable so the difflib fallback in normalize_team_name still runs.
    """
    global _mascot_words_cache
    if _mascot_words_cache is not None:
        return _mascot_words_cache

    from src.config import GAME_DAY_TO_ESPN_DATE, GAME_DAYS  # avoid circular import at module level
    mascots: set[str] = set()
    # 3/19 + 3/20 together cover all 64 Round-of-64 teams (32 games per day)
    for game_day in GAME_DAYS[:2]:
        espn_date = GAME_DAY_TO_ESPN_DATE[game_day]
        try:
            mascots.update(_fetch_mascot_words_for_date(espn_date))
        except Exception as e:
            logger.debug(f"Could not fetch mascot words for {game_day} ({espn_date}): {e}")

    _mascot_words_cache = mascots
    if mascots:
        logger.debug(f"Loaded {len(mascots)} mascot words from ESPN: {sorted(mascots)}")
    else:
        logger.warning("Could not load mascot words from ESPN — fuzzy name matching may be less accurate")
    return _mascot_words_cache


def _fetch_mascot_words_for_date(espn_date: str) -> set[str]:
    """
    Fetch one date from ESPN and extract mascot words by diffing displayName vs location.
    E.g. displayName='Houston Cougars', location='Houston' → mascot word = 'Cougars'
    """
    url = f"{ESPN_SCOREBOARD_URL}?dates={espn_date}&groups=100&seasontype=3&limit=64"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    mascots: set[str] = set()
    for event in data.get("events", []):
        try:
            competitors = event["competitions"][0]["competitors"]
            for c in competitors:
                team = c["team"]
                location = team.get("location", "").strip()
                display = team.get("displayName", "").strip()
                if location and display and display.startswith(location):
                    mascot = display[len(location):].strip()
                    if mascot:
                        mascots.add(mascot)
        except (KeyError, IndexError):
            continue
    return mascots


def fetch_games_for_day(game_day: str, espn_date: str) -> list[GameResult]:
    """Fetch all NCAA Men's Tournament games for a date from ESPN. Returns GameResult list."""
    # seasontype=3 = postseason only (excludes regular season and NIT on same dates)
    # groups=100 = NCAA D1 Men's Basketball
    # limit=64 = enough to capture a full first-round day
    url = f"{ESPN_SCOREBOARD_URL}?dates={espn_date}&groups=100&seasontype=3&limit=64"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"ESPN API request failed for {game_day} ({espn_date}): {e}") from e

    events = data.get("events", [])
    if not events:
        logger.warning(f"No events found for {game_day} ({espn_date}) — tournament may not have started")
        return []

    # Filter to only genuine NCAA Tournament games (exclude NIT, CBI, etc.)
    events = [e for e in events if _is_ncaa_tournament_event(e)]
    if not events:
        logger.warning(f"No NCAA Tournament games found for {game_day} — check date or seasontype filter")
        return []

    results = []
    for event in events:
        result = _parse_event(event, game_day)
        if result is not None:
            results.append(result)

    final_count = sum(1 for r in results if r.is_final)
    logger.info(f"Fetched {len(results)} games for {game_day}: {final_count} final, {len(results) - final_count} pending")
    return results


def _is_ncaa_tournament_event(event: dict) -> bool:
    """Return True if the ESPN event is an NCAA Men's Basketball Tournament game."""
    try:
        competition = event["competitions"][0]
        notes = competition.get("notes", [])
        for note in notes:
            headline = note.get("headline", "").lower()
            if "ncaa" in headline or "tournament" in headline or "men's" in headline:
                return True
        # Fallback: check the season slug or tournament flag on the competition
        if competition.get("tournament"):
            return True
        # If no notes at all and we're using seasontype=3, trust the filter
        if not notes:
            return True
    except (KeyError, IndexError):
        pass
    return True  # Default to include; the seasontype=3 filter is the primary guard


def _parse_event(event: dict, game_day: str) -> GameResult | None:
    try:
        competition = event["competitions"][0]
        status_name = competition["status"]["type"]["name"]
        is_final = (status_name == "STATUS_FINAL")
        competitors = competition["competitors"]

        winner_name = loser_name = ""
        winner_score = loser_score = 0

        for c in competitors:
            # Use team["location"] for the school name without mascot (e.g. "Houston" not "Houston Cougars")
            team_name = c["team"]["location"]
            score = int(c.get("score", 0) or 0)
            if c.get("winner"):
                winner_name = team_name
                winner_score = score
            else:
                loser_name = team_name
                loser_score = score

        display_name_map = {c["team"]["location"]: c["team"]["displayName"] for c in competitors}
        logger.debug(
            f"  Parsed: {display_name_map.get(winner_name, winner_name)} {winner_score} - "
            f"{loser_score} {display_name_map.get(loser_name, loser_name)} "
            f"({'FINAL' if is_final else status_name})"
        )

        return GameResult(
            game_day=game_day,
            winner=winner_name,
            loser=loser_name,
            winner_score=winner_score,
            loser_score=loser_score,
            is_final=is_final,
            status=status_name,
        )
    except (KeyError, IndexError, TypeError) as e:
        logger.warning(f"Could not parse ESPN event '{event.get('name', '?')}': {e}")
        return None


def fetch_teams_for_day(game_day: str, espn_date: str) -> list[str]:
    """
    Fetch all team school names (no mascot) playing on a given tournament day.
    Returns alphabetically sorted list of team location names (e.g. ['Auburn', 'Duke', 'Houston'...]).
    """
    url = f"{ESPN_SCOREBOARD_URL}?dates={espn_date}&groups=100&seasontype=3&limit=64"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"ESPN API request failed for {game_day} ({espn_date}): {e}") from e

    events = data.get("events", [])
    events = [e for e in events if _is_ncaa_tournament_event(e)]

    teams: set[str] = set()
    for event in events:
        try:
            competitors = event["competitions"][0]["competitors"]
            for c in competitors:
                location = c["team"]["location"].strip()
                if location and location.upper() != "TBD":
                    teams.add(location)
        except (KeyError, IndexError):
            continue

    result = sorted(teams)
    logger.info(f"Found {len(result)} teams playing on {game_day}: {result}")
    return result


def normalize_team_name(api_name: str, sheet_teams: list[str]) -> str:
    """
    Fuzzy-match an ESPN team displayName against the canonical names in the sheet.

    Strategy:
    1. Exact match
    2. Strip known mascot words and retry exact match
    3. difflib close match (cutoff 0.7)
    4. Raise ValueError if no match found (caller logs it)
    """
    if not api_name:
        raise ValueError("Empty team name from ESPN API")

    # 1. Exact match
    if api_name in sheet_teams:
        return api_name

    # 2. Strip mascot words — try removing 1-2 word suffixes
    stripped = _strip_mascot(api_name)
    if stripped != api_name and stripped in sheet_teams:
        logger.debug(f"Matched '{api_name}' → '{stripped}' (mascot strip)")
        return stripped

    # Also try matching stripped api_name against stripped sheet names
    stripped_sheet_map = {_strip_mascot(t): t for t in sheet_teams}
    if stripped in stripped_sheet_map:
        matched = stripped_sheet_map[stripped]
        logger.debug(f"Matched '{api_name}' → '{matched}' (both stripped)")
        return matched

    # 3. difflib fuzzy match on original names
    candidates = sheet_teams + list(stripped_sheet_map.keys())
    close = difflib.get_close_matches(api_name, candidates, n=1, cutoff=0.7)
    if close:
        match = close[0]
        # Resolve stripped name back to original
        if match in stripped_sheet_map:
            match = stripped_sheet_map[match]
        logger.debug(f"Fuzzy matched '{api_name}' → '{match}'")
        return match

    # Also try fuzzy on stripped api_name
    close2 = difflib.get_close_matches(stripped, candidates, n=1, cutoff=0.7)
    if close2:
        match = close2[0]
        if match in stripped_sheet_map:
            match = stripped_sheet_map[match]
        logger.debug(f"Fuzzy matched (stripped) '{api_name}' → '{match}'")
        return match

    raise ValueError(
        f"Cannot match ESPN name '{api_name}' (stripped: '{stripped}') to sheet teams.\n"
        f"Available: {sheet_teams}"
    )


def _strip_mascot(name: str) -> str:
    """Remove trailing mascot word(s) from a team name using the ESPN-derived mascot set."""
    mascot_words = _get_mascot_words()
    parts = name.split()
    for n_words in range(1, 3):
        if len(parts) <= n_words:
            break
        suffix = " ".join(parts[-n_words:])
        if suffix in mascot_words:
            return " ".join(parts[:-n_words])
    return name
