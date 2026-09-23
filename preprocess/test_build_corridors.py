import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

DEPENDENCIES = importlib.util.find_spec("shapely") and importlib.util.find_spec("pyproj")
if DEPENDENCIES:
    from shapely.geometry import LineString
    spec = importlib.util.spec_from_file_location("build_corridors", Path(__file__).with_name("build-corridors.py"))
    corridors = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(corridors)


@unittest.skipUnless(DEPENDENCIES, "Shapely and pyproj are required")
class BuildCorridorsTests(unittest.TestCase):
    def aggregate(self, definitions, tolerance=1):
        records = [{"od": (index, index + 1), "weight": weight, "line": LineString(points)}
                   for index, (points, weight) in enumerate(definitions)]
        return corridors.aggregate_corridors(records, tolerance)[0]

    def weights(self, definitions, tolerance=1):
        return sorted(weight for _, weight in self.aggregate(definitions, tolerance))

    def test_google_polyline_round_trip(self):
        points = [(24.94123, 60.17111), (24.94234, 60.17222), (24.94444, 60.17123)]
        self.assertEqual(corridors.decode_polyline(corridors.encode_polyline(points)), points)

    def test_e5_decoder_preserves_exact_integer_coordinates(self):
        encoded = corridors.encode_polyline([(24.94123, 60.17111), (24.94124, 60.17112)])
        self.assertEqual(corridors.decode_polyline_e5(encoded),
                         [(2494123, 6017111), (2494124, 6017112)])

    def test_consecutive_vertices_make_canonical_primitive_edges(self):
        points = [(3, 1), (2, 1), (4, 5), (7, 8)]
        self.assertEqual(list(corridors.primitive_edges(points)),
                         [((2, 1), (3, 1)), ((2, 1), (4, 5)), ((4, 5), (7, 8))])

    def test_exact_edges_collapse_directions_and_identical_edges(self):
        records = [
            {"coordinates_e5": [(1, 1), (2, 2)], "weight": 3},
            {"coordinates_e5": [(2, 2), (1, 1)], "weight": 5},
            {"coordinates_e5": [(1, 1), (2, 2)], "weight": 7},
        ]
        edges = corridors.build_exact_edges(records)
        self.assertEqual(edges, [{"edge": ((1, 1), (2, 2)), "weight": 15, "route_count": 3}])

    def test_curved_polyline_preserves_all_primitive_edges(self):
        points = [(0, 0), (1, 3), (2, 1), (4, 4)]
        edges = corridors.build_exact_edges([{"coordinates_e5": points, "weight": 2}])
        self.assertEqual([edge["edge"] for edge in edges], sorted(corridors.primitive_edges(points)))
        self.assertEqual(len(edges), 3)

    def test_route_repeated_edge_is_weighted_only_once(self):
        diagnostics = {}
        edges = corridors.build_exact_edges([
            {"coordinates_e5": [(0, 0), (1, 0), (0, 0), (1, 0)], "weight": 9}
        ], diagnostics)
        self.assertEqual(edges[0]["weight"], 9)
        self.assertEqual(edges[0]["route_count"], 1)
        self.assertEqual(diagnostics["repeated_edges_deduplicated"], 2)

    def test_partially_shared_exact_edges_accumulate_correct_weights(self):
        diagnostics = {}
        records = [
            {"coordinates_e5": [(0, 0), (1, 0), (2, 0)], "weight": 4},
            {"coordinates_e5": [(1, 0), (2, 0), (3, 1)], "weight": 6},
        ]
        edges = {edge["edge"]: edge["weight"]
                 for edge in corridors.build_exact_edges(records, diagnostics)}
        self.assertEqual(edges, {((0, 0), (1, 0)): 4, ((1, 0), (2, 0)): 10,
                                 ((2, 0), (3, 1)): 6})
        self.assertEqual(diagnostics["total_seasonal_trip_weight_represented"], 10)
        self.assertEqual(diagnostics["weighted_primitive_edge_traversals"], 20)

    def test_zero_length_edges_are_skipped_and_reported(self):
        diagnostics = {}
        edges = corridors.build_exact_edges([
            {"coordinates_e5": [(1, 1), (1, 1), (2, 2)], "weight": 3}
        ], diagnostics)
        self.assertEqual(len(edges), 1)
        self.assertEqual(diagnostics["primitive_edge_occurrences"], 2)
        self.assertEqual(diagnostics["zero_length_edges_skipped"], 1)

    def test_exact_matching_has_no_floating_point_tolerance(self):
        edges = corridors.build_exact_edges([
            {"coordinates_e5": [(0, 0), (1, 0)], "weight": 2},
            {"coordinates_e5": [(0, 1), (1, 1)], "weight": 3},
        ])
        self.assertEqual(len(edges), 2)

    def test_identical_and_opposite_routes_overlap(self):
        line = [(0, 0), (10, 0)]
        self.assertEqual(self.weights([(line, 5), (line, 7)]), [12])
        self.assertEqual(self.weights([(line, 5), (list(reversed(line)), 7)]), [12])

    def test_curved_routes_with_different_vertex_spacing_match(self):
        sparse = [(0, 0), (5, 2), (10, 0)]
        dense = [(0, 0), (2.5, 1), (5, 2), (7.5, 1), (10, 0)]
        self.assertEqual(self.weights([(sparse, 11), (dense, 13)], .1), [24])

    def test_partial_overlap_splits_at_branch(self):
        result = self.aggregate([([(0, 0), (10, 0)], 10), ([(0, 0), (5, 0), (5, 5)], 4)], .1)
        weights = [weight for _, weight in result]
        self.assertIn(14, weights)
        self.assertIn(10, weights)
        self.assertIn(4, weights)

    def test_branching_routes_have_exact_post_branch_weights(self):
        result = self.weights([([(0, 0), (5, 0), (10, 3)], 3), ([(0, 0), (5, 0), (10, -3)], 7)], .1)
        self.assertEqual(result, [3, 7, 10])

    def test_separate_parallel_routes_are_not_merged(self):
        self.assertEqual(self.weights([([(0, 0), (10, 0)], 2), ([(0, 5), (10, 5)], 8)], 4), [2, 8])

    def test_non_transitive_parallel_membership_preserves_every_route(self):
        result = self.weights([([(0, 0), (10, 0)], 2),
                               ([(0, 3), (10, 3)], 4),
                               ([(0, 6), (10, 6)], 8)], 4)
        self.assertEqual(result, [6, 12, 14])

    def test_perpendicular_crossing_routes_do_not_share_weight_or_leave_gaps(self):
        result = self.aggregate([([(-10, 0), (10, 0)], 3),
                                 ([(0, -10), (0, 10)], 7)], 4)
        self.assertEqual(sorted(weight for _, weight in result), [3, 7])
        self.assertEqual(sorted(round(line.length) for line, _ in result), [20, 20])

    def test_same_station_excluded_and_missing_route_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); data = root / "data"; routes = root / "routes"
            data.mkdir(); routes.mkdir()
            for month in range(4, 11):
                (data / f"2025-{month:02d}.json").write_text(json.dumps({"total": [[1, 1, 9], [1, 2, 3]]}))
            _, trips, excluded = corridors.seasonal_trips(data, 2025)
            loaded, missing = corridors.load_routes(routes, trips, type("T", (), {"transform": staticmethod(lambda x, y: (x, y))})())
            self.assertEqual(trips, {(1, 2): 21})
            self.assertEqual(excluded, 7)
            self.assertEqual(loaded, [])
            self.assertEqual(missing, [(1, 2)])

    def test_max_routes_limits_successful_routes_in_deterministic_order(self):
        with tempfile.TemporaryDirectory() as directory:
            routes = Path(directory)
            encoded = corridors.encode_polyline([(0, 0), (1, 0)])
            (routes / "1.json").write_text(json.dumps({"out": {"2": {"p": encoded},
                                                                  "3": {"p": encoded}}}))
            (routes / "2.json").write_text(json.dumps({"out": {"3": {"p": encoded}}}))
            trips = {(2, 3): 4, (1, 3): 5, (1, 2): 6}
            identity = type("T", (), {"transform": staticmethod(lambda x, y: (x, y))})()
            limited, _ = corridors.load_routes(routes, trips, identity, max_routes=2)
            unlimited, _ = corridors.load_routes(routes, trips, identity)
            self.assertEqual([record["od"] for record in limited], [(1, 2), (1, 3)])
            self.assertEqual([record["od"] for record in unlimited], [(1, 2), (1, 3), (2, 3)])

    def test_even_sampling_is_deterministic_exact_and_ordered(self):
        records = list(range(20))
        expected = [0, 4, 8, 12, 16]
        self.assertEqual(corridors.evenly_sample(records, 5), expected)
        self.assertEqual(corridors.evenly_sample(records, 5), expected)
        self.assertEqual(len(corridors.evenly_sample(records, 7)), 7)
        self.assertEqual(corridors.evenly_sample(records, 7),
                         sorted(corridors.evenly_sample(records, 7)))

    def test_even_sampling_larger_than_available_returns_all(self):
        records = list(range(4))
        self.assertIs(corridors.evenly_sample(records, 10), records)

    def test_sampling_happens_before_unselected_polylines_are_decoded(self):
        with tempfile.TemporaryDirectory() as directory:
            routes = Path(directory)
            valid = corridors.encode_polyline([(0, 0), (1, 0)])
            destinations = {str(index): {"p": (valid if index in (1, 3) else "invalid")}
                            for index in range(1, 5)}
            (routes / "0.json").write_text(json.dumps({"out": destinations}))
            trips = {(0, index): 1 for index in range(1, 5)}
            identity = type("T", (), {"transform": staticmethod(lambda x, y: (x, y))})()
            loaded, missing = corridors.load_routes(routes, trips, identity, sample_routes=2)
            self.assertEqual([record["od"] for record in loaded], [(0, 1), (0, 3)])
            self.assertEqual(missing, [])

    def test_no_route_limit_keeps_all_records(self):
        records = list(range(12))
        self.assertEqual(corridors.evenly_sample(records, len(records)), records)

    def test_route_limit_options_are_mutually_exclusive(self):
        with self.assertRaises(SystemExit):
            corridors.main(["2025", "--max-routes", "2", "--sample-routes", "2"])

    def test_distribution_statistics(self):
        result = corridors.distribution([1, 2, 3, 4, 100])
        self.assertEqual(result["min"], 1)
        self.assertEqual(result["median"], 3)
        self.assertEqual(result["mean"], 22)
        self.assertEqual(result["max"], 100)

    def test_output_is_deterministic(self):
        inverse = type("T", (), {"transform": staticmethod(lambda x, y: (x, y))})()
        lines = [(LineString([(2, 2), (1, 1)]), 4), (LineString([(0, 0), (1, 0)]), 9)]
        first = json.dumps(corridors.output_payload(2025, 4, lines, inverse), separators=(",", ":"))
        second = json.dumps(corridors.output_payload(2025, 4, list(reversed(lines)), inverse), separators=(",", ":"))
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
