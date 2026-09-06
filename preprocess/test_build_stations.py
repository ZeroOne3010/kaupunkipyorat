import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-stations.py")
SPEC = importlib.util.spec_from_file_location("build_stations", SCRIPT)
build_stations = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_stations)


class BuildStationsTests(unittest.TestCase):
    def test_normalizes_filters_sorts_and_renders_stations(self):
        payload = {
            "data": {
                "vehicleRentalStations": [
                    {"stationId": "other:1", "name": "Scooter", "lat": 60, "lon": 24},
                    {"stationId": "smoove:072", "name": 'Ääsi "asema"', "lat": 60.2, "lon": 24.8},
                    {"stationId": "smoove:001", "name": " First ", "lat": "60.1", "lon": "24.9"},
                ]
            }
        }

        stations = build_stations.parse_response(payload)

        self.assertEqual(stations, [[1, "First", 60.1, 24.9], [72, 'Ääsi "asema"', 60.2, 24.8]])
        output = build_stations.render(stations)
        self.assertIn('[1, "First", 60.1, 24.9]', output)
        self.assertIn('[72, "Ääsi \\"asema\\"", 60.2, 24.8]', output)
        self.assertFalse(output.splitlines()[-2].endswith(","))

    def test_rejects_duplicate_normalized_ids(self):
        station = {"name": "Duplicate", "lat": 60, "lon": 24}
        payload = {"data": {"vehicleRentalStations": [
            {**station, "stationId": "smoove:1"},
            {**station, "stationId": "smoove:001"},
        ]}}

        with self.assertRaisesRegex(ValueError, "duplicate normalized station ID: 1"):
            build_stations.parse_response(payload)

    def test_rejects_graphql_errors_and_invalid_station_fields(self):
        with self.assertRaisesRegex(ValueError, "GraphQL error: unavailable"):
            build_stations.parse_response({"errors": [{"message": "unavailable"}]})
        with self.assertRaisesRegex(ValueError, "invalid lat"):
            build_stations.normalize_station(
                {"stationId": "smoove:001", "name": "Station", "lat": None, "lon": 24}
            )
        with self.assertRaisesRegex(ValueError, "invalid Smoove station ID"):
            build_stations.normalize_station(
                {"stationId": "smoove:abc", "name": "Station", "lat": 60, "lon": 24}
            )

    def test_writes_output_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "nested" / "stations.js"
            build_stations.write_output(destination, "stations\n")
            self.assertEqual(destination.read_text(), "stations\n")
            self.assertFalse(destination.with_name(".stations.js.tmp").exists())


if __name__ == "__main__":
    unittest.main()
