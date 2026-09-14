#!/usr/bin/env python3
"""Download and validate one April--October Open-Meteo ERA5 weather file."""

import argparse
import datetime as dt
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path


ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"
MEASUREMENTS = ("temperature_2m", "precipitation", "wind_speed_10m", "wind_direction_10m")
CITIES = {
    "helsinki": (60.1699, 24.9384),
    "espoo": (60.2055, 24.6559),
}


def requested_dates(year):
    current = dt.date(year, 4, 1)
    end = dt.date(year, 10, 31)
    while current <= end:
        yield current
        current += dt.timedelta(days=1)


def fetch_city(year, coordinates, endpoint=ENDPOINT):
    params = {
        "latitude": coordinates[0], "longitude": coordinates[1],
        "start_date": f"{year}-04-01", "end_date": f"{year}-10-31",
        "hourly": ",".join(MEASUREMENTS), "wind_speed_unit": "ms",
        "timezone": "UTC", "models": "era5",
    }
    url = f"{endpoint}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "kaupunkipyorat-weather-builder/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def clean(value):
    return value if finite_number(value) else None


def aggregate(hours):
    columns = [[row[index] for row in hours if row and row[index] is not None] for index in range(4)]
    temperatures, precipitation, speeds, _directions = columns
    direction_pairs = [(row[3], row[2]) for row in hours if row and row[3] is not None and row[2] is not None]
    mean_direction = None
    if direction_pairs:
        # Weighting by speed prevents a near-calm observation dominating wind direction.
        x = sum(speed * math.sin(math.radians(direction)) for direction, speed in direction_pairs)
        y = sum(speed * math.cos(math.radians(direction)) for direction, speed in direction_pairs)
        if x != 0 or y != 0:
            mean_direction = round(math.degrees(math.atan2(x, y)) % 360)
    return [
        round(sum(temperatures) / len(temperatures), 1) if temperatures else None,
        round(min(temperatures), 1) if temperatures else None,
        round(max(temperatures), 1) if temperatures else None,
        round(sum(precipitation), 1) if precipitation else None,
        round(sum(speeds) / len(speeds), 1) if speeds else None,
        mean_direction,
    ]


def normalize_city(year, response, city, warning_stream=sys.stderr):
    hourly = response.get("hourly") or {}
    times = hourly.get("time") or []
    values = [hourly.get(name) or [] for name in MEASUREMENTS]
    observations = {}
    for index, timestamp in enumerate(times):
        try:
            date_text, hour_text = timestamp.split("T", 1)
            hour = int(hour_text[:2])
            date = dt.date.fromisoformat(date_text)
        except (AttributeError, ValueError):
            continue
        if date.year != year or not 4 <= date.month <= 10 or not 0 <= hour <= 23:
            continue
        row = [clean(column[index]) if index < len(column) else None for column in values]
        observations[(date_text, hour)] = [] if all(value is None for value in row) else row

    days = {}
    month_hours = {f"{month:02d}": [] for month in range(4, 11)}
    label = city.capitalize()
    for date in requested_dates(year):
        date_text = date.isoformat()
        hours = [observations.get((date_text, hour), []) for hour in range(24)]
        coverage = [sum(bool(row) and row[index] is not None for row in hours) for index in range(4)]
        for name, count in zip(MEASUREMENTS, coverage):
            if count != 24:
                print(f"WARNING {label} {date_text}: {name} available for {count}/24 hours", file=warning_stream)
        days[date_text] = {"h": hours, "d": aggregate(hours)}
        month_hours[f"{date.month:02d}"].extend(hours)
    months = {month: aggregate(hours) for month, hours in month_hours.items()}
    return {"days": days, "months": months}


def validate(payload):
    if payload.get("v") != 1:
        raise ValueError("weather version must be 1")
    year = payload.get("year")
    if not isinstance(year, int):
        raise ValueError("year must be an integer")
    cities = payload.get("cities")
    if not isinstance(cities, dict) or set(cities) != set(CITIES):
        raise ValueError("Helsinki and Espoo must be the only cities")
    expected_dates = {date.isoformat() for date in requested_dates(year)}
    for city, city_data in cities.items():
        days = city_data.get("days")
        months = city_data.get("months")
        if not isinstance(days, dict) or set(days) != expected_dates:
            raise ValueError(f"{city} must contain every April--October date")
        if not isinstance(months, dict) or set(months) != {f"{month:02d}" for month in range(4, 11)}:
            raise ValueError(f"{city} has invalid months")
        for date_text, day in days.items():
            if not 4 <= dt.date.fromisoformat(date_text).month <= 10:
                raise ValueError(f"date outside season: {date_text}")
            hours = day.get("h")
            if not isinstance(hours, list) or len(hours) != 24:
                raise ValueError(f"{city} {date_text} must have 24 hours")
            for row in hours:
                if not isinstance(row, list) or (row and len(row) != 4):
                    raise ValueError(f"invalid hourly tuple in {city} {date_text}")
                if any(value is not None and not finite_number(value) for value in row):
                    raise ValueError(f"invalid hourly value in {city} {date_text}")
            validate_aggregate(day.get("d"), f"{city} {date_text}")
        for month, row in months.items():
            validate_aggregate(row, f"{city} month {month}")


def validate_aggregate(row, location):
    if not isinstance(row, list) or len(row) != 6:
        raise ValueError(f"invalid aggregate tuple in {location}")
    if any(value is not None and not finite_number(value) for value in row):
        raise ValueError(f"invalid aggregate value in {location}")


def build(year, fetcher=fetch_city, warning_stream=sys.stderr):
    return {"v": 1, "year": year, "cities": {
        city: normalize_city(year, fetcher(year, coordinates), city, warning_stream)
        for city, coordinates in CITIES.items()
    }}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("year", type=int)
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()
    if not 2016 <= args.year <= dt.date.today().year:
        parser.error(f"year must be between 2016 and {dt.date.today().year}")
    output = args.output or Path("weather") / f"{args.year}.json"
    payload = build(args.year)
    validate(payload)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote and validated {output}")


if __name__ == "__main__":
    main()
