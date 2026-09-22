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

    def test_output_is_deterministic(self):
        inverse = type("T", (), {"transform": staticmethod(lambda x, y: (x, y))})()
        lines = [(LineString([(2, 2), (1, 1)]), 4), (LineString([(0, 0), (1, 0)]), 9)]
        first = json.dumps(corridors.output_payload(2025, 4, lines, inverse), separators=(",", ":"))
        second = json.dumps(corridors.output_payload(2025, 4, list(reversed(lines)), inverse), separators=(",", ":"))
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
