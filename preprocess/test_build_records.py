import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("build-records.py")
SPEC = importlib.util.spec_from_file_location("build_records", SCRIPT)
records = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(records)
HEADER = "Departure,Departure station id,Return station id,Covered distance (m),Duration (sec.)\n"


class BuildRecordsTests(unittest.TestCase):
    def test_selects_records_without_storing_speed(self):
        rows = ["2025-06-01T10:00:00,1,2,1000,300", "2025-06-02T10:00:00,2,3,2000,300", "2025-06-03T10:00:00,4,4,5000,1200"]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "june.csv"
            source.write_text(HEADER + "\n".join(rows))
            result = records.build(source)
        self.assertEqual(result["fastest"][0]["origin"], 2)
        self.assertEqual(result["longestRoundTrip"][0]["origin"], 4)
        self.assertNotIn("speed", result["fastest"][0])

    def test_invalid_first_ride_does_not_choose_the_month(self):
        rows = ["2024-05-01T10:00:00,invalid,2,1000,300", "2025-06-02T10:00:00,2,3,2000,300"]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rides.csv"
            source.write_text(HEADER + "\n".join(rows))
            result = records.build(source)
        self.assertEqual((result["y"], result["m"]), (2025, 6))

    def test_keeps_five_and_excludes_long_rides_and_round_trip_from_quickest(self):
        rows = [f"2025-06-{day:02d}T10:00:00,{day},{day + 1},1000,{day * 60}" for day in range(1, 8)]
        rows += ["2025-06-08T10:00:00,8,8,1000,60", "2025-06-09T10:00:00,9,10,999999,86401"]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rides.csv"
            source.write_text(HEADER + "\n".join(rows))
            result, stats = records.build(source, return_stats=True)
        self.assertEqual(len(result["shortestDuration"]), 5)
        self.assertEqual([ride["origin"] for ride in result["shortestDuration"]], [1, 2, 3, 4, 5])
        self.assertTrue(all(ride["durationS"] <= 86400 for rides in list(result.values())[3:] for ride in rides))
        self.assertEqual(stats, {"considered": 9, "excludedLong": 1})

    def test_only_invalid_rides_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rides.csv"
            source.write_text(HEADER + "2025-06-01T10:00:00,1,2,bad,300\n")
            with self.assertRaisesRegex(ValueError, "no valid rides found"):
                records.build(source)


if __name__ == "__main__":
    unittest.main()
