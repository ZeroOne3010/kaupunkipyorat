import importlib.util
import io
import math
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location("build_weather", Path(__file__).with_name("build-weather.py"))
weather = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(weather)


class WeatherBuilderTests(unittest.TestCase):
    def response(self, year, overrides=None):
        overrides = overrides or {}
        times, columns = [], {name: [] for name in weather.MEASUREMENTS}
        for date in weather.requested_dates(year):
            for hour in range(24):
                times.append(f"{date.isoformat()}T{hour:02d}:00")
                row = overrides.get((date.isoformat(), hour), [10.0, 0.0, 4.0, 359.0 if hour % 2 else 1.0])
                for index, name in enumerate(weather.MEASUREMENTS):
                    columns[name].append(row[index])
        return {"hourly": {"time": times, **columns}}

    def test_normalizes_missing_values_without_losing_hour_positions(self):
        response = self.response(2025, {
            ("2025-04-01", 0): [4.2, 0.0, 3.1, 359],
            ("2025-04-01", 1): [3.9, None, 2.8, 1],
            ("2025-04-01", 2): [None, None, None, None],
            ("2025-04-01", 3): [3.7, 0.0, None, None],
        })
        warnings = io.StringIO()
        result = weather.normalize_city(2025, response, "helsinki", warnings)
        day = result["days"]["2025-04-01"]

        self.assertEqual(len(day["h"]), 24)
        self.assertEqual(day["h"][:4], [[4.2, 0.0, 3.1, 359], [3.9, None, 2.8, 1], [], [3.7, 0.0, None, None]])
        self.assertIn("precipitation available for 22/24 hours", warnings.getvalue())
        self.assertAlmostEqual(day["d"][0], 9.2)
        self.assertEqual(day["d"][3], 0.0)
        self.assertTrue(day["d"][5] in (0, 360))

    def test_monthly_values_are_aggregated_from_hourly_observations(self):
        response = self.response(2025)
        # One extreme valid value proves the monthly mean is hourly weighted.
        response["hourly"]["temperature_2m"][0] = 34
        result = weather.normalize_city(2025, response, "espoo", io.StringIO())
        april_hours = 30 * 24
        self.assertEqual(result["months"]["04"][0], round((10 * (april_hours - 1) + 34) / april_hours, 1))
        self.assertEqual(result["months"]["04"][1:4], [10.0, 34, 0.0])

    def test_validation_rejects_non_finite_values_and_bad_tuple_shapes(self):
        response = self.response(2025)
        payload = {"v": 1, "year": 2025, "cities": {
            city: weather.normalize_city(2025, response, city, io.StringIO()) for city in weather.CITIES
        }}
        weather.validate(payload)
        payload["cities"]["espoo"]["days"]["2025-04-01"]["h"][0][0] = math.inf
        with self.assertRaisesRegex(ValueError, "invalid hourly value"):
            weather.validate(payload)

    def test_build_fetches_exactly_helsinki_and_espoo(self):
        calls = []
        def fetcher(year, coordinates):
            calls.append((year, coordinates))
            return self.response(year)

        payload = weather.build(2025, fetcher, io.StringIO())
        self.assertEqual(calls, [(2025, weather.CITIES["helsinki"]), (2025, weather.CITIES["espoo"])])
        weather.validate(payload)

    def test_fetch_uses_the_helsinki_clock_matching_trip_buckets(self):
        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return None
            def read(self):
                return b'{"hourly": {}}'

        with mock.patch.object(weather.urllib.request, "urlopen", return_value=Response()) as urlopen:
            weather.fetch_city(2025, weather.CITIES["helsinki"])
        query = urllib.parse.parse_qs(urllib.parse.urlparse(urlopen.call_args.args[0].full_url).query)
        self.assertEqual(query["timezone"], ["Europe/Helsinki"])
        self.assertEqual(query["start_date"], ["2025-04-01"])
        self.assertEqual(query["end_date"], ["2025-10-31"])


if __name__ == "__main__":
    unittest.main()
