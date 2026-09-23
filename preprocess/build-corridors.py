#!/usr/bin/env python3
"""Build season-wide cycling corridors from exact routed-polyline E5 edges."""

import argparse
import gzip
import json
import math
import statistics
import time
from collections import defaultdict
from pathlib import Path

try:  # Legacy geometric implementation, retained only for reference/tests.
    from pyproj import Transformer
    from shapely.geometry import LineString, Point
    from shapely.ops import linemerge, substring, unary_union
    from shapely.strtree import STRtree
except ImportError:  # Production exact-edge builds do not need these packages.
    Transformer = LineString = Point = STRtree = None
    linemerge = substring = unary_union = None


MONTHS = range(4, 11)


def format_duration(seconds):
    """Format a monotonic-clock duration for human-readable build logs."""
    seconds = max(0, int(seconds))
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def distribution(values, fractions=(.5, .9, .95)):
    """Return inexpensive descriptive statistics for an integer sample."""
    ordered = sorted(values)
    if not ordered:
        return {"min": 0, "median": 0, "mean": 0, "p90": 0, "p95": 0,
                "p99": 0, "max": 0}
    return {"min": ordered[0], "median": statistics.median(ordered),
            "mean": statistics.mean(ordered), "p90": percentile(ordered, .9),
            "p95": percentile(ordered, .95), "p99": percentile(ordered, .99),
            "max": ordered[-1]}


def log_progress(label, completed, total, phase_start, overall_start, details=""):
    """Print a rate-limited loop checkpoint (the caller chooses the interval)."""
    now = time.perf_counter()
    elapsed = now - phase_start
    percent = completed / total * 100 if total else 100
    rate = completed / elapsed if elapsed else 0
    print(f"{label}: {completed:,} / {total:,} ({percent:.1f}%), "
          f"elapsed {format_duration(elapsed)}, overall {format_duration(now - overall_start)}, "
          f"rate {rate:.1f}/s{details}", flush=True)


def log_phase(label, started, overall_start):
    elapsed = time.perf_counter() - started
    print(f"Phase complete: {label}: {format_duration(elapsed)} "
          f"(overall {format_duration(time.perf_counter() - overall_start)})", flush=True)
    return elapsed


def decode_polyline(encoded):
    """Decode a Google polyline to (longitude, latitude) coordinates."""
    return [(lon / 1e5, lat / 1e5) for lon, lat in decode_polyline_e5(encoded)]


def decode_polyline_e5(encoded):
    """Decode a Google polyline without losing its exact integer E5 vertices."""
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
        result.append((lon, lat))
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


def encode_polyline_e5(coordinates):
    """Encode integer (longitude E5, latitude E5) coordinates directly."""
    output, previous_lon, previous_lat = [], 0, 0
    for lon, lat in coordinates:
        for delta in (lat - previous_lat, lon - previous_lon):
            encoded = ~(delta << 1) if delta < 0 else delta << 1
            while encoded >= 32:
                output.append(chr((32 | encoded & 31) + 63))
                encoded >>= 5
            output.append(chr(encoded + 63))
        previous_lon, previous_lat = lon, lat
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


def evenly_sample(records, sample_size):
    """Select an ordered, deterministic sample spanning all records."""
    if sample_size >= len(records):
        return records
    return [records[index * len(records) // sample_size] for index in range(sample_size)]


def load_routes(route_dir, trips, transformer, minimum_trips=1, max_routes=None,
                sample_routes=None, project=True):
    records, missing = [], []
    files = {}
    eligible = [(od, count) for od, count in sorted(trips.items()) if count >= minimum_trips]
    # Select the diagnostic sample before route files are opened and, critically,
    # before any polyline is decoded or projected.
    if sample_routes is not None:
        eligible = evenly_sample(eligible, sample_routes)
    for (origin, destination), count in eligible:
        if origin not in files:
            path = route_dir / f"{origin}.json"
            try:
                files[origin] = json.loads(path.read_text(encoding="utf-8")).get("out", {})
            except (OSError, ValueError, TypeError):
                files[origin] = {}
        route = files[origin].get(str(destination))
        try:
            coordinates_e5 = decode_polyline_e5(route["p"])
            if len(coordinates_e5) < 2 or len(set(coordinates_e5)) < 2:
                raise ValueError("empty line")
            metric = None
            if project:
                coordinates = [(lon / 1e5, lat / 1e5) for lon, lat in coordinates_e5]
                metric = LineString([transformer.transform(lon, lat) for lon, lat in coordinates])
                if metric.length == 0:
                    raise ValueError("empty line")
        except (KeyError, TypeError, ValueError):
            missing.append((origin, destination))
            continue
        record = {"od": (origin, destination), "weight": count,
                  "coordinates_e5": coordinates_e5}
        if metric is not None:
            record["line"] = metric
        records.append(record)
        if max_routes is not None and len(records) >= max_routes:
            break
    return records, missing


def primitive_edges(coordinates_e5):
    """Yield canonical undirected, non-zero primitive edges in route order."""
    for first, second in zip(coordinates_e5, coordinates_e5[1:]):
        if first != second:
            yield (first, second) if first < second else (second, first)


def build_exact_edges(records, diagnostics=None):
    """Collapse exact E5 primitive edges and add each route's weight once."""
    diagnostics = diagnostics if diagnostics is not None else {}
    occurrences = zero_length = repeated = vertices = 0
    extraction_seconds = aggregation_seconds = 0.0
    aggregated = {}
    for record in records:
        extraction_started = time.perf_counter()
        coordinates = record["coordinates_e5"]
        vertices += len(coordinates)
        occurrences += max(0, len(coordinates) - 1)
        route_edges = set()
        for first, second in zip(coordinates, coordinates[1:]):
            if first == second:
                zero_length += 1
                continue
            edge = (first, second) if first < second else (second, first)
            if edge in route_edges:
                repeated += 1
            else:
                route_edges.add(edge)
        extraction_seconds += time.perf_counter() - extraction_started

        # Aggregate a route immediately rather than retaining every route's set
        # of edges.  This keeps peak memory proportional to the unique network,
        # while the per-phase timers still distinguish extraction from updates.
        aggregation_started = time.perf_counter()
        weight = int(record["weight"])
        for edge in route_edges:
            entry = aggregated.setdefault(edge, {"edge": edge, "weight": 0, "route_count": 0})
            entry["weight"] += weight
            entry["route_count"] += 1
        aggregation_seconds += time.perf_counter() - aggregation_started
    edges = [aggregated[key] for key in sorted(aggregated)]
    diagnostics.update({
        "routed_od_geometries": len(records), "decoded_polyline_vertices": vertices,
        "primitive_edge_occurrences": occurrences, "zero_length_edges_skipped": zero_length,
        "repeated_edges_deduplicated": repeated, "unique_exact_edges": len(edges),
        "exact_collapse_ratio": occurrences / len(edges) if edges else 0,
        "primitive_edge_extraction_seconds": extraction_seconds,
        "exact_edge_aggregation_seconds": aggregation_seconds,
        # Count each routed OD weight once here. Summing the collapsed edge
        # weights instead measures weighted unique route-edge memberships: an
        # edge repeated within one route still contributes that route's weight
        # only once, consistently with the exact-collapse semantics above.
        "total_seasonal_trip_weight_represented": sum(int(record["weight"]) for record in records),
        "weighted_unique_route_edge_memberships": sum(edge["weight"] for edge in edges),
        "edge_trip_count_distribution": distribution([edge["weight"] for edge in edges]),
        "unique_edges_by_route_count": {
            "exactly_1": sum(edge["route_count"] == 1 for edge in edges),
            "2_plus": sum(edge["route_count"] >= 2 for edge in edges),
            "5_plus": sum(edge["route_count"] >= 5 for edge in edges),
            "10_plus": sum(edge["route_count"] >= 10 for edge in edges),
            "50_plus": sum(edge["route_count"] >= 50 for edge in edges),
        },
    })
    return edges


def merge_exact_edges(edges, diagnostics=None):
    """Return deterministic maximal, non-branching chains grouped by exact weight."""
    diagnostics = diagnostics if diagnostics is not None else {}
    by_weight = defaultdict(list)
    for entry in edges:
        by_weight[int(entry["weight"])].append(tuple(entry["edge"]))

    chains = []
    for weight in sorted(by_weight):
        weight_edges = sorted(set(by_weight[weight]))
        adjacency = defaultdict(list)
        for edge in weight_edges:
            first, second = edge
            adjacency[first].append((second, edge))
            adjacency[second].append((first, edge))
        for vertex in adjacency:
            adjacency[vertex].sort()
        unused = set(weight_edges)

        def walk(start, edge):
            vertices, current, selected = [start], start, edge
            while selected in unused:
                unused.remove(selected)
                following = selected[1] if selected[0] == current else selected[0]
                vertices.append(following)
                if len(adjacency[following]) != 2:
                    break
                candidates = [candidate for _other, candidate in adjacency[following]
                              if candidate in unused]
                if len(candidates) != 1:
                    break
                current, selected = following, candidates[0]
            canonical = tuple(vertices)
            reverse = tuple(reversed(canonical))
            return min(canonical, reverse)

        # Paths touching endpoints or branches come first. A degree-two vertex
        # can be crossed only when there is exactly one unused continuation.
        for vertex in sorted(adjacency):
            if len(adjacency[vertex]) == 2:
                continue
            for _other, edge in adjacency[vertex]:
                if edge in unused:
                    chains.append((walk(vertex, edge), weight))
        # Every remaining component is a cycle. Starting with its smallest
        # edge/endpoint makes cycle cutting and orientation byte-stable.
        while unused:
            edge = min(unused)
            chains.append((walk(min(edge), edge), weight))

    chains.sort(key=lambda item: (-item[1], item[0]))
    edge_counts = [len(vertices) - 1 for vertices, _weight in chains]
    vertex_counts = [len(vertices) for vertices, _weight in chains]
    absorbed = sum(count for count in edge_counts if count > 1)
    diagnostics.update({
        "unique_exact_weighted_edges_before_merging": len(edges),
        "merged_corridor_polylines": len(chains),
        "edges_absorbed_into_multi_edge_chains": absorbed,
        "edges_absorbed_percentage": absorbed / len(edges) * 100 if edges else 0,
        "chain_edge_count_distribution": distribution(edge_counts),
        "chain_vertex_count_distribution": distribution(vertex_counts),
    })
    return chains


def exact_output_payload(year, chains):
    """Encode exact E5 chains using the established compact corridor schema."""
    rows = []
    for coordinates, weight in chains:
        forward = encode_polyline_e5(coordinates)
        reverse = encode_polyline_e5(reversed(coordinates))
        rows.append([min(forward, reverse), int(weight)])
    rows.sort(key=lambda row: (-row[1], row[0]))
    return {"v": 1, "year": year, "from": f"{year}-04", "to": f"{year}-10",
            "corridors": rows}


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


def aggregate_corridors(records, tolerance, diagnostics=None, overall_start=None):
    """Return exact-weight metric lines and the pre-merge piece count.

    Buffer intersections locate overlap/branch boundaries.  Whole-piece distance
    and tangent checks assign each piece a stable set of covering OD routes.
    Equivalent pieces are suppressed only if an already selected representative
    emits that same membership, preventing both duplicate counting and demand
    loss when geometric proximity is non-transitive.
    """
    diagnostics = diagnostics if diagnostics is not None else {}
    overall_start = overall_start or time.perf_counter()
    if not records:
        diagnostics.update({"split_positions": 0, "atomic_pieces": 0,
                            "coverage_calls": 0, "coverage_seconds": 0})
        return [], 0
    lines = [record["line"] for record in records]
    phase_start = time.perf_counter()
    tree = STRtree(lines)
    by_wkb = defaultdict(list)
    for index, line in enumerate(lines):
        by_wkb[line.wkb].append(index)
    diagnostics["strtree_seconds"] = log_phase("building the STRtree", phase_start, overall_start)

    def candidates(line):
        found = tree.query(line, predicate="dwithin", distance=tolerance)
        for item in found:
            if hasattr(item, "geom_type"):
                yield from by_wkb[item.wkb]
            else:  # Shapely 2 returns integer indices.
                yield int(item)

    split_points = []
    candidate_sets = []
    candidate_counts = []
    comparisons = 0
    phase_start = time.perf_counter()
    for index, line in enumerate(lines):
        cuts = {0.0, line.length}
        nearby = sorted(set(candidates(line)))
        candidate_sets.append(nearby)
        candidate_counts.append(len(nearby))
        for other_index in nearby:
            if other_index == index:
                continue
            comparisons += 1
            overlap = line.intersection(lines[other_index].buffer(tolerance))
            for part in _line_parts(overlap):
                cuts.add(line.project(LineString(part.coords[:2]).boundary.geoms[0]))
                cuts.add(line.project(LineString(part.coords[-2:]).boundary.geoms[-1]))
            for coordinate in (lines[other_index].coords[0], lines[other_index].coords[-1]):
                point = Point(coordinate)
                if line.distance(point) <= tolerance:
                    cuts.add(line.project(point))
        split_points.append(sorted(cuts))
        if (index + 1) % 100 == 0 or index + 1 == len(lines):
            log_progress("Candidate discovery", index + 1, len(lines), phase_start, overall_start,
                         f", candidates current {len(nearby):,}, "
                         f"running mean {statistics.mean(candidate_counts):,.1f}, "
                         f"running max {max(candidate_counts):,}")

    diagnostics["candidate_seconds"] = log_phase(
        "discovering route candidates / split points", phase_start, overall_start)
    diagnostics.update({"candidate_counts": candidate_counts,
                        "candidate_pairs": sum(candidate_counts),
                        "candidate_pairs_excluding_self": comparisons,
                        "buffer_intersection_comparisons": comparisons,
                        "split_positions": sum(map(len, split_points))})
    live_candidate_stats = distribution(candidate_counts)
    print("Candidate-set summary min / median / mean / p90 / p95 / p99 / max: " +
          " / ".join(f"{live_candidate_stats[key]:,.1f}" for key in
                     ("min", "median", "mean", "p90", "p95", "p99", "max")), flush=True)

    atomic = []
    pieces_per_route = []
    phase_start = time.perf_counter()
    for owner, line in enumerate(lines):
        cuts = split_points[owner]
        route_pieces = 0
        for start, end in zip(cuts, cuts[1:]):
            if end - start < 0.01:
                continue
            piece = substring(line, start, end)
            atomic.append((owner, piece))
            route_pieces += 1
        pieces_per_route.append(route_pieces)
        if (owner + 1) % 100 == 0 or owner + 1 == len(lines):
            log_progress("Atomic-piece building", owner + 1, len(lines), phase_start, overall_start)
    diagnostics["atomic_build_seconds"] = log_phase("building atomic pieces", phase_start, overall_start)
    diagnostics.update({"atomic_pieces": len(atomic), "pieces_per_route": pieces_per_route})
    print(f"Atomic-piece workload: {len(atomic):,} pieces from {len(lines):,} routes; "
          f"{diagnostics['split_positions']:,} split positions", flush=True)

    coverage_calls = 0
    coverage_seconds = 0.0
    def covered(piece, route):
        nonlocal coverage_calls, coverage_seconds
        coverage_calls += 1
        started = time.perf_counter()
        result = _parallel_coverage(piece, route, tolerance)
        coverage_seconds += time.perf_counter() - started
        return result

    phase_start = time.perf_counter()
    covering_calls_start = coverage_calls
    for position, (owner, piece) in enumerate(atomic, 1):
        covering = tuple(index for index in candidate_sets[owner]
                         if index == owner or covered(piece, lines[index]))
        # Replace the entry rather than retaining a second list containing every
        # geometry. Full-season builds can produce enough pieces for that extra
        # list of tuples to materially increase peak memory.
        atomic[position - 1] = (owner, piece, covering)
        if position % 5000 == 0 or position == len(atomic):
            log_progress("Atomic-piece coverage", position, len(atomic), phase_start, overall_start)
    diagnostics["covering_seconds"] = log_phase(
        "determining covering routes for atomic pieces", phase_start, overall_start)
    diagnostics["coverage_calls_covering"] = coverage_calls - covering_calls_start

    emitted = []
    representatives = defaultdict(list)
    phase_start = time.perf_counter()
    dedup_calls_start = coverage_calls
    for position, (_owner, piece, covering) in enumerate(atomic, 1):
        if position % 5000 == 0 or position == len(atomic):
            log_progress("Representative deduplication", position, len(atomic), phase_start, overall_start)
        if any(covered(piece, representative)
               for representative in representatives[covering]):
            continue
        representatives[covering].append(piece)
        emitted.append((piece, sum(records[index]["weight"] for index in covering)))

    diagnostics["dedup_seconds"] = log_phase("suppressing duplicate representatives", phase_start, overall_start)
    diagnostics.update({"coverage_calls_dedup": coverage_calls - dedup_calls_start,
                        "coverage_calls": coverage_calls,
                        "coverage_seconds": coverage_seconds})

    before = len(emitted)
    phase_start = time.perf_counter()
    merged = []
    by_weight = defaultdict(list)
    for line, weight in emitted:
        by_weight[weight].append(line)
    for weight in sorted(by_weight):
        geometry = unary_union(by_weight[weight])
        # Shapely 2 rejects a LineString as input to linemerge.  A union of a
        # single piece (or of pieces that already form one continuous line) is
        # already fully merged, so only ask linemerge to process multipart
        # output.
        if geometry.geom_type != "LineString":
            geometry = linemerge(geometry)
        merged.extend((line, weight) for line in _line_parts(geometry))
    diagnostics["merge_seconds"] = log_phase("merging equal-weight geometry", phase_start, overall_start)
    diagnostics.update({"emitted_before_merge": before, "pieces_after_merge": len(merged)})
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


def exact_edges_report(diagnostics, route_load_seconds):
    """Render the compact exact-collapse diagnostics used by the CLI and CI."""
    usage = diagnostics["unique_edges_by_route_count"]
    weights = diagnostics["edge_trip_count_distribution"]
    return "\n".join([
        f"Routed OD geometries processed: {diagnostics['routed_od_geometries']:,}",
        f"Decoded polyline vertices: {diagnostics['decoded_polyline_vertices']:,}",
        f"Primitive edge occurrences: {diagnostics['primitive_edge_occurrences']:,}",
        f"Zero-length edges skipped: {diagnostics['zero_length_edges_skipped']:,}",
        f"Repeated edges deduplicated within OD routes: {diagnostics['repeated_edges_deduplicated']:,}",
        f"Unique exact undirected edges: {diagnostics['unique_exact_edges']:,}",
        f"Exact-collapse ratio: {diagnostics['exact_collapse_ratio']:.3f}",
        "Unique edges used by exactly 1 / 2+ / 5+ / 10+ / 50+ OD routes: " +
        " / ".join(f"{usage[key]:,}" for key in ("exactly_1", "2_plus", "5_plus", "10_plus", "50_plus")),
        f"Total seasonal trip weight represented: {diagnostics['total_seasonal_trip_weight_represented']:,}",
        "Weighted unique route-edge memberships: "
        f"{diagnostics['weighted_unique_route_edge_memberships']:,}",
        "Edge trip-count min / median / p90 / p95 / p99 / max: " +
        " / ".join(f"{weights[key]:,.1f}" for key in ("min", "median", "p90", "p95", "p99", "max")),
        "Phase timings (seconds): " + ", ".join([
            f"route loading={route_load_seconds:.3f}",
            f"primitive-edge extraction={diagnostics['primitive_edge_extraction_seconds']:.3f}",
            f"exact-edge aggregation={diagnostics['exact_edge_aggregation_seconds']:.3f}",
        ]),
    ]) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("year", type=int)
    parser.add_argument("--data", type=Path, default=Path("site/data"))
    parser.add_argument("--routes", type=Path, default=Path("site/routes"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--exact-edges-only", action="store_true",
                        help="measure exact E5 primitive-edge collapse and skip corridor output")
    parser.add_argument("--exact-edges-summary", type=Path,
                        help="compact JSON statistics destination for --exact-edges-only")
    parser.add_argument("--minimum-trips", type=int, default=1)
    route_limit = parser.add_mutually_exclusive_group()
    route_limit.add_argument("--max-routes", type=int,
                             help="process only the first N routed OD records (diagnostic only)")
    route_limit.add_argument("--sample-routes", type=int,
                             help="evenly sample N routed OD records (diagnostic only)")
    args = parser.parse_args(argv)
    if (args.minimum_trips < 1 or
            args.max_routes is not None and args.max_routes < 1 or
            args.sample_routes is not None and args.sample_routes < 1):
        parser.error("minimum trips and route limits (when set) must be positive")
    output = args.output or Path("site/corridors") / f"{args.year}.json"
    overall_start = time.perf_counter()
    phase_start = time.perf_counter()
    try:
        paths, trips, excluded = seasonal_trips(args.data, args.year)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    seasonal_seconds = log_phase("loading seasonal OD totals", phase_start, overall_start)
    phase_start = time.perf_counter()
    records, missing = load_routes(args.routes, trips, None, args.minimum_trips,
                                   args.max_routes, args.sample_routes, project=False)
    route_load_seconds = log_phase("loading/decoding route geometries", phase_start, overall_start)
    vertex_count = sum(len(record["coordinates_e5"]) for record in records)
    edge_count = sum(max(0, len(record["coordinates_e5"]) - 1) for record in records)
    print(f"Build workload: {len(records):,} routed OD geometries, {vertex_count:,} vertices, "
          f"{edge_count:,} primitive edges; {sum(count < args.minimum_trips for count in trips.values()):,} "
          f"OD pairs excluded by minimum trips", flush=True)
    if args.exact_edges_only:
        diagnostics = {}
        build_exact_edges(records, diagnostics)
        report = exact_edges_report(diagnostics, route_load_seconds)
        print(report, end="", flush=True)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(report, encoding="utf-8")
        summary = args.exact_edges_summary or Path("output") / f"{args.year}-exact-edges-summary.json"
        summary.parent.mkdir(parents=True, exist_ok=True)
        summary.write_text(json.dumps({"year": args.year, **diagnostics}, indent=2) + "\n", encoding="utf-8")
        print(f"Exact-edge summary written to {summary}", flush=True)
        return 0
    diagnostics = {}
    phase_start = time.perf_counter()
    exact_edges = build_exact_edges(records, diagnostics)
    exact_seconds = time.perf_counter() - phase_start
    phase_start = time.perf_counter()
    chains = merge_exact_edges(exact_edges, diagnostics)
    merge_seconds = log_phase("constructing graph / merging exact edges", phase_start, overall_start)
    phase_start = time.perf_counter()
    payload = exact_output_payload(args.year, chains)
    encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encoded)
    output_seconds = log_phase("encoding/writing the final output", phase_start, overall_start)
    weights = sorted(row[1] for row in payload["corridors"])
    minimum_excluded = [count for count in trips.values() if count < args.minimum_trips]
    edge_stats = diagnostics["chain_edge_count_distribution"]
    vertex_stats = diagnostics["chain_vertex_count_distribution"]
    lines = [f"Year: {args.year}", "Monthly files: " + ", ".join(path.name for path in paths),
             f"Directed OD pairs with trips: {len(trips):,}", f"Seasonal trips in OD pairs: {sum(trips.values()):,}",
             f"Same-station OD rows excluded: {excluded:,}", f"Routed OD pairs found: {len(records):,}",
             f"OD pairs below minimum trips: {len(minimum_excluded):,}",
             f"Trips below minimum trips: {sum(minimum_excluded):,}",
             f"Missing route geometries: {len(missing):,}", f"Input route geometries processed: {len(records):,}",
             f"Maximum routes diagnostic limit: {args.max_routes if args.max_routes is not None else 'unlimited'}",
             f"Evenly sampled routes diagnostic limit: {args.sample_routes if args.sample_routes is not None else 'disabled'}",
             f"Decoded polyline vertices: {vertex_count:,}", f"Primitive polyline edges: {edge_count:,}",
             f"Unique exact weighted edges before merging: {len(exact_edges):,}",
             f"Merged corridor polylines after merging: {len(chains):,}",
             f"Edges absorbed into multi-edge chains: {diagnostics['edges_absorbed_into_multi_edge_chains']:,} "
             f"({diagnostics['edges_absorbed_percentage']:.1f}%)",
             "Chain edge-count min / median / p90 / p95 / max: " + " / ".join(
                 f"{edge_stats[key]:,.1f}" for key in ("min", "median", "p90", "p95", "max")),
             "Chain vertex-count min / median / p90 / p95 / max: " + " / ".join(
                 f"{vertex_stats[key]:,.1f}" for key in ("min", "median", "p90", "p95", "max"))]
    if weights:
        lines.append("Corridor trips min / median / p90 / p95 / max: " + " / ".join(map(lambda n: f"{n:,}",
            [weights[0], round(statistics.median(weights)), percentile(weights, .9), percentile(weights, .95), weights[-1]])))
    for threshold in (10, 50, 100, 500, 1000):
        lines.append(f"Corridors >= {threshold:,}: {sum(value >= threshold for value in weights):,}")
    lines += [f"Output file size: {len(encoded):,} bytes", f"Estimated gzip size: {len(gzip.compress(encoded)):,} bytes",
              "Phase timings (seconds): " + ", ".join([
                  f"seasonal totals={seasonal_seconds:.3f}", f"route loading={route_load_seconds:.3f}",
                  f"primitive-edge extraction={diagnostics['primitive_edge_extraction_seconds']:.3f}",
                  f"exact aggregation={diagnostics['exact_edge_aggregation_seconds']:.3f}",
                  f"exact collapse total={exact_seconds:.3f}",
                  f"graph construction / merging={merge_seconds:.3f}",
                  f"encoding/output={output_seconds:.3f}"]),
              f"Total runtime: {format_duration(time.perf_counter() - overall_start)}"]
    report = "\n".join(lines) + "\n"
    print(report, end="", flush=True)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(report, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
