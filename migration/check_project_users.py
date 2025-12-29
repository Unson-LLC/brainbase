#!/usr/bin/env python3
"""
NocoDBプロジェクトのユーザー権限を確認
"""

import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv('/Users/ksato/workspace/.env')

def main():
    nocodb_url = os.getenv('NOCODB_URL').rstrip('/')
    nocodb_token = os.getenv('NOCODB_TOKEN')
    
    headers = {
        'xc-token': nocodb_token,
        'Content-Type': 'application/json'
    }
    
    # BAAOプロジェクトID
    project_id = 'p7c41wtpmni28ng'
    
    # プロジェクトユーザー一覧取得
    print("=== Project Users ===")
    try:
        response = requests.get(
            f"{nocodb_url}/api/v1/db/meta/projects/{project_id}/users",
            headers=headers
        )
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            users = response.json()
            print(f"Users: {users}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")
    
    # 現在のユーザー情報取得
    print("\n=== Current User ===")
    try:
        response = requests.get(
            f"{nocodb_url}/api/v1/user/me",
            headers=headers
        )
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            user = response.json()
            print(f"User: {user}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == '__main__':
    main()
