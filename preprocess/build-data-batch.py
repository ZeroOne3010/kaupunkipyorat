#!/usr/bin/env python3
"""Build one monthly JSON per CSV contained in a CSV or ZIP source."""

import argparse
import importlib.util
import json
import shutil
import tempfile
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-data.py")
SPEC = importlib.util.spec_from_file_location("build_data", SCRIPT)
build_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_data)


def csv_sources(source, temporary_directory):
    if not zipfile.is_zipfile(source):
        return [source]

    extracted = []
    with zipfile.ZipFile(source) as archive:
        members = sorted(
            (
                member
                for member in archive.infolist()
                if not member.is_dir() and member.filename.casefold().endswith(".csv")
            ),
            key=lambda member: member.filename,
        )
        if not members:
            raise ValueError("ZIP does not contain a CSV file")
        for index, member in enumerate(members):
            # Copy to our own generated path rather than extracting an untrusted member name.
            destination = temporary_directory / f"{index}.csv"
            with archive.open(member) as input_handle, destination.open("wb") as output_handle:
                shutil.copyfileobj(input_handle, output_handle)
            extracted.append(destination)
    return extracted


def build_all(source, output_directory, output_filename=None):
    output_directory.mkdir(parents=True, exist_ok=True)
    built = []
    months = set()
    with tempfile.TemporaryDirectory() as directory:
        for csv_source in csv_sources(source, Path(directory)):
            result, stats = build_data.build(csv_source)
            month = (result["y"], result["m"])
            if month in months:
                raise ValueError(f"more than one CSV contains month {month[0]:04d}-{month[1]:02d}")
            months.add(month)
            built.append((result, stats))

    if output_filename and len(built) != 1:
        raise ValueError("a custom output filename can only be used when the source contains one CSV")

    outputs = []
    for result, stats in sorted(built, key=lambda item: (item[0]["y"], item[0]["m"])):
        filename = output_filename or f"{result['y']:04d}-{result['m']:02d}.json"
        destination = output_directory / filename
        destination.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
        outputs.append(destination)
        print(
            f"Built {destination}: {stats[1]} valid rides, {stats[2]} skipped rows, "
            f"{stats[3]} OD pairs"
        )
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="a .csv or .zip containing monthly CSV files")
    parser.add_argument("output_directory", type=Path, help="directory for monthly JSON files")
    parser.add_argument("--output-filename", help="custom .json name (only valid for one CSV)")
    args = parser.parse_args()
    try:
        build_all(args.input, args.output_directory, args.output_filename)
    except (OSError, ValueError, build_data.csv.Error, zipfile.BadZipFile) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
