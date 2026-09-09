#!/usr/bin/env python3
"""Extract five useful individual-ride records from one monthly HSL CSV."""

import argparse
import csv
import importlib.util
import json
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("build-data.py")
SPEC = importlib.util.spec_from_file_location("build_data", SCRIPT)
build_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_data)


def build(source):
    handle, archive = build_data.open_csv(source)
    records = {}
    scores = {}
    month = None
    try:
        sample = handle.read(8192)
        handle.seek(0)
        reader = csv.DictReader(handle, dialect=csv.Sniffer().sniff(sample, delimiters=",;\t"))
        columns = build_data.choose_columns(reader.fieldnames)
        if not columns["duration"] or not columns["distance"]:
            raise ValueError("duration and distance columns are required for records")
        for row in reader:
            try:
                departure = build_data.parse_time(row[columns["departure"]])
                current_month = (departure.year, departure.month)
                if month is None:
                    month = current_month
                elif current_month != month:
                    continue
                ride = {
                    "origin": build_data.integer(row[columns["origin"]], "origin station ID"),
                    "destination": build_data.integer(row[columns["destination"]], "destination station ID"),
                    "durationS": build_data.integer(row[columns["duration"]], "duration"),
                    "distanceM": build_data.integer(row[columns["distance"]], "distance"),
                }
                # Ignore zero/tiny administrative trips. A 40 km/h ceiling excludes
                # common dock/data errors while retaining unusually quick bike rides.
                meaningful = ride["distanceM"] >= 500 and ride["durationS"] >= 60
                speed = ride["distanceM"] / ride["durationS"] * 3.6 if ride["durationS"] else 0
                if meaningful and speed <= 40:
                    keep(records, scores, "fastest", ride, speed, greater=True)
                if meaningful:
                    keep(records, scores, "longestDistance", ride, ride["distanceM"], greater=True)
                    keep(records, scores, "longestDuration", ride, ride["durationS"], greater=True)
                    keep(records, scores, "shortestDuration", ride, ride["durationS"], greater=False)
                    if ride["origin"] == ride["destination"]:
                        keep(records, scores, "longestRoundTrip", ride, ride["distanceM"], greater=True)
            except (ValueError, TypeError, KeyError):
                continue
    finally:
        handle.close()
        if archive:
            archive.close()
    if month is None:
        raise ValueError("no valid rides found")
    return {"v": 1, "y": month[0], "m": month[1], **records}


def keep(records, scores, key, ride, score, greater):
    if key not in scores or (score > scores[key] if greater else score < scores[key]):
        records[key] = ride.copy()
        scores[key] = score


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        result = build(args.input)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
