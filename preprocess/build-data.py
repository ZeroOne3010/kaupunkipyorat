#!/usr/bin/env python3
"""Turn one HSL city-bike trip CSV (or ZIP containing one) into compact JSON."""

import argparse
import calendar
import csv
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ALIASES = {
    "departure": ("departure", "departuretime", "lahtoaika", "lahtopvm"),
    "origin": ("departurestationid", "originstationid", "lahtoasemanid", "lahtoasematunnus", "lahtoasemaid"),
    "destination": ("returnstationid", "destinationstationid", "palautusasemanid", "palautusasemantunnus", "palautusasemaid"),
    "duration": (
        "durationsec",
        "durationseconds",
        "duration",
        "kestosec",
        "kestosekuntia",
        "matkankestosek",
        "matkankestos",
    ),
    "distance": ("covereddistancem", "distancem", "distance", "etaisyysm", "matkam", "matkanpituusm"),
}


def normalized(value):
    value = value.casefold().replace("ä", "a").replace("ö", "o")
    return re.sub(r"[^a-z0-9]", "", value)


def choose_columns(fieldnames):
    columns = {normalized(name): name for name in fieldnames or []}
    found = {}
    for key, aliases in ALIASES.items():
        found[key] = next((columns[a] for a in aliases if a in columns), None)
    missing = [key for key in ("departure", "origin", "destination") if not found[key]]
    if missing:
        raise ValueError(
            f"missing required columns {', '.join(missing)}; CSV headers: {', '.join(fieldnames or [])}"
        )
    return found


def parse_time(value):
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                pass
    raise ValueError(f"invalid departure time {value!r}")


def integer(value, label, optional=False):
    value = (value or "").strip().replace(",", ".")
    if optional and not value:
        return 0
    number = float(value)
    if not number.is_integer() or number < 0:
        raise ValueError(f"invalid {label} {value!r}")
    return int(number)


def rounded_distance(value, optional=False):
    value = (value or "").strip().replace(",", ".")
    if optional and not value:
        return 0
    number = float(value)
    if number < 0:
        raise ValueError(f"invalid distance {value!r}")
    try:
        return round(number)
    except (OverflowError, ValueError):
        raise ValueError(f"invalid distance {value!r}") from None


def open_csv(path):
    if zipfile.is_zipfile(path):
        archive = zipfile.ZipFile(path)
        names = sorted(name for name in archive.namelist() if name.casefold().endswith(".csv"))
        if not names:
            raise ValueError("ZIP does not contain a CSV file")
        if len(names) > 1:
            print(f"warning: ZIP has multiple CSV files; using {names[0]!r}", file=sys.stderr)
        return io.TextIOWrapper(archive.open(names[0]), encoding="utf-8-sig", newline=""), archive
    return path.open(encoding="utf-8-sig", newline=""), None


def add(bucket, key, duration, distance):
    values = bucket[key]
    values[0] += 1
    values[1] += duration
    values[2] += distance


def tuples(bucket):
    return [[origin, destination, *bucket[(origin, destination)]] for origin, destination in sorted(bucket)]


def build(source):
    handle, archive = open_csv(source)
    read = valid = skipped = 0
    month = None
    total = defaultdict(lambda: [0, 0, 0])
    days = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    hours = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
    try:
        sample = handle.read(8192)
        handle.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;	")
        reader = csv.DictReader(handle, dialect=dialect)
        columns = choose_columns(reader.fieldnames)
        for line, row in enumerate(reader, 2):
            read += 1
            try:
                departure = parse_time(row[columns["departure"]])
                current_month = (departure.year, departure.month)
                origin = integer(row[columns["origin"]], "origin station ID")
                destination = integer(row[columns["destination"]], "destination station ID")
                duration = integer(row.get(columns["duration"]) if columns["duration"] else "", "duration", True)
                distance = rounded_distance(row.get(columns["distance"]) if columns["distance"] else "", True)
                if month is None:
                    month = current_month
                elif current_month != month:
                    raise ValueError(f"date is outside detected {month[0]:04d}-{month[1]:02d}")
                key = (origin, destination)
                add(total, key, duration, distance)
                add(days[departure.day - 1], key, duration, distance)
                add(hours[(departure.day - 1) * 24 + departure.hour], key, duration, distance)
                valid += 1
            except (ValueError, TypeError, KeyError) as error:
                skipped += 1
                print(f"warning: row {line}: {error}", file=sys.stderr)
    finally:
        handle.close()
        if archive:
            archive.close()
    if month is None:
        raise ValueError("no valid rides found")
    day_count = calendar.monthrange(*month)[1]
    return {
        "v": 1,
        "y": month[0],
        "m": month[1],
        "total": tuples(total),
        "d": [tuples(days[index]) for index in range(day_count)],
        "h": [tuples(hours[index]) for index in range(day_count * 24)],
    }, (read, valid, skipped, len(total))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="monthly .csv or .zip")
    parser.add_argument("output", type=Path, help="output .json")
    args = parser.parse_args()
    try:
        result, stats = build(args.input)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile) as error:
        parser.exit(1, f"error: {error}\n")
    read, valid, skipped, pairs = stats
    print(f"Rows read: {read}")
    print(f"Valid rides: {valid}")
    print(f"Skipped rows: {skipped}")
    print(f"OD pairs: {pairs}")
    print(f"Detected month: {result['y']:04d}-{result['m']:02d}")
    print(f"Output size: {args.output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
