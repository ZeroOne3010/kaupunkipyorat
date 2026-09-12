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


class ApiExchangeError(ValueError):
    """A failed route request with safe request and response diagnostics."""

    def __init__(self, message, request_details, response, status_code=None):
        super().__init__(message)
        self.request_details = request_details
        self.response = response
        self.status_code = status_code

    def format_exchange(self):
        return ("API request (subscription key redacted):\n"
                f"{json.dumps(self.request_details, ensure_ascii=False, indent=2)}\n"
                "API response:\n"
                f"{json.dumps(self.response, ensure_ascii=False, indent=2)}")


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


def decode_polyline(encoded, precision=5):
    """Decode a Google encoded polyline into integer coordinate pairs."""
    coordinates = []
    latitude = longitude = index = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            result = shift = 0
            while True:
                if index >= len(encoded):
                    raise ValueError("invalid encoded polyline")
                byte = ord(encoded[index]) - 63
                index += 1
                if byte < 0 or byte > 63:
                    raise ValueError("invalid encoded polyline")
                result |= (byte & 0x1f) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        latitude += deltas[0]
        longitude += deltas[1]
        coordinates.append((latitude, longitude))
    return coordinates


def encode_polyline(coordinates):
    """Encode integer coordinate pairs as a Google encoded polyline."""
    encoded = []
    previous = [0, 0]
    for coordinate in coordinates:
        for axis in range(2):
            delta = coordinate[axis] - previous[axis]
            previous[axis] = coordinate[axis]
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                encoded.append(chr((0x20 | (value & 0x1f)) + 63))
                value >>= 5
            encoded.append(chr(value + 63))
    return "".join(encoded)


def parse_route(payload):
    if payload.get("errors"):
        raise ValueError("; ".join(error.get("message", str(error)) for error in payload["errors"]))
    edges = payload.get("data", {}).get("planConnection", {}).get("edges", [])
    if not edges:
        raise ValueError("no bicycle itinerary returned")
    legs = edges[0].get("node", {}).get("legs", [])
    if not legs:
        raise ValueError("bicycle itinerary contained no legs")
    coordinates = []
    distance = 0
    for index, leg in enumerate(legs, start=1):
        points = (leg.get("legGeometry") or {}).get("points")
        if not points:
            raise ValueError(f"bicycle itinerary leg {index} had no geometry points")
        leg_coordinates = decode_polyline(points)
        if coordinates and leg_coordinates and coordinates[-1] == leg_coordinates[0]:
            leg_coordinates = leg_coordinates[1:]
        coordinates.extend(leg_coordinates)
        distance += float(leg["distance"])
    return {"p": encode_polyline(coordinates), "d": round(distance)}


def request_route(endpoint, subscription_key, origin, destination):
    variables = {
        "from": {"latitude": origin[2], "longitude": origin[3]},
        "to": {"latitude": destination[2], "longitude": destination[3]},
    }
    body = {"query": QUERY, "variables": variables}
    headers = {
        "Content-Type": "application/json",
        "digitransit-subscription-key": subscription_key,
        "User-Agent": "kaupunkipyorat-route-builder/1.0",
    }
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers=headers)
    request_details = {
        "url": endpoint,
        "method": "POST",
        "headers": {**headers, "digitransit-subscription-key": "<redacted>"},
        "body": body,
    }
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            response_text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        response_text = error.read().decode("utf-8", errors="replace")
        try:
            response_payload = json.loads(response_text)
        except json.JSONDecodeError:
            response_payload = response_text
        raise ApiExchangeError(str(error), request_details, response_payload, error.code) from error
    try:
        response_payload = json.loads(response_text)
        return parse_route(response_payload)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        try:
            response_payload = json.loads(response_text)
        except json.JSONDecodeError:
            response_payload = response_text
        raise ApiExchangeError(str(error), request_details, response_payload) from error


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
                        help="stop after this many routes fail after all retries")
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
    batch_route_total = sum(len(required[station[0]]) for station in selected)
    batch_delay_count = sum(max(0, len(required[station[0]]) - 1) for station in selected)
    batch_route_positions = {
        (station[0], destination_id): position
        for position, (station, destination_id) in enumerate(
            ((station, destination_id) for station in selected
             for destination_id in sorted(required[station[0]])),
            start=1,
        )
    }
    print(f"Stations: {len(stations)}")
    print(f"Next successful run start station index: "
          f"{args.start_station_index + len(selected)}")
    print(f"Total directed routes required: {total}")
    print(f"Directed routes in selected batch: {batch_route_total}")
    print(f"Configured delay: {args.delay_ms} ms")
    print(f"Estimated minimum delay time for selected batch: "
          f"{format_duration(batch_delay_count * args.delay_ms)}")
    by_id = {row[0]: row for row in stations}
    summary = {"startStationIndex": args.start_station_index, "stationsProcessed": 0,
               "routesAttempted": 0, "requestsMade": 0, "serverErrorRetries": 0,
               "routesSucceeded": 0, "routesFailed": 0,
               "failedRoutes": [], "pendingRoutes": [], "stoppedEarly": False}
    retry_waits = (2, 5)
    consecutive_failures = 0
    consecutive_client_errors = 0
    stop_requested = False
    server_error_queue = []
    station_outputs = {}
    batch_route_index = 0
    for index, origin in enumerate(selected, args.start_station_index):
        destinations = sorted(required[origin[0]])
        print(f"\nProcessing station index {index}\nStation: {origin[1]} (ID {origin[0]})")
        print(f"Outgoing routes required: {len(destinations)}")
        output_path = args.output / "routes" / f"{origin[0]}.json"
        station_output = {"v": 1, "station": origin[0], "out": {}}
        station_outputs[origin[0]] = (output_path, station_output)
        write_json(output_path, station_output)
        for route_index, destination_id in enumerate(destinations):
            batch_route_index += 1
            summary["routesAttempted"] += 1
            success = False
            queued = False
            for attempt in range(3):
                print(f"Route {batch_route_index}/{batch_route_total} "
                      f"(station route {route_index + 1}/{len(destinations)}): "
                      f"{origin[0]} -> {destination_id}, attempt {attempt + 1}", flush=True)
                try:
                    summary["requestsMade"] += 1
                    station_output["out"][str(destination_id)] = request_fn(args.endpoint, key, origin, by_id[destination_id])
                    write_json(output_path, station_output)
                    summary["routesSucceeded"] += 1
                    consecutive_failures = 0
                    consecutive_client_errors = 0
                    success = True
                    break
                except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, urllib.error.HTTPError) as error:
                    print(f"Route {origin[0]} -> {destination_id} failed: {error}", file=sys.stderr, flush=True)
                    status = error.status_code if isinstance(error, ApiExchangeError) else None
                    if status is not None and 500 <= status < 600:
                        consecutive_client_errors = 0
                        server_error_queue.append((origin[0], destination_id))
                        queued = True
                        print(f"HTTP {status}; queued route for server-error retry and waiting an extra 1 s",
                              file=sys.stderr, flush=True)
                        sleep_fn(1)
                        break
                    if status is not None and 400 <= status < 500:
                        consecutive_client_errors += 1
                        print(f"Consecutive HTTP 4xx errors: {consecutive_client_errors}/3",
                              file=sys.stderr, flush=True)
                        if consecutive_client_errors >= 3:
                            summary["stoppedEarly"] = True
                            summary["stopReason"] = "received 3 consecutive HTTP 4xx responses"
                            stop_requested = True
                            print(f"Stopping immediately: {summary['stopReason']}", file=sys.stderr, flush=True)
                            break
                    else:
                        consecutive_client_errors = 0
                    if attempt == 2 and isinstance(error, ApiExchangeError):
                        print(error.format_exchange(), file=sys.stderr, flush=True)
                    if attempt < 2 and not stop_requested:
                        print(f"Waiting {retry_waits[attempt]} s before retry", flush=True)
                        sleep_fn(retry_waits[attempt])
            if not success and not queued:
                summary["routesFailed"] += 1
                summary["failedRoutes"].append([origin[0], destination_id])
                consecutive_failures += 1
                if not stop_requested and consecutive_failures >= args.max_consecutive_failures:
                    summary["stoppedEarly"] = True
                    summary["stopReason"] = (f"reached {args.max_consecutive_failures} "
                                             "consecutive routes that failed after retries")
                    stop_requested = True
                    print(f"Stopping early: {summary['stopReason']}", file=sys.stderr, flush=True)
            if stop_requested:
                break
            if route_index + 1 < len(destinations):
                sleep_fn(args.delay_ms / 1000)
        if not stop_requested:
            summary["stationsProcessed"] += 1
        write_json(args.output / "routing-summary.json", summary)
        if stop_requested:
            break

    if server_error_queue and not stop_requested:
        print(f"\nInitial pass complete; waiting 30 s before processing "
              f"{len(server_error_queue)} server-error route(s)", flush=True)
        sleep_fn(30)
        for queue_round in range(1, 3):
            pending = server_error_queue
            server_error_queue = []
            print(f"Server-error queue pass {queue_round}/2: {len(pending)} route(s)", flush=True)
            for pending_index, (origin_id, destination_id) in enumerate(pending):
                origin = by_id[origin_id]
                output_path, station_output = station_outputs[origin_id]
                summary["requestsMade"] += 1
                summary["serverErrorRetries"] += 1
                route_position = batch_route_positions[(origin_id, destination_id)]
                print(f"Queued route {route_position}/{batch_route_total}: "
                      f"{origin_id} -> {destination_id}, pass {queue_round}/2", flush=True)
                try:
                    station_output["out"][str(destination_id)] = request_fn(
                        args.endpoint, key, origin, by_id[destination_id])
                    write_json(output_path, station_output)
                    summary["routesSucceeded"] += 1
                    consecutive_failures = 0
                    consecutive_client_errors = 0
                    print(f"Queued route {origin_id} -> {destination_id} succeeded", flush=True)
                except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError,
                        urllib.error.HTTPError) as error:
                    status = error.status_code if isinstance(error, ApiExchangeError) else None
                    print(f"Queued route {origin_id} -> {destination_id} failed: {error}",
                          file=sys.stderr, flush=True)
                    if status is not None and 500 <= status < 600 and queue_round < 2:
                        consecutive_client_errors = 0
                        server_error_queue.append((origin_id, destination_id))
                        print(f"HTTP {status}; retaining route for the next queue pass and "
                              "waiting an extra 1 s", file=sys.stderr, flush=True)
                        sleep_fn(1)
                    else:
                        if status is not None and 500 <= status < 600:
                            consecutive_client_errors = 0
                            print(f"Route {origin_id} -> {destination_id} exhausted both queue passes",
                                  file=sys.stderr, flush=True)
                            sleep_fn(1)
                        elif status is not None and 400 <= status < 500:
                            consecutive_client_errors += 1
                            print(f"Consecutive HTTP 4xx errors: {consecutive_client_errors}/3",
                                  file=sys.stderr, flush=True)
                            if consecutive_client_errors >= 3:
                                summary["stoppedEarly"] = True
                                summary["stopReason"] = "received 3 consecutive HTTP 4xx responses"
                                stop_requested = True
                        else:
                            consecutive_client_errors = 0
                        summary["routesFailed"] += 1
                        summary["failedRoutes"].append([origin_id, destination_id])
                        consecutive_failures += 1
                        if (not stop_requested
                                and consecutive_failures >= args.max_consecutive_failures):
                            summary["stoppedEarly"] = True
                            summary["stopReason"] = (f"reached {args.max_consecutive_failures} "
                                                     "consecutive routes that failed after retries")
                            stop_requested = True
                write_json(args.output / "routing-summary.json", summary)
                if stop_requested:
                    server_error_queue.extend(pending[pending_index + 1:])
                    print(f"Stopping immediately: {summary['stopReason']}", file=sys.stderr, flush=True)
                    break
                if pending_index + 1 < len(pending):
                    print(f"Waiting configured {args.delay_ms} ms before next queued route",
                          flush=True)
                    sleep_fn(args.delay_ms / 1000)
            if stop_requested or not server_error_queue:
                break

        write_json(args.output / "routing-summary.json", summary)
    if server_error_queue:
        summary["pendingRoutes"] = [[origin_id, destination_id]
                                    for origin_id, destination_id in server_error_queue]
        print(f"Leaving {len(server_error_queue)} queued route(s) pending due to early stop",
              file=sys.stderr, flush=True)
    write_json(args.output / "routing-summary.json", summary)
    print(f"\nStations processed: {summary['stationsProcessed']}")
    print(f"Routes attempted: {summary['routesAttempted']}")
    print(f"Routes succeeded: {summary['routesSucceeded']}")
    print(f"Routes failed: {summary['routesFailed']}")
    return 1 if stop_requested else 0


if __name__ == "__main__":
    raise SystemExit(main())
