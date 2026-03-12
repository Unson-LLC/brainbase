#!/usr/bin/env python3
"""
Contacts Migration Script
_codex/common/meta/contacts/data/*.csv → Postgres graph_entities

Usage:
    python scripts/migrate_contacts_to_graph.py [--dry-run]
"""

import os
import sys
import csv
import json
import psycopg2
from datetime import datetime
from ulid import ULID

# Environment
DATABASE_URL = os.getenv('INFO_SSOT_DATABASE_URL') or os.getenv('INFO_SSOT_DB_URL')
if not DATABASE_URL:
    print("Error: INFO_SSOT_DATABASE_URL is not set", file=sys.stderr)
    sys.exit(1)

# Paths
CODEX_BASE = os.path.expanduser('~/workspace/_codex')
CONTACTS_DIR = os.path.join(CODEX_BASE, 'common/meta/contacts/data')

CSV_FILES = [
    'eight_2024-12.csv',
    'scanned_2025-12.csv',
    'scanned_2026-01.csv'
]

def generate_contact_id():
    """Generate contact ID with cnt_ prefix"""
    return f"cnt_{ULID()}"

def normalize_csv_row(row, source_file):
    """Normalize CSV row to contact payload"""
    # Common fields
    payload = {
        'company_name': row.get('会社名', '').strip(),
        'department': row.get('部署名', '').strip(),
        'title': row.get('役職', '').strip(),
        'name': row.get('氏名', '').strip(),
        'email': row.get('e-mail', '').strip(),
        'postal_code': row.get('郵便番号', '').strip(),
        'address': row.get('住所', '').strip(),
        'tel_company': row.get('TEL会社', '').strip(),
        'tel_direct': row.get('TEL直通', '').strip(),
        'mobile': row.get('携帯電話', '').strip(),
        'fax': row.get('Fax', '').strip(),
        'url': row.get('URL', '').strip(),
        'source_file': source_file,
        'source_type': 'eight' if 'eight' in source_file else 'scanned'
    }

    # Optional fields
    if 'スキャン日' in row:
        payload['scanned_at'] = row.get('スキャン日', '').strip()
    if '名刺交換日' in row:
        payload['exchanged_at'] = row.get('名刺交換日', '').strip()
    if '備考' in row:
        payload['notes'] = row.get('備考', '').strip()

    # Remove empty values
    return {k: v for k, v in payload.items() if v}

def read_csv_file(filepath, skip_lines=0):
    """Read CSV file and return rows"""
    contacts = []
    filename = os.path.basename(filepath)

    with open(filepath, 'r', encoding='utf-8-sig') as f:
        # Skip metadata lines
        for _ in range(skip_lines):
            next(f)

        reader = csv.DictReader(f)
        for row in reader:
            # Skip empty rows
            if not any(row.values()):
                continue

            payload = normalize_csv_row(row, filename)
            if payload.get('name'):  # Must have name
                contacts.append(payload)

    return contacts

def insert_contacts_to_graph(contacts, dry_run=False):
    """Insert contacts into graph_entities"""
    if dry_run:
        print(f"[DRY RUN] Would insert {len(contacts)} contacts")
        for i, contact in enumerate(contacts[:5], 1):
            print(f"  {i}. {contact.get('name')} ({contact.get('company_name')})")
        if len(contacts) > 5:
            print(f"  ... and {len(contacts) - 5} more")
        return

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    inserted = 0
    skipped = 0

    for contact in contacts:
        try:
            contact_id = generate_contact_id()
            payload_json = json.dumps(contact, ensure_ascii=False)

            cur.execute("""
                INSERT INTO graph_entities (
                    id,
                    entity_type,
                    project_id,
                    payload,
                    role_min,
                    sensitivity,
                    created_at,
                    updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (id) DO NOTHING
            """, (
                contact_id,
                'contact',
                None,  # contacts are not project-specific
                payload_json,
                'member',  # accessible by all members
                'internal'  # internal sensitivity
            ))

            if cur.rowcount > 0:
                inserted += 1
            else:
                skipped += 1

        except Exception as e:
            print(f"Error inserting contact {contact.get('name')}: {e}", file=sys.stderr)
            skipped += 1

    conn.commit()
    cur.close()
    conn.close()

    print(f"✅ Inserted: {inserted}")
    print(f"⚠️  Skipped: {skipped}")
    print(f"📊 Total: {len(contacts)}")

def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("🔍 DRY RUN MODE - No changes will be made\n")

    all_contacts = []

    # Read all CSV files
    for csv_file in CSV_FILES:
        filepath = os.path.join(CONTACTS_DIR, csv_file)
        if not os.path.exists(filepath):
            print(f"⚠️  Skipping {csv_file} (not found)")
            continue

        # eight_2024-12.csv has 3 metadata lines
        skip_lines = 3 if 'eight' in csv_file else 0

        contacts = read_csv_file(filepath, skip_lines=skip_lines)
        print(f"📄 {csv_file}: {len(contacts)} contacts")
        all_contacts.extend(contacts)

    print(f"\n📊 Total contacts to import: {len(all_contacts)}\n")

    # Insert into database
    insert_contacts_to_graph(all_contacts, dry_run=dry_run)

    if dry_run:
        print("\n💡 Run without --dry-run to actually insert data")

if __name__ == '__main__':
    main()
