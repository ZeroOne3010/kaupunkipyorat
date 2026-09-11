import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("build_routes", Path(__file__).with_name("build-routes.py"))
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class BuildRoutesTests(unittest.TestCase):
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
            routes.main(["--stations", str(root / "stations.js"), "--data", str(data), "--output", str(root / "out"),
                         "--subscription-key", "key"], request_fn=lambda *_: (_ for _ in ()).throw(ValueError("no route")), sleep_fn=waits.append)
            summary = json.loads((root / "out/routing-summary.json").read_text())
            self.assertEqual(summary["failedRoutes"], [[1, 2]])
            self.assertEqual(waits, [2, 5])


if __name__ == "__main__":
    unittest.main()
