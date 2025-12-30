#!/usr/bin/env python3
import os
import requests
from dotenv import load_dotenv

load_dotenv()

NOCODB_URL = os.getenv('NOCODB_URL')
NOCODB_TOKEN = os.getenv('NOCODB_TOKEN')

HEADERS = {
    "xc-token": NOCODB_TOKEN,
    "Content-Type": "application/json"
}

BASES = {
    'DialogAI': 'ptykrgx40t36l9y',
    'Aitle': 'pfai4c5n8nb7fk1',
    'SalesTailor': 'pqot58neiu3o1xo'
}

TARGET_TABLES = ['要求', '要件', 'バグ', 'アンケート']

for base_name, base_id in BASES.items():
    print(f"\n{base_name} ({base_id}):")
    url = f"{NOCODB_URL}/api/v2/meta/bases/{base_id}/tables"
    response = requests.get(url, headers=HEADERS)

    if response.status_code == 200:
        tables = response.json().get('list', [])
        table_titles = [t['title'] for t in tables]

        for target in TARGET_TABLES:
            if target in table_titles:
                print(f"  ✓ {target} EXISTS")
            else:
                print(f"  ✗ {target} MISSING")
    else:
        print(f"  ERROR: {response.status_code}")
