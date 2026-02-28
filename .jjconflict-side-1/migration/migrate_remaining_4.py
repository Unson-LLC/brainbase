#!/usr/bin/env python3
"""
残り4ベース（Zeims, Senrigan, Mywa, BackOffice）を移行
"""

import os
import sys
import logging
from dotenv import load_dotenv
from migrate_all_bases import migrate_base
from nocodb_client import NocoDBClient
from pyairtable import Api
import colorlog

# ロギング設定
handler = colorlog.StreamHandler()
handler.setFormatter(colorlog.ColoredFormatter(
    '%(log_color)s%(levelname)-8s%(reset)s %(message)s',
    log_colors={
        'DEBUG': 'cyan',
        'INFO': 'green',
        'WARNING': 'yellow',
        'ERROR': 'red',
        'CRITICAL': 'red,bg_white',
    }
))
logger = colorlog.getLogger(__name__)
logger.addHandler(handler)
logger.setLevel(logging.INFO)

load_dotenv('/Users/ksato/workspace/.env')

def main():
    # 環境変数取得
    airtable_token = os.getenv('AIRTABLE_TOKEN')
    nocodb_url = os.getenv('NOCODB_URL')
    nocodb_token = os.getenv('NOCODB_TOKEN')

    if not all([airtable_token, nocodb_url, nocodb_token]):
        logger.error("環境変数が設定されていません: AIRTABLE_TOKEN, NOCODB_URL, NOCODB_TOKEN")
        sys.exit(1)

    airtable_api = Api(airtable_token)
    nocodb_client = NocoDBClient(nocodb_url, nocodb_token)

    # NocoDBプロジェクトID (すべてのベースが統合されているプロジェクト)
    nocodb_project_id = 'pqj22ze3jh0mkms'

    # 残りの4ベース
    remaining_bases = [
        {'base_id': 'appg1DeWomuFuYnri', 'name': 'Zeims'},
        {'base_id': 'appDd7TdJf1t23PCm', 'name': 'Senrigan'},
        {'base_id': 'appJeMbMQcz507E9g', 'name': 'Mywa'},
        {'base_id': 'appxybW7Hn5qjaIwP', 'name': 'BackOffice'},
    ]

    logger.info(f"{'='*60}")
    logger.info(f"残り4ベースの移行を開始")
    logger.info(f"{'='*60}\n")

    success_count = 0
    failed_count = 0

    for base in remaining_bases:
        logger.info(f"\n▶ {base['name']} ({base['base_id']}) の移行を開始...")
        result = migrate_base(
            base['base_id'],
            base['name'],
            nocodb_client,
            airtable_api,
            airtable_token,
            nocodb_project_id
        )
        if result:
            success_count += 1
            logger.info(f"✅ {base['name']} の移行完了")
        else:
            failed_count += 1
            logger.error(f"❌ {base['name']} の移行失敗")

    logger.info(f"\n{'='*60}")
    logger.info(f"移行完了: 成功 {success_count}, 失敗 {failed_count}")
    logger.info(f"{'='*60}")
    logger.info(f"\nNocoDB URL: {nocodb_url}/")

if __name__ == '__main__':
    main()
