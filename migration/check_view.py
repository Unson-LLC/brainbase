#!/usr/bin/env python3
import os
import sys
import requests
import json
from dotenv import load_dotenv

load_dotenv('/Users/ksato/workspace/.env')

nocodb_url = os.getenv('NOCODB_URL')
nocodb_token = os.getenv('NOCODB_TOKEN')

headers = {'xc-token': nocodb_token}

# テーブルのview情報を確認
response = requests.get(
    f"{nocodb_url}/api/v1/db/meta/tables/mwdfzfqsdm088vt",
    headers=headers
)

if response.status_code == 200:
    table_data = response.json()
    print("=== Views ===")
    for view in table_data.get('views', []):
        print(f"View ID: {view.get('id')}")
        print(f"Title: {view.get('title')}")
        print(f"Type: {view.get('type')}")
        print(f"Is Default: {view.get('is_default')}")
        print(f"View Data: {json.dumps(view.get('view'), indent=2)}")
        print()
else:
    print(f"Error: {response.status_code}")
    print(response.text)
