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
    def write_csv(self, directory, name, content):
        path = os.path.join(directory, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return path

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

    def test_reads_eight_csv_by_detecting_header_after_variable_preamble(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_csv(
                directory,
                "eight_2024-12.csv",
                "Eightで生成された名刺リストです。\n"
                "合計 1 件\n"
                "*注意事項\n"
                "\n"
                "\n"
                "会社名,部署名,役職,氏名,e-mail\n"
                "テスト株式会社,営業部,部長,佐藤太郎,TARO@EXAMPLE.COM\n",
            )
            contacts = MODULE.read_csv(path)

        self.assertEqual(
            contacts,
            [{
                "company_name": "テスト株式会社",
                "department": "営業部",
                "title": "部長",
                "name": "佐藤太郎",
                "email": "taro@example.com",
                "source_csv": "eight_2024-12.csv",
                "source_type": "eight",
            }],
        )

    def test_reads_scanned_csv_when_header_is_first_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_csv(
                directory,
                "scanned_2026-07.csv",
                "会社名,氏名,ソースファイル\n"
                "テスト株式会社,佐藤花子,card.pdf\n",
            )
            contacts = MODULE.read_csv(path)

        self.assertEqual(contacts[0]["name"], "佐藤花子")
        self.assertEqual(contacts[0]["source_file"], "card.pdf")

    def test_rejects_csv_without_contact_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_csv(
                directory,
                "eight_broken.csv",
                "Eightで生成された名刺リストです。\n合計 0 件\n",
            )
            with self.assertRaisesRegex(ValueError, "氏名"):
                MODULE.read_csv(path)

    def test_unique_matches_prefers_oldest_email_match_and_deduplicates_ids(self):
        old = ("con_legacy", {"email": "a@example.com"})
        stable = ("cnt_stable", {"email": "a@example.com"})
        self.assertEqual(
            MODULE.unique_matches([old, stable], [], [stable]),
            [old, stable],
        )


if __name__ == "__main__":
    unittest.main()
