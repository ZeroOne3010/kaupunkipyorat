#!/usr/bin/env python3
"""Build the static site's month index from JSON files in its data directory."""

import argparse
import json
from pathlib import Path


def build_index(data_directory):
    months = []
    for path in sorted(data_directory.glob("*.json")):
        if path.name in {"months.json", "sample-month.json"}:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            year, month = int(data["y"]), int(data["m"])
            if data.get("v") != 1 or not 1 <= month <= 12:
                raise ValueError("unsupported data format")
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            raise ValueError(f"cannot index {path}: {error}") from error
        months.append({"file": path.name, "year": year, "month": month})
    return sorted(months, key=lambda item: (item["year"], item["month"], item["file"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_directory", type=Path)
    args = parser.parse_args()
    try:
        months = build_index(args.data_directory)
        if not months:
            raise ValueError(f"no monthly JSON files found in {args.data_directory}")
        output = args.data_directory / "months.json"
        output.write_text(json.dumps(months, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"Indexed {len(months)} month(s) in {output}")
    except (OSError, ValueError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
