#!/usr/bin/env python3
"""Import canonical business-card CSVs as Graph SSOT contact extensions."""

import argparse
import csv
import glob
import hashlib
import json
import os
import re
import sys
import unicodedata

DEFAULT_DIR = os.path.expanduser("~/workspace/common/meta/contacts/data")
LEGACY_DIR = os.path.expanduser("~/workspace/_codex/common/meta/contacts/data")


def norm(value):
    return unicodedata.normalize("NFKC", value or "").strip()


def contact_key(contact):
    source = os.path.basename(norm(contact.get("source_file"))).lower()
    if source:
        return f"source:{source}"
    email = norm(contact.get("email")).lower()
    if email:
        return f"email:{email}"
    identity = "|".join(
        norm(contact.get(key)).lower()
        for key in ("name", "company_name", "department", "title")
    )
    if identity.strip("|"):
        return f"identity:{identity}"
    raise ValueError("contact has no stable identity")


def contact_id(contact):
    digest = hashlib.sha256(contact_key(contact).encode()).hexdigest()[:26]
    return f"cnt_{digest}"


def normalize_row(row, csv_name):
    fields = {
        "company_name": "会社名", "department": "部署名", "title": "役職",
        "name": "氏名", "email": "e-mail", "postal_code": "郵便番号",
        "address": "住所", "tel_company": "TEL会社", "tel_direct": "TEL直通",
        "mobile": "携帯電話", "fax": "Fax", "url": "URL",
        "scanned_at": "スキャン日", "exchanged_at": "名刺交換日",
        "source_file": "ソースファイル", "notes": "備考",
    }
    payload = {key: norm(row.get(column)) for key, column in fields.items()}
    if payload.get("email"):
        payload["email"] = payload["email"].lower()
    payload.update(
        source_csv=csv_name,
        source_type="eight" if csv_name.startswith("eight_") else "scanned",
    )
    return {key: value for key, value in payload.items() if value}


def read_csv(path, skip_lines=0):
    contacts = []
    with open(path, encoding="utf-8-sig", newline="") as handle:
        for _ in range(skip_lines):
            next(handle)
        for row in csv.DictReader(handle):
            if any(row.values()):
                contact = normalize_row(row, os.path.basename(path))
                if contact.get("name"):
                    contacts.append(contact)
    return contacts


def discover_csv_files(directory):
    paths = []
    for pattern in ("scanned_*.csv", "eight_*.csv"):
        paths.extend(glob.glob(os.path.join(directory, pattern)))
    return sorted(
        path for path in paths
        if not re.search(r"\.backup(?:\.|$)", os.path.basename(path))
    )


def deduplicate(contacts):
    unique = {}
    duplicates = 0
    for contact in contacts:
        key = contact_key(contact)
        if key in unique:
            duplicates += 1
            unique[key].update({k: v for k, v in contact.items() if v})
        else:
            unique[key] = contact
    return list(unique.values()), duplicates


def contacts_dir(explicit=None):
    if explicit:
        return os.path.expanduser(explicit)
    if os.getenv("BRAINBASE_CONTACTS_DIR"):
        return os.path.expanduser(os.environ["BRAINBASE_CONTACTS_DIR"])
    return DEFAULT_DIR if os.path.isdir(DEFAULT_DIR) else LEGACY_DIR


def db_url():
    value = os.getenv("INFO_SSOT_DATABASE_URL") or os.getenv("INFO_SSOT_DB_URL")
    if not value:
        raise RuntimeError("INFO_SSOT_DATABASE_URL is not set")
    return value


def write_contacts(contacts, dry_run=False):
    result = {"inserted": 0, "updated": 0, "unchanged": 0,
              "existing_duplicate_groups": 0}
    if dry_run:
        return result

    import psycopg2
    connection = psycopg2.connect(db_url())
    try:
        with connection:
            with connection.cursor() as cursor:
                for contact in contacts:
                    stable_id = contact_id(contact)
                    matches = []
                    if contact.get("source_file"):
                        cursor.execute(
                            """SELECT id, payload FROM graph_entities
                               WHERE entity_type='contact'
                                 AND LOWER(payload->>'source_file')=LOWER(%s)
                               ORDER BY created_at, id""",
                            (contact["source_file"],),
                        )
                        matches = cursor.fetchall()
                    if not matches:
                        cursor.execute(
                            """SELECT id, payload FROM graph_entities
                               WHERE id=%s AND entity_type='contact'""",
                            (stable_id,),
                        )
                        match = cursor.fetchone()
                        matches = [match] if match else []
                    if len(matches) > 1:
                        result["existing_duplicate_groups"] += 1
                    if matches and matches[0][1] == contact:
                        result["unchanged"] += 1
                        continue
                    entity_id = matches[0][0] if matches else stable_id
                    cursor.execute(
                        """INSERT INTO graph_entities
                           (id, entity_type, project_id, payload, role_min,
                            sensitivity, created_at, updated_at)
                           VALUES (%s,'contact',NULL,%s,'member','internal',NOW(),NOW())
                           ON CONFLICT (id) DO UPDATE SET
                             payload=EXCLUDED.payload,
                             role_min=EXCLUDED.role_min,
                             sensitivity=EXCLUDED.sensitivity,
                             updated_at=NOW()
                           RETURNING (xmax=0)""",
                        (entity_id, json.dumps(contact, ensure_ascii=False)),
                    )
                    result["inserted" if cursor.fetchone()[0] else "updated"] += 1
    finally:
        connection.close()
    return result


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--contacts-dir")
    args = parser.parse_args(argv)
    paths = discover_csv_files(contacts_dir(args.contacts_dir))
    if not paths:
        raise RuntimeError("No contact CSV files found")
    rows = []
    for path in paths:
        found = read_csv(path, 3 if os.path.basename(path).startswith("eight_") else 0)
        print(f"{os.path.basename(path)}: {len(found)} rows")
        rows.extend(found)
    contacts, duplicates = deduplicate(rows)
    result = write_contacts(contacts, args.dry_run)
    print(
        f"mode={'dry-run' if args.dry_run else 'write'} csv_rows={len(rows)} "
        f"unique_contacts={len(contacts)} csv_duplicates={duplicates} "
        f"inserted={result['inserted']} updated={result['updated']} "
        f"unchanged={result['unchanged']} "
        f"existing_duplicate_groups={result['existing_duplicate_groups']}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
