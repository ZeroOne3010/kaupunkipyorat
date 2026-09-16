#!/usr/bin/env python3
"""Precalculate per-station rain sensitivity from a complete bike season."""

import argparse
import json
import math
import re
from pathlib import Path


SEASON_MONTHS = range(4, 11)
MINIMUM_DAYS = 10
RAIN_THRESHOLD_MM = 0.5
CITY_LONGITUDE_BOUNDARY = 24.8474184


def load_stations(path):
    source = path.read_text(encoding="utf-8")
    match = re.search(r"\bconst\s+STATIONS\s*=\s*(\[.*\])\s*;\s*$", source, re.DOTALL)
    if not match:
        raise ValueError(f"cannot find STATIONS array in {path}")
    stations = json.loads(match.group(1))
    if not all(len(station) >= 4 and isinstance(station[0], int) for station in stations):
        raise ValueError(f"invalid station data in {path}")
    return stations


def percentile(values, fraction):
    if not values:
        return 1
    ordered = sorted(values)
    return ordered[math.floor((len(ordered) - 1) * fraction)] or 1


def build(year, data_directory, weather_path, stations):
    weather = json.loads(weather_path.read_text(encoding="utf-8"))
    if weather.get("v") != 1 or weather.get("year") != year:
        raise ValueError(f"{weather_path} is not weather data for {year}")

    station_details = {station[0]: station for station in stations}
    samples = {station_id: {"dryCount": 0, "dryRides": 0, "rainyCount": 0, "rainyRides": 0}
               for station_id in station_details}
    for month in SEASON_MONTHS:
        path = data_directory / f"{year}-{month:02d}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("v") != 1 or payload.get("y") != year or payload.get("m") != month:
            raise ValueError(f"{path} is not aggregate data for {year}-{month:02d}")
        for day_index, tuples in enumerate(payload.get("d", []), 1):
            rides = {station_id: 0 for station_id in station_details}
            for origin, destination, count, *_ in tuples:
                if origin in rides:
                    rides[origin] += count
                if destination != origin and destination in rides:
                    rides[destination] += count
            date = f"{year}-{month:02d}-{day_index:02d}"
            for station_id, station in station_details.items():
                city = "espoo" if station[3] < CITY_LONGITUDE_BOUNDARY else "helsinki"
                daily = weather.get("cities", {}).get(city, {}).get("days", {}).get(date, {}).get("d", [])
                precipitation = daily[3] if len(daily) > 3 else None
                if not isinstance(precipitation, (int, float)) or not math.isfinite(precipitation):
                    continue
                group = "rainy" if precipitation > RAIN_THRESHOLD_MM else "dry"
                samples[station_id][f"{group}Count"] += 1
                samples[station_id][f"{group}Rides"] += rides[station_id]

    results = {}
    available_values = []
    for station_id, sample in samples.items():
        dry_average = sample["dryRides"] / sample["dryCount"] if sample["dryCount"] else None
        rainy_average = sample["rainyRides"] / sample["rainyCount"] if sample["rainyCount"] else None
        available = (sample["dryCount"] >= MINIMUM_DAYS and sample["rainyCount"] >= MINIMUM_DAYS
                     and dry_average is not None and dry_average > 0)
        value = (rainy_average - dry_average) / dry_average * 100 if available else None
        result = {"dryCount": sample["dryCount"], "rainyCount": sample["rainyCount"],
                  "dryAverage": dry_average, "rainyAverage": rainy_average, "value": value}
        results[str(station_id)] = result
        if available:
            available_values.append(abs(value))

    domain = percentile(available_values, 0.9)
    for result in results.values():
        value = result["value"]
        result["normalized"] = max(-1, min(1, value / domain)) if value is not None else None
    return {"v": 1, "year": year, "domain": domain, "stations": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("year", type=int)
    parser.add_argument("output", type=Path)
    parser.add_argument("--data", type=Path, default=Path("site/data"))
    parser.add_argument("--weather", type=Path)
    parser.add_argument("--stations", type=Path, default=Path("site/stations.js"))
    args = parser.parse_args()
    weather_path = args.weather or Path("site/weather") / f"{args.year}.json"
    try:
        payload = build(args.year, args.data, weather_path, load_stations(args.stations))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
        print(f"Wrote rain sensitivity for {len(payload['stations'])} stations to {args.output}")
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
