#!/usr/bin/env python3
"""Build compact, directed bicycle routes for selected city-bike stations."""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_ENDPOINT = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1"
QUERY = """query BicycleRoute($from: PlanCoordinateInput!, $to: PlanCoordinateInput!) {
  planConnection(
    origin: {location: {coordinate: $from}}
    destination: {location: {coordinate: $to}}
    first: 1
    modes: {direct: [BICYCLE]}
  ) {
    edges { node { legs { distance legGeometry { points } } } }
  }
}"""


def load_stations(path):
    """Read the array from the generated stations.js while preserving its order."""
    source = path.read_text(encoding="utf-8")
    match = re.search(r"const\s+STATIONS\s*=\s*(\[.*\])\s*;\s*$", source, re.S)
    if not match:
        raise ValueError(f"could not find STATIONS array in {path}")
    stations = json.loads(match.group(1))
    if not all(isinstance(row, list) and len(row) >= 4 for row in stations):
        raise ValueError("invalid station data")
    return stations


def required_routes(data_directory, station_ids):
    """Find observed directed OD pairs in every aggregate month."""
    known = set(station_ids)
    routes = {station_id: set() for station_id in station_ids}
    files = sorted(path for path in data_directory.glob("*.json") if path.name != "months.json")
    if not files:
        raise ValueError(f"no aggregate JSON files found in {data_directory}")
    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload.get("total", []):
            if len(row) >= 3 and row[2] > 0 and row[0] in known and row[1] in known and row[0] != row[1]:
                routes[row[0]].add(row[1])
    return routes


def parse_route(payload):
    if payload.get("errors"):
        raise ValueError("; ".join(error.get("message", str(error)) for error in payload["errors"]))
    edges = payload.get("data", {}).get("planConnection", {}).get("edges", [])
    if not edges:
        raise ValueError("no bicycle itinerary returned")
    legs = edges[0].get("node", {}).get("legs", [])
    points = [leg.get("legGeometry", {}).get("points") for leg in legs]
    if len(legs) != 1 or not points[0]:
        raise ValueError("expected one direct bicycle leg with geometry")
    return {"p": points[0], "d": round(float(legs[0]["distance"]))}


def request_route(endpoint, subscription_key, origin, destination):
    variables = {
        "from": {"latitude": origin[2], "longitude": origin[3]},
        "to": {"latitude": destination[2], "longitude": destination[3]},
    }
    request = urllib.request.Request(endpoint, data=json.dumps({"query": QUERY, "variables": variables}).encode(), headers={
        "Content-Type": "application/json",
        "digitransit-subscription-key": subscription_key,
        "User-Agent": "kaupunkipyorat-route-builder/1.0",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        return parse_route(json.load(response))


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def format_duration(milliseconds):
    minutes = milliseconds // 60000
    hours, minutes = divmod(minutes, 60)
    return f"{hours} h {minutes} min" if hours else f"{minutes} min"


def main(argv=None, *, request_fn=request_route, sleep_fn=time.sleep):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stations", type=Path, default=Path("site/stations.js"))
    parser.add_argument("--data", type=Path, default=Path("site/data"))
    parser.add_argument("--output", type=Path, default=Path("output"))
    parser.add_argument("--start-station-index", type=int, default=0)
    parser.add_argument("--max-stations", type=int, default=1)
    parser.add_argument("--delay-ms", type=int, default=750)
    parser.add_argument("--max-consecutive-failures", type=int, default=3,
                        help="stop after this many consecutive failed requests")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--subscription-key", default=None)
    args = parser.parse_args(argv)
    if (args.start_station_index < 0 or args.max_stations < 1 or args.delay_ms < 0
            or args.max_consecutive_failures < 1):
        parser.error("start station index and delay must be non-negative; maximums must be positive")

    try:
        stations = load_stations(args.stations)
        required = required_routes(args.data, [row[0] for row in stations])
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    selected = stations[args.start_station_index:args.start_station_index + args.max_stations]
    if not selected:
        parser.error("start station index is outside stations.js")
    key = args.subscription_key
    if key is None:
        import os
        key = os.environ.get("DIGITRANSIT_SUBSCRIPTION_KEY")
    if not key:
        parser.error("DIGITRANSIT_SUBSCRIPTION_KEY is required")

    total = sum(map(len, required.values()))
    print(f"Stations: {len(stations)}")
    print(f"Total directed routes required: {total}")
    print(f"Configured delay: {args.delay_ms} ms")
    print(f"Estimated minimum delay time: {format_duration(total * args.delay_ms)}")
    by_id = {row[0]: row for row in stations}
    summary = {"startStationIndex": args.start_station_index, "stationsProcessed": 0,
               "routesAttempted": 0, "routesSucceeded": 0, "routesFailed": 0,
               "failedRoutes": [], "stoppedEarly": False}
    retry_waits = (2, 5)
    consecutive_failures = 0
    stop_requested = False
    for index, origin in enumerate(selected, args.start_station_index):
        destinations = sorted(required[origin[0]])
        print(f"\nProcessing station index {index}\nStation: {origin[1]} (ID {origin[0]})")
        print(f"Outgoing routes required: {len(destinations)}")
        output_path = args.output / "routes" / f"{origin[0]}.json"
        station_output = {"v": 1, "station": origin[0], "out": {}}
        write_json(output_path, station_output)
        for route_index, destination_id in enumerate(destinations):
            summary["routesAttempted"] += 1
            success = False
            for attempt in range(3):
                print(f"Route {origin[0]} -> {destination_id}: attempt {attempt + 1}", flush=True)
                try:
                    station_output["out"][str(destination_id)] = request_fn(args.endpoint, key, origin, by_id[destination_id])
                    write_json(output_path, station_output)
                    summary["routesSucceeded"] += 1
                    consecutive_failures = 0
                    success = True
                    break
                except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, urllib.error.HTTPError) as error:
                    print(f"Route {origin[0]} -> {destination_id} failed: {error}", file=sys.stderr, flush=True)
                    consecutive_failures += 1
                    if consecutive_failures >= args.max_consecutive_failures:
                        summary["stoppedEarly"] = True
                        summary["stopReason"] = (f"reached {args.max_consecutive_failures} "
                                                 "consecutive failed requests")
                        stop_requested = True
                        print(f"Stopping early: {summary['stopReason']}", file=sys.stderr, flush=True)
                        break
                    if attempt < 2:
                        print(f"Waiting {retry_waits[attempt]} s before retry", flush=True)
                        sleep_fn(retry_waits[attempt])
            if not success:
                summary["routesFailed"] += 1
                summary["failedRoutes"].append([origin[0], destination_id])
            if stop_requested:
                break
            if route_index + 1 < len(destinations):
                sleep_fn(args.delay_ms / 1000)
        if not stop_requested:
            summary["stationsProcessed"] += 1
        write_json(args.output / "routing-summary.json", summary)
        if stop_requested:
            break
    print(f"\nStations processed: {summary['stationsProcessed']}")
    print(f"Routes attempted: {summary['routesAttempted']}")
    print(f"Routes succeeded: {summary['routesSucceeded']}")
    print(f"Routes failed: {summary['routesFailed']}")
    return 1 if stop_requested else 0


if __name__ == "__main__":
    raise SystemExit(main())
