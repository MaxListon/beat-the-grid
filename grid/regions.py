"""The 34 balancing authorities in the contest, with local time zone and weather points.

Selection rule (applied in data, see grid/quality.py): mean demand >= 1,500 MW and >= 90% of
hours since 2023 with both valid demand and an official day-ahead forecast. WACM (83% coverage)
and SWPW (started April 2026) fail it.

Weather points are the main load centres in each territory; weights are rough metro-population
shares, used to build one population-weighted weather series per region.
"""

REGIONS: dict[str, dict] = {
    "PJM":  {"name": "PJM Interconnection", "short": "Mid-Atlantic & Chicago", "tz": "America/New_York", "points": [
        ("Chicago", 41.88, -87.63, 9), ("Philadelphia", 39.95, -75.17, 6), ("Washington", 38.90, -77.04, 6),
        ("Newark", 40.74, -74.17, 4), ("Baltimore", 39.29, -76.61, 3), ("Pittsburgh", 40.44, -79.99, 2.4),
        ("Columbus", 39.96, -83.00, 2.1), ("Cleveland", 41.50, -81.69, 2), ("Richmond", 37.54, -77.44, 1.3)]},
    "MISO": {"name": "Midcontinent ISO", "short": "Midwest & Mid-South", "tz": "America/Chicago", "points": [
        ("Detroit", 42.33, -83.05, 4.3), ("Minneapolis", 44.98, -93.27, 3.7), ("St. Louis", 38.63, -90.20, 2.8),
        ("Indianapolis", 39.77, -86.16, 2.1), ("Milwaukee", 43.04, -87.91, 1.6), ("New Orleans", 29.95, -90.07, 1.3),
        ("Grand Rapids", 42.96, -85.67, 1.1), ("Baton Rouge", 30.45, -91.19, 0.9), ("Little Rock", 34.75, -92.29, 0.75),
        ("Des Moines", 41.59, -93.62, 0.7)]},
    "ERCO": {"name": "ERCOT", "short": "Texas", "tz": "America/Chicago", "points": [
        ("Dallas", 32.78, -96.80, 7.9), ("Houston", 29.76, -95.37, 7.3), ("San Antonio", 29.42, -98.49, 2.6),
        ("Austin", 30.27, -97.74, 2.4)]},
    "SWPP": {"name": "Southwest Power Pool", "short": "Great Plains", "tz": "America/Chicago", "points": [
        ("Kansas City", 39.10, -94.58, 2.2), ("Oklahoma City", 35.47, -97.52, 1.4), ("Tulsa", 36.15, -95.99, 1.0),
        ("Omaha", 41.26, -95.93, 1.0), ("Wichita", 37.69, -97.34, 0.65), ("Shreveport", 32.53, -93.75, 0.4),
        ("Amarillo", 35.22, -101.83, 0.27)]},
    "SOCO": {"name": "Southern Company", "short": "Georgia & Alabama", "tz": "America/New_York", "points": [
        ("Atlanta", 33.75, -84.39, 6.2), ("Birmingham", 33.52, -86.80, 1.1), ("Montgomery", 32.37, -86.30, 0.4),
        ("Savannah", 32.08, -81.09, 0.4), ("Mobile", 30.69, -88.04, 0.4)]},
    "CISO": {"name": "California ISO", "short": "California", "tz": "America/Los_Angeles", "points": [
        ("Los Angeles", 34.05, -118.24, 6), ("San Francisco", 37.77, -122.42, 4.7), ("Riverside", 33.95, -117.40, 4.6),
        ("San Diego", 32.72, -117.16, 3.3), ("San Jose", 37.34, -121.89, 2), ("Fresno", 36.74, -119.79, 1),
        ("Sacramento", 38.58, -121.49, 1)]},
    "TVA":  {"name": "Tennessee Valley Authority", "short": "Tennessee Valley", "tz": "America/Chicago", "points": [
        ("Nashville", 36.16, -86.78, 2), ("Memphis", 35.15, -90.05, 1.3), ("Knoxville", 35.96, -83.92, 0.9),
        ("Chattanooga", 35.05, -85.31, 0.6), ("Huntsville", 34.73, -86.59, 0.5)]},
    "NYIS": {"name": "New York ISO", "short": "New York", "tz": "America/New_York", "points": [
        ("New York City", 40.71, -74.01, 8.5), ("Hempstead", 40.71, -73.62, 2.8), ("Buffalo", 42.89, -78.88, 1.1),
        ("Rochester", 43.16, -77.61, 1), ("Albany", 42.65, -73.76, 0.9)]},
    "FPL":  {"name": "Florida Power & Light", "short": "South & East Florida", "tz": "America/New_York", "points": [
        ("Miami", 25.76, -80.19, 2.7), ("Fort Lauderdale", 26.12, -80.14, 1.9), ("West Palm Beach", 26.72, -80.05, 1.5),
        ("Fort Myers", 26.64, -81.87, 0.8), ("Daytona Beach", 29.21, -81.02, 0.6), ("Pensacola", 30.42, -87.22, 0.5)]},
    "ISNE": {"name": "ISO New England", "short": "New England", "tz": "America/New_York", "points": [
        ("Boston", 42.36, -71.06, 4.9), ("Providence", 41.82, -71.41, 1.6), ("Hartford", 41.76, -72.67, 1.2),
        ("Worcester", 42.26, -71.80, 0.9), ("Portland ME", 43.66, -70.26, 0.5), ("Manchester NH", 42.99, -71.45, 0.4)]},
    "DUK":  {"name": "Duke Energy Carolinas", "short": "Western Carolinas", "tz": "America/New_York", "points": [
        ("Charlotte", 35.23, -80.84, 2.7), ("Greenville SC", 34.85, -82.40, 0.9), ("Greensboro", 36.07, -79.79, 0.8),
        ("Durham", 35.99, -78.90, 0.6)]},
    "CPLE": {"name": "Duke Energy Progress East", "short": "Eastern Carolinas", "tz": "America/New_York", "points": [
        ("Raleigh", 35.78, -78.64, 1.4), ("Fayetteville NC", 35.05, -78.88, 0.4), ("Wilmington NC", 34.23, -77.94, 0.3),
        ("Florence SC", 34.20, -79.76, 0.2)]},
    "BPAT": {"name": "Bonneville Power Administration", "short": "Pacific Northwest", "tz": "America/Los_Angeles", "points": [
        ("Portland", 45.52, -122.68, 1), ("Everett", 47.98, -122.20, 0.6), ("Spokane", 47.66, -117.43, 0.5),
        ("Tri-Cities", 46.23, -119.10, 0.3), ("Eugene", 44.05, -123.09, 0.3)]},
    "FPC":  {"name": "Duke Energy Florida", "short": "Central & West Florida", "tz": "America/New_York", "points": [
        ("Orlando", 28.54, -81.38, 1), ("St. Petersburg", 27.77, -82.64, 1), ("Clearwater", 27.97, -82.80, 0.5),
        ("Ocala", 29.19, -82.14, 0.3)]},
    "PACE": {"name": "PacifiCorp East", "short": "Utah & Wyoming", "tz": "America/Denver", "points": [
        ("Salt Lake City", 40.76, -111.89, 1.2), ("Provo", 40.23, -111.66, 0.6), ("Ogden", 41.22, -111.97, 0.6),
        ("Idaho Falls", 43.49, -112.03, 0.15), ("Casper", 42.87, -106.31, 0.1)]},
    "PSCO": {"name": "Public Service Co. of Colorado", "short": "Colorado", "tz": "America/Denver", "points": [
        ("Denver", 39.74, -104.99, 2.9), ("Boulder", 40.01, -105.27, 0.3), ("Grand Junction", 39.06, -108.55, 0.15)]},
    "NEVP": {"name": "NV Energy", "short": "Nevada", "tz": "America/Los_Angeles", "points": [
        ("Las Vegas", 36.17, -115.14, 1)]},
    "LGEE": {"name": "LG&E and KU", "short": "Kentucky", "tz": "America/New_York", "points": [
        ("Louisville", 38.25, -85.76, 1.3), ("Lexington", 38.04, -84.50, 0.5)]},
    "AZPS": {"name": "Arizona Public Service", "short": "Arizona (APS)", "tz": "America/Phoenix", "points": [
        ("Phoenix", 33.45, -112.07, 1.5), ("Yuma", 32.69, -114.63, 0.2), ("Flagstaff", 35.20, -111.65, 0.15)]},
    "SRP":  {"name": "Salt River Project", "short": "Phoenix East Valley", "tz": "America/Phoenix", "points": [
        ("Mesa", 33.42, -111.83, 1)]},
    "SC":   {"name": "Santee Cooper", "short": "Coastal South Carolina", "tz": "America/New_York", "points": [
        ("Charleston", 32.78, -79.93, 0.5), ("Myrtle Beach", 33.69, -78.89, 0.3), ("Moncks Corner", 33.20, -80.01, 0.2)]},
    "SCEG": {"name": "Dominion Energy South Carolina", "short": "Central South Carolina", "tz": "America/New_York", "points": [
        ("Columbia SC", 34.00, -81.03, 0.8), ("Charleston", 32.78, -79.93, 0.6)]},
    "PSEI": {"name": "Puget Sound Energy", "short": "Puget Sound", "tz": "America/Los_Angeles", "points": [
        ("Bellevue", 47.61, -122.20, 1), ("Olympia", 47.04, -122.90, 0.3), ("Bellingham", 48.75, -122.48, 0.2)]},
    "LDWP": {"name": "LA Dept. of Water & Power", "short": "Los Angeles", "tz": "America/Los_Angeles", "points": [
        ("Los Angeles", 34.05, -118.24, 1), ("Van Nuys", 34.19, -118.45, 0.6)]},
    "PGE":  {"name": "Portland General Electric", "short": "Portland & Salem", "tz": "America/Los_Angeles", "points": [
        ("Portland", 45.52, -122.68, 1), ("Salem", 44.94, -123.04, 0.3)]},
    "TEC":  {"name": "Tampa Electric", "short": "Tampa Bay", "tz": "America/New_York", "points": [
        ("Tampa", 27.95, -82.46, 1)]},
    "AECI": {"name": "Associated Electric Coop.", "short": "Missouri", "tz": "America/Chicago", "points": [
        ("Springfield MO", 37.21, -93.29, 0.4), ("Columbia MO", 38.95, -92.33, 0.2)]},
    "PACW": {"name": "PacifiCorp West", "short": "Oregon & Washington", "tz": "America/Los_Angeles", "points": [
        ("Portland", 45.52, -122.68, 0.6), ("Medford", 42.33, -122.87, 0.3), ("Yakima", 46.60, -120.51, 0.2),
        ("Bend", 44.06, -121.32, 0.2)]},
    "FMPP": {"name": "Florida Municipal Power Pool", "short": "Central Florida", "tz": "America/New_York", "points": [
        ("Orlando", 28.54, -81.38, 1), ("Lakeland", 28.04, -81.95, 0.3)]},
    "IPCO": {"name": "Idaho Power", "short": "Idaho", "tz": "America/Boise", "points": [
        ("Boise", 43.62, -116.20, 1), ("Twin Falls", 42.56, -114.46, 0.2)]},
    "BANC": {"name": "Balancing Authority of N. California", "short": "Sacramento", "tz": "America/Los_Angeles", "points": [
        ("Sacramento", 38.58, -121.49, 1), ("Redding", 40.59, -122.39, 0.1)]},
    "PNM":  {"name": "Public Service Co. of New Mexico", "short": "New Mexico", "tz": "America/Denver", "points": [
        ("Albuquerque", 35.08, -106.65, 1), ("Santa Fe", 35.69, -105.94, 0.2)]},
    "TEPC": {"name": "Tucson Electric Power", "short": "Tucson", "tz": "America/Phoenix", "points": [
        ("Tucson", 32.22, -110.97, 1)]},
    "JEA":  {"name": "JEA", "short": "Jacksonville", "tz": "America/New_York", "points": [
        ("Jacksonville", 30.33, -81.66, 1)]},
}


MAX_POINTS = 3   # the 3 largest load centres per region carry most of the weather signal


def region_points(ba: str) -> list[tuple]:
    return sorted(REGIONS[ba]["points"], key=lambda p: -p[3])[:MAX_POINTS]


def unique_points() -> dict[str, tuple[float, float]]:
    """Each distinct weather location once (several regions share cities)."""
    pts: dict[str, tuple[float, float]] = {}
    for ba in REGIONS:
        for name, lat, lon, _ in region_points(ba):
            pts.setdefault(name, (lat, lon))
    return pts
