import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location("build_routes", Path(__file__).with_name("build-routes.py"))
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class BuildRoutesTests(unittest.TestCase):
    def test_request_uses_plan_coordinate_inputs(self):
        response = io.BytesIO(json.dumps({
            "data": {"planConnection": {"edges": [{"node": {"legs": [{
                "distance": 123.4,
                "legGeometry": {"points": "abc"},
            }]}}]}},
        }).encode())

        with mock.patch.object(routes.urllib.request, "urlopen", return_value=response) as urlopen:
            result = routes.request_route(
                "https://example.test/graphql",
                "secret",
                [1, "One", 60.1, 24.9],
                [2, "Two", 60.2, 25.0],
            )

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data)
        self.assertIn("$from: PlanCoordinateInput!", payload["query"])
        self.assertIn("$to: PlanCoordinateInput!", payload["query"])
        self.assertEqual(payload["variables"], {
            "from": {"latitude": 60.1, "longitude": 24.9},
            "to": {"latitude": 60.2, "longitude": 25.0},
        })
        self.assertEqual(result, {"p": "abc", "d": 123})

    def test_discovers_deduplicated_sorted_routes_and_writes_incrementally(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "stations.js").write_text('const STATIONS = [[2,"Two",60,24],[1,"One",61,25],[3,"Three",62,26]];\n')
            data = root / "data"; data.mkdir()
            (data / "a.json").write_text(json.dumps({"total": [[2, 3, 2], [2, 1, 1], [2, 3, 5], [2, 2, 9]]}))
            calls = []
            def request(_endpoint, _key, origin, destination):
                calls.append((origin[0], destination[0]))
                return {"p": "abc", "d": destination[0] * 10}
            result = routes.main(["--stations", str(root / "stations.js"), "--data", str(data), "--output", str(root / "out"),
                                  "--subscription-key", "key", "--delay-ms", "0"], request_fn=request, sleep_fn=lambda _: None)
            self.assertEqual(result, 0)
            self.assertEqual(calls, [(2, 1), (2, 3)])
            payload = json.loads((root / "out/routes/2.json").read_text())
            self.assertEqual(payload["out"], {"1": {"p": "abc", "d": 10}, "3": {"p": "abc", "d": 30}})

    def test_retries_and_records_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "stations.js").write_text('const STATIONS = [[1,"One",60,24],[2,"Two",61,25]];\n')
            data = root / "data"; data.mkdir()
            (data / "a.json").write_text('{"total":[[1,2,1]]}')
            waits = []
            result = routes.main(["--stations", str(root / "stations.js"), "--data", str(data),
                                  "--output", str(root / "out"), "--subscription-key", "key"],
                                 request_fn=lambda *_: (_ for _ in ()).throw(ValueError("no route")),
                                 sleep_fn=waits.append)
            summary = json.loads((root / "out/routing-summary.json").read_text())
            self.assertEqual(result, 1)
            self.assertEqual(summary["failedRoutes"], [[1, 2]])
            self.assertTrue(summary["stoppedEarly"])
            self.assertEqual(summary["stationsProcessed"], 0)
            self.assertEqual(waits, [2, 5])

    def test_failure_limit_stops_before_trying_more_routes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "stations.js").write_text(
                'const STATIONS = [[1,"One",60,24],[2,"Two",61,25],[3,"Three",62,26]];\n')
            data = root / "data"; data.mkdir()
            (data / "a.json").write_text('{"total":[[1,2,1],[1,3,1]]}')
            calls = []

            def request(_endpoint, _key, origin, destination):
                calls.append((origin[0], destination[0]))
                raise ValueError("API unavailable")

            result = routes.main(
                ["--stations", str(root / "stations.js"), "--data", str(data),
                 "--output", str(root / "out"), "--subscription-key", "key",
                 "--max-consecutive-failures", "2"],
                request_fn=request,
                sleep_fn=lambda _: None,
            )

            summary = json.loads((root / "out/routing-summary.json").read_text())
            self.assertEqual(result, 1)
            self.assertEqual(calls, [(1, 2), (1, 2)])
            self.assertEqual(summary["routesAttempted"], 1)
            self.assertEqual(summary["failedRoutes"], [[1, 2]])
            self.assertEqual(summary["stopReason"], "reached 2 consecutive failed requests")


if __name__ == "__main__":
    unittest.main()
