import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-data-index.py")
SPEC = importlib.util.spec_from_file_location("build_data_index", SCRIPT)
build_data_index = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_data_index)


class BuildDataIndexTests(unittest.TestCase):
    def test_indexes_real_months_in_date_order_and_ignores_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            data_directory = Path(directory)
            (data_directory / "later.json").write_text(json.dumps({"v": 1, "y": 2025, "m": 5}))
            (data_directory / "earlier.json").write_text(json.dumps({"v": 1, "y": 2025, "m": 4}))
            (data_directory / "sample-month.json").write_text(json.dumps({"v": 1, "y": 2099, "m": 1}))

            result = build_data_index.build_index(data_directory)

        self.assertEqual([item["file"] for item in result], ["earlier.json", "later.json"])

    def test_rejects_invalid_month_data(self):
        with tempfile.TemporaryDirectory() as directory:
            data_directory = Path(directory)
            (data_directory / "broken.json").write_text(json.dumps({"v": 1, "y": 2025, "m": 13}))

            with self.assertRaisesRegex(ValueError, "cannot index"):
                build_data_index.build_index(data_directory)


if __name__ == "__main__":
    unittest.main()
