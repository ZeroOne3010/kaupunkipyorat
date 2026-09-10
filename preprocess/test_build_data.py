import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-data.py")
SPEC = importlib.util.spec_from_file_location("build_data", SCRIPT)
build_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_data)


class BuildDataTests(unittest.TestCase):
    def build_csv(self, contents):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rides.csv"
            source.write_text(contents, encoding="utf-8")
            warnings = io.StringIO()
            with contextlib.redirect_stderr(warnings):
                result, stats = build_data.build(source)
        return result, stats, warnings.getvalue()

    def test_rejected_first_row_does_not_choose_month(self):
        result, stats, warnings = self.build_csv(
            "Departure,Departure station id,Return station id,Covered distance (m),Duration (sec.)\n"
            "2025-06-30T23:00:00,bad,2,100,60\n"
            "2025-07-01T00:00:00,1,2,200,120\n"
        )

        self.assertEqual((result["y"], result["m"]), (2025, 7))
        self.assertEqual(result["total"], [[1, 2, 1, 120, 200]])
        self.assertEqual(stats[:3], (2, 1, 1))
        self.assertIn("warning: row 2", warnings)

    def test_documented_finnish_duration_header(self):
        result, _, _ = self.build_csv(
            "Lähtöaika;Lähtöaseman ID;Palautusaseman ID;Matkan pituus (m);Matkan kesto (s)\n"
            "1.7.2025 06:01;2;3;1000;567\n"
        )

        self.assertEqual(result["total"], [[2, 3, 1, 567, 1000]])

    def test_fractional_distance_is_rounded_to_nearest_meter(self):
        result, stats, warnings = self.build_csv(
            "Departure,Departure station id,Return station id,Covered distance (m),Duration (sec.)\n"
            "2025-07-01T00:00:00,1,2,6758.33,120\n"
        )

        self.assertEqual(result["total"], [[1, 2, 1, 120, 6758]])
        self.assertEqual(stats[:3], (1, 1, 0))
        self.assertEqual(warnings, "")


if __name__ == "__main__":
    unittest.main()
