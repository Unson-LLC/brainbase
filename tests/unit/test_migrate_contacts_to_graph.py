import importlib.util
import os
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "..", "scripts",
                      "migrate_contacts_to_graph.py")
SPEC = importlib.util.spec_from_file_location("contact_import", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ContactImportTest(unittest.TestCase):
    def test_id_is_stable_by_source_file(self):
        a = {"name": "A", "email": "a@x.test", "source_file": "card.JPG"}
        b = {"name": "B", "email": "b@x.test", "source_file": "CARD.jpg"}
        self.assertEqual(MODULE.contact_id(a), MODULE.contact_id(b))

    def test_id_falls_back_to_normalized_email(self):
        self.assertEqual(
            MODULE.contact_id({"email": " A@X.TEST "}),
            MODULE.contact_id({"email": "a@x.test"}),
        )

    def test_deduplicates_and_keeps_latest_nonempty_values(self):
        contacts, count = MODULE.deduplicate([
            {"name": "A", "source_file": "same.png", "title": "old"},
            {"name": "A", "source_file": "SAME.PNG", "title": "new"},
        ])
        self.assertEqual((len(contacts), count, contacts[0]["title"]), (1, 1, "new"))

    def test_discovery_excludes_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ("scanned_2026-07.csv", "scanned_2026-07.csv.backup.1",
                         "notes.csv"):
                open(os.path.join(directory, name), "w").close()
            found = [os.path.basename(path)
                     for path in MODULE.discover_csv_files(directory)]
        self.assertEqual(found, ["scanned_2026-07.csv"])


if __name__ == "__main__":
    unittest.main()
