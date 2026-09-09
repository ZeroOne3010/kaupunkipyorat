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
        self.assertEqual(result["fastest"]["origin"], 2)
        self.assertEqual(result["longestRoundTrip"]["origin"], 4)
        self.assertNotIn("speed", result["fastest"])


if __name__ == "__main__":
    unittest.main()
