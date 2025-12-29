#!/usr/bin/env python3
import os
import sys
from dotenv import load_dotenv
from nocodb_client import NocoDBClient

load_dotenv('/Users/ksato/workspace/.env')

client = NocoDBClient(os.getenv('NOCODB_URL'), os.getenv('NOCODB_TOKEN'))

# BAAOプロジェクト削除
project_id = 'p0ou2p3r9guq3zf'

print(f"Deleting BAAO project: {project_id}")
try:
    response = client._request('DELETE', f'/db/meta/projects/{project_id}')
    print("✓ BAAO project deleted successfully")
except Exception as e:
    print(f"Error deleting project: {e}")
