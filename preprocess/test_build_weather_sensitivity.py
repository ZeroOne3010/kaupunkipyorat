import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("build_weather_sensitivity", Path(__file__).with_name("build-weather-sensitivity.py"))
sensitivity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sensitivity)


class WeatherSensitivityBuilderTests(unittest.TestCase):
    def test_builds_station_values_and_counts_round_trips_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            days = {}
            for day in range(1, 21):
                precipitation = 0.5 if day <= 10 else 1
                days[f"2025-04-{day:02d}"] = {"d": [0, 0, 0, precipitation]}
            weather = {"v": 1, "year": 2025, "cities": {city: {"days": days} for city in ("espoo", "helsinki")}}
            (root / "weather.json").write_text(json.dumps(weather))
            for month in sensitivity.SEASON_MONTHS:
                daily = [[[1, 1, 5], [1, 2, 5]]] * 20 if month == 4 else []
                (root / f"2025-{month:02d}.json").write_text(json.dumps({"v": 1, "y": 2025, "m": month, "d": daily}))

            result = sensitivity.build(2025, root, root / "weather.json", [[1, "West", 60, 24], [2, "East", 60, 25]])

        self.assertEqual(result["v"], 1)
        self.assertEqual(result["stations"]["1"]["dryAverage"], 10)
        self.assertEqual(result["stations"]["1"]["rainyAverage"], 10)
        self.assertEqual(result["stations"]["1"]["value"], 0)
        self.assertEqual(result["stations"]["1"]["normalized"], 0)
        self.assertEqual(result["stations"]["2"]["dryCount"], 10)

    def test_marks_too_few_samples_unavailable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            days = {f"2025-04-{day:02d}": {"d": [0, 0, 0, day % 2]} for day in range(1, 19)}
            (root / "weather.json").write_text(json.dumps({"v": 1, "year": 2025, "cities": {"helsinki": {"days": days}}}))
            for month in sensitivity.SEASON_MONTHS:
                daily = [[]] * 18 if month == 4 else []
                (root / f"2025-{month:02d}.json").write_text(json.dumps({"v": 1, "y": 2025, "m": month, "d": daily}))
            result = sensitivity.build(2025, root, root / "weather.json", [[1, "Station", 60, 25]])
        self.assertIsNone(result["stations"]["1"]["value"])
        self.assertIsNone(result["stations"]["1"]["normalized"])

    def test_loads_generated_station_javascript(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "stations.js"
            path.write_text("// generated\nconst STATIONS = [\n  [1, \"One\", 60, 25]\n];\n")
            self.assertEqual(sensitivity.load_stations(path)[0][1], "One")


if __name__ == "__main__":
    unittest.main()
