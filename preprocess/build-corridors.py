#!/usr/bin/env python3
"""Build season-wide inferred cycling corridors from committed route geometry.

Routes are kept as curved lines.  A route is split where the set of other routes
within ``tolerance`` changes; each atomic piece is represented by the lowest
stable route id which covers it.  This conflates reversed and differently
vertexed lines without requiring equal vertices.  The tolerance is deliberately
small: it is a geometric conflation allowance, not a sampling interval.
"""

import argparse
import gzip
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

try:
    from pyproj import Transformer
    from shapely.geometry import LineString, Point
    from shapely.ops import linemerge, substring, unary_union
    from shapely.strtree import STRtree
except ImportError as error:  # pragma: no cover - exercised by the CLI environment
    raise SystemExit("build-corridors.py requires Shapely and pyproj") from error


MONTHS = range(4, 11)


def decode_polyline(encoded):
    """Decode a Google polyline to (longitude, latitude) coordinates."""
    result, lat, lon, index = [], 0, 0, 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            value = shift = 0
            while True:
                if index >= len(encoded):
                    raise ValueError("invalid encoded polyline")
                byte = ord(encoded[index]) - 63
                index += 1
                if not 0 <= byte <= 63:
                    raise ValueError("invalid encoded polyline")
                value |= (byte & 31) << shift
                shift += 5
                if byte < 32:
                    break
            deltas.append(~(value >> 1) if value & 1 else value >> 1)
        lat += deltas[0]
        lon += deltas[1]
        result.append((lon / 1e5, lat / 1e5))
    return result


def encode_polyline(coordinates):
    """Encode (longitude, latitude) coordinates as a Google polyline."""
    output, previous = [], [0, 0]
    for lon, lat in coordinates:
        values = [round(lat * 1e5), round(lon * 1e5)]
        for axis, value in enumerate(values):
            delta = value - previous[axis]
            previous[axis] = value
            encoded = ~(delta << 1) if delta < 0 else delta << 1
            while encoded >= 32:
                output.append(chr((32 | encoded & 31) + 63))
                encoded >>= 5
            output.append(chr(encoded + 63))
    return "".join(output)


def seasonal_trips(data_dir, year):
    paths = [data_dir / f"{year}-{month:02d}.json" for month in MONTHS]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise ValueError("missing required monthly trip files: " + ", ".join(missing))
    totals = defaultdict(int)
    excluded = 0
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload.get("total", []):
            if len(row) < 3 or row[2] <= 0:
                continue
            if row[0] == row[1]:
                excluded += 1
                continue
            totals[(int(row[0]), int(row[1]))] += int(row[2])
    return paths, dict(totals), excluded


def load_routes(route_dir, trips, transformer, minimum_trips=1):
    records, missing = [], []
    files = {}
    for (origin, destination), count in sorted(trips.items()):
        if count < minimum_trips:
            continue
        if origin not in files:
            path = route_dir / f"{origin}.json"
            try:
                files[origin] = json.loads(path.read_text(encoding="utf-8")).get("out", {})
            except (OSError, ValueError, TypeError):
                files[origin] = {}
        route = files[origin].get(str(destination))
        try:
            coordinates = decode_polyline(route["p"])
            metric = LineString([transformer.transform(lon, lat) for lon, lat in coordinates])
            if len(coordinates) < 2 or metric.length == 0:
                raise ValueError("empty line")
        except (KeyError, TypeError, ValueError):
            missing.append((origin, destination))
            continue
        records.append({"od": (origin, destination), "weight": count, "line": metric})
    return records, missing


def _line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    return [line for part in getattr(geometry, "geoms", ()) for line in _line_parts(part)]


def _vector_between(line, start, end):
    first = line.interpolate(start)
    last = line.interpolate(end)
    return last.x - first.x, last.y - first.y


def _parallel_coverage(piece, route, tolerance, minimum_cosine=math.cos(math.radians(30))):
    """Whether route follows the whole piece nearby in either direction.

    Distance alone incorrectly conflates perpendicular crossings.  Requiring a
    similar local tangent and longitudinal coverage also distinguishes a path
    which merely touches an endpoint from one which represents the same corridor.
    """
    midpoint = piece.interpolate(0.5, normalized=True)
    samples = (Point(piece.coords[0]), midpoint, Point(piece.coords[-1]))
    if any(route.distance(point) > tolerance + 1e-7 for point in samples):
        return False
    piece_vector = _vector_between(piece, 0, piece.length)
    position = route.project(midpoint)
    radius = min(max(tolerance, piece.length / 4), route.length / 2)
    route_vector = _vector_between(route, max(0, position - radius), min(route.length, position + radius))
    piece_norm = math.hypot(*piece_vector)
    route_norm = math.hypot(*route_vector)
    if not piece_norm or not route_norm:
        return False
    cosine = abs((piece_vector[0] * route_vector[0] + piece_vector[1] * route_vector[1])
                 / (piece_norm * route_norm))
    if cosine < minimum_cosine:
        return False
    projections = [route.project(samples[0]), route.project(samples[-1])]
    return abs(projections[1] - projections[0]) >= piece.length * 0.5


def aggregate_corridors(records, tolerance):
    """Return exact-weight metric lines and the pre-merge piece count.

    Buffer intersections locate overlap/branch boundaries.  Whole-piece distance
    and tangent checks assign each piece a stable set of covering OD routes.
    Equivalent pieces are suppressed only if an already selected representative
    emits that same membership, preventing both duplicate counting and demand
    loss when geometric proximity is non-transitive.
    """
    if not records:
        return [], 0
    lines = [record["line"] for record in records]
    tree = STRtree(lines)
    by_wkb = defaultdict(list)
    for index, line in enumerate(lines):
        by_wkb[line.wkb].append(index)

    def candidates(line):
        found = tree.query(line.buffer(tolerance))
        for item in found:
            if hasattr(item, "geom_type"):
                yield from by_wkb[item.wkb]
            else:  # Shapely 2 returns integer indices.
                yield int(item)

    split_points = []
    candidate_sets = []
    for index, line in enumerate(lines):
        cuts = {0.0, line.length}
        nearby = sorted(set(candidates(line)))
        candidate_sets.append(nearby)
        for other_index in nearby:
            if other_index == index:
                continue
            overlap = line.intersection(lines[other_index].buffer(tolerance))
            for part in _line_parts(overlap):
                cuts.add(line.project(LineString(part.coords[:2]).boundary.geoms[0]))
                cuts.add(line.project(LineString(part.coords[-2:]).boundary.geoms[-1]))
            for coordinate in (lines[other_index].coords[0], lines[other_index].coords[-1]):
                point = Point(coordinate)
                if line.distance(point) <= tolerance:
                    cuts.add(line.project(point))
        split_points.append(sorted(cuts))

    atomic = []
    for owner, line in enumerate(lines):
        cuts = split_points[owner]
        for start, end in zip(cuts, cuts[1:]):
            if end - start < 0.01:
                continue
            piece = substring(line, start, end)
            covering = tuple(index for index in candidate_sets[owner]
                             if index == owner or _parallel_coverage(piece, lines[index], tolerance))
            atomic.append((owner, piece, covering))

    emitted = []
    representatives = defaultdict(list)
    for _owner, piece, covering in atomic:
        if any(_parallel_coverage(piece, representative, tolerance)
               for representative in representatives[covering]):
            continue
        representatives[covering].append(piece)
        emitted.append((piece, sum(records[index]["weight"] for index in covering)))

    before = len(emitted)
    merged = []
    by_weight = defaultdict(list)
    for line, weight in emitted:
        by_weight[weight].append(line)
    for weight in sorted(by_weight):
        geometry = linemerge(unary_union(by_weight[weight]))
        merged.extend((line, weight) for line in _line_parts(geometry))
    return merged, before


def output_payload(year, tolerance, corridors, inverse):
    rows = []
    for line, weight in corridors:
        coordinates = [inverse.transform(x, y) for x, y in line.coords]
        encoded = encode_polyline(coordinates)
        reverse = encode_polyline(reversed(coordinates))
        rows.append((min(encoded, reverse), int(weight)))
    rows.sort(key=lambda row: (-row[1], row[0]))
    return {"v": 1, "year": year, "from": f"{year}-04", "to": f"{year}-10",
            "toleranceMeters": tolerance, "corridors": rows}


def percentile(values, fraction):
    return values[min(len(values) - 1, round((len(values) - 1) * fraction))] if values else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("year", type=int)
    parser.add_argument("--data", type=Path, default=Path("site/data"))
    parser.add_argument("--routes", type=Path, default=Path("site/routes"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--tolerance-meters", type=float, default=4)
    parser.add_argument("--minimum-trips", type=int, default=1)
    args = parser.parse_args(argv)
    if args.tolerance_meters <= 0 or args.minimum_trips < 1:
        parser.error("tolerance must be positive and minimum trips must be at least 1")
    output = args.output or Path("site/corridors") / f"{args.year}.json"
    try:
        paths, trips, excluded = seasonal_trips(args.data, args.year)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    forward = Transformer.from_crs(4326, 3067, always_xy=True)
    inverse = Transformer.from_crs(3067, 4326, always_xy=True)
    records, missing = load_routes(args.routes, trips, forward, args.minimum_trips)
    corridors, before = aggregate_corridors(records, args.tolerance_meters)
    payload = output_payload(args.year, args.tolerance_meters, corridors, inverse)
    encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encoded)
    weights = sorted(row[1] for row in payload["corridors"])
    lines = [f"Year: {args.year}", "Monthly files: " + ", ".join(path.name for path in paths),
             f"Directed OD pairs with trips: {len(trips):,}", f"Seasonal trips in OD pairs: {sum(trips.values()):,}",
             f"Same-station OD rows excluded: {excluded:,}", f"Routed OD pairs found: {len(records):,}",
             f"OD pairs below minimum trips: {sum(count < args.minimum_trips for count in trips.values()):,}",
             f"Trips below minimum trips: {sum(count for count in trips.values() if count < args.minimum_trips):,}",
             f"Missing route geometries: {len(missing):,}", f"Input route geometries processed: {len(records):,}",
             f"Corridor pieces before merging: {before:,}", f"Corridor pieces after merging: {len(weights):,}"]
    if weights:
        lines.append("Corridor trips min / median / p90 / p95 / max: " + " / ".join(map(lambda n: f"{n:,}",
            [weights[0], round(statistics.median(weights)), percentile(weights, .9), percentile(weights, .95), weights[-1]])))
    for threshold in (10, 50, 100, 500, 1000):
        lines.append(f"Corridors >= {threshold:,}: {sum(value >= threshold for value in weights):,}")
    lines += [f"Output file size: {len(encoded):,} bytes", f"Estimated gzip size: {len(gzip.compress(encoded)):,} bytes"]
    report = "\n".join(lines) + "\n"
    print(report, end="")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(report, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
