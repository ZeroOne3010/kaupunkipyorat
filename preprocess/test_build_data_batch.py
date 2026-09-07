import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-data-batch.py")
SPEC = importlib.util.spec_from_file_location("build_data_batch", SCRIPT)
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)


HEADER = "Departure,Departure station id,Return station id,Covered distance (m),Duration (sec.)\n"


class BuildDataBatchTests(unittest.TestCase):
    def test_zip_builds_one_json_per_csv_month(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "months.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("nested/april.csv", HEADER + "2025-04-01T01:00:00,1,2,100,60\n")
                archive.writestr("may.CSV", HEADER + "2025-05-02T02:00:00,2,3,200,120\n")
                archive.writestr("readme.txt", "ignored")

            outputs = batch.build_all(source, root / "output")

            self.assertEqual([path.name for path in outputs], ["2025-04.json", "2025-05.json"])
            april = json.loads((root / "output/2025-04.json").read_text())
            may = json.loads((root / "output/2025-05.json").read_text())
            self.assertEqual(april["total"], [[1, 2, 1, 60, 100]])
            self.assertEqual(may["total"], [[2, 3, 1, 120, 200]])

    def test_duplicate_months_are_rejected_instead_of_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "months.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("one.csv", HEADER + "2025-04-01T01:00:00,1,2,100,60\n")
                archive.writestr("two.csv", HEADER + "2025-04-02T01:00:00,2,3,100,60\n")

            with self.assertRaisesRegex(ValueError, "more than one CSV contains month 2025-04"):
                batch.build_all(source, root / "output")


if __name__ == "__main__":
    unittest.main()
