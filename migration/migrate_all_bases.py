#!/usr/bin/env python3
"""
全Airtableベースを一括移行
"""

import os
import sys
import yaml
import logging
import requests
import time
from dotenv import load_dotenv
from nocodb_client import NocoDBClient
from pyairtable import Api
from tqdm import tqdm
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

# Airtable → NocoDB フィールドタイプマッピング
FIELD_TYPE_MAPPING = {
    'singleLineText': 'SingleLineText',
    'multilineText': 'LongText',
    'richText': 'LongText',
    'number': 'Number',
    'percent': 'Percent',
    'currency': 'Currency',
    'singleSelect': 'SingleSelect',
    'multipleSelects': 'MultiSelect',
    'date': 'Date',
    'dateTime': 'DateTime',
    'checkbox': 'Checkbox',
    'rating': 'Rating',
    'duration': 'Duration',
    'email': 'Email',
    'url': 'URL',
    'phoneNumber': 'PhoneNumber',
    'multipleAttachments': 'Attachment',
    'multipleRecordLinks': 'LinkToAnotherRecord',
    'rollup': 'Rollup',
    'count': 'Count',
    'lookup': 'Lookup',
    'formula': 'Formula',
    'barcode': 'SingleLineText',
}

def convert_airtable_field_to_nocodb(field, table_name):
    """Airtableフィールド定義をNocoDB形式に変換"""
    field_type = field.get('type')
    field_name = field.get('name')

    # 重要なID系フィールドは formula でも SingleLineText として扱う
    id_field_names = ['ID', 'id', '番号', 'No', 'NO', 'Number']
    if field_name in id_field_names and field_type == 'formula':
        nocodb_type = 'SingleLineText'
        logger.debug(f"  ✓ ID系formulaフィールドをSingleLineTextとして扱う: {field_name}")
    # 複雑なフィールドタイプはスキップ（後で手動設定）
    elif field_type in ['formula', 'rollup', 'count', 'lookup', 'multipleRecordLinks']:
        logger.debug(f"  ⚠ スキップ: {field_name} ({field_type}) - 後で手動設定が必要")
        return None
    # autonumber, barcode は SingleLineText として扱う
    elif field_type in ['autoNumber', 'barcode']:
        nocodb_type = 'SingleLineText'
    else:
        nocodb_type = FIELD_TYPE_MAPPING.get(field_type, 'SingleLineText')

    column_data = {
        'column_name': field_name,
        'title': field_name,
        'uidt': nocodb_type,
        'rqd': False
    }

    # SingleSelect/MultiSelect の選択肢設定
    if field_type in ['singleSelect', 'multipleSelects']:
        options = field.get('options', {})
        choices = options.get('choices', [])
        if choices:
            column_data['colOptions'] = {
                'options': [
                    {'title': choice.get('name'), 'color': '#808080'}
                    for choice in choices
                ]
            }

    return column_data

def get_airtable_schema(base_id: str, airtable_token: str):
    """Airtable Metadata APIでスキーマを取得"""
    url = f"https://api.airtable.com/v0/meta/bases/{base_id}/tables"
    headers = {"Authorization": f"Bearer {airtable_token}"}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    time.sleep(0.5)  # APIレート制限対策
    return response.json()

def convert_record(airtable_record: dict) -> dict:
    """Airtableレコードを NocoDBレコードに変換（LinkedRecords除外）"""
    nocodb_record = {}
    for field_name, field_value in airtable_record['fields'].items():
        # LinkedRecordsフィールドを除外
        if isinstance(field_value, list) and field_value and all(
            isinstance(v, str) and v.startswith('rec') for v in field_value
        ):
            continue

        # IDフィールドをAirtable_IDにリネーム
        if field_name in ['ID', 'id']:
            nocodb_record[f'Airtable_{field_name}'] = field_value
        else:
            nocodb_record[field_name] = field_value

    return nocodb_record

def migrate_base(base_id: str, base_name: str, nocodb_client: NocoDBClient, airtable_api: Api, airtable_token: str, nocodb_project_id: str):
    """1つのAirtableベースを移行"""
    logger.info(f"\n{'='*60}")
    logger.info(f"移行開始: {base_name} ({base_id})")
    logger.info(f"{'='*60}")

    try:
        # Airtableベース取得
        airtable_base = airtable_api.base(base_id)

        # テーブル一覧取得（Airtable Metadata APIから）
        schema_data = get_airtable_schema(base_id, airtable_token)
        tables = schema_data.get('tables', [])

        logger.info(f"テーブル数: {len(tables)}")

        # 各テーブルを移行
        for table_schema in tables:
            original_table_name = table_schema['name']
            # テーブル名にベース名をプレフィックスとして追加（重複回避）
            table_name = f"{base_name}_{original_table_name}"
            logger.info(f"\n--- テーブル: {original_table_name} → {table_name} ---")

            # 最小限のカラムでテーブル作成
            minimal_columns = [
                {'column_name': 'id', 'title': 'ID', 'uidt': 'ID', 'pk': True, 'ai': True, 'rqd': True}
            ]

            create_table_response = nocodb_client._request(
                'POST',
                f'/db/meta/projects/{nocodb_project_id}/tables',
                json={
                    'table_name': table_name,
                    'title': table_name,
                    'columns': minimal_columns
                }
            )
            nocodb_table_id = create_table_response.json()['id']
            logger.info(f"  テーブル作成: {nocodb_table_id}")

            # フィールドを追加
            for field in table_schema.get('fields', []):
                field_name = field.get('name')

                # NocoDBの自動生成idカラムと重複しないよう、Airtableの'ID'フィールドは'Airtable_ID'にリネーム
                if field_name in ['ID', 'id']:
                    field['name'] = f'Airtable_{field_name}'
                    logger.debug(f"  ✓ {field_name} → {field['name']} にリネーム")

                try:
                    column_data = convert_airtable_field_to_nocodb(field, table_name)
                    if column_data is None:  # スキップされた複雑なフィールド
                        continue
                    nocodb_client._request(
                        'POST',
                        f'/db/meta/tables/{nocodb_table_id}/columns',
                        json=column_data
                    )
                    logger.debug(f"  ✓ フィールド追加: {field_name}")
                except Exception as e:
                    logger.warning(f"  ✗ フィールド追加失敗: {field_name} - {e}")

            # データインポート（元のテーブル名を使用）
            airtable_table = airtable_base.table(original_table_name)
            records = airtable_table.all()

            imported_count = 0
            failed_count = 0

            for record in tqdm(records, desc=f"  {table_name}"):
                try:
                    nocodb_record = convert_record(record)
                    nocodb_client.create_record(
                        project_id=nocodb_project_id,
                        table_name=table_name,
                        record=nocodb_record
                    )
                    imported_count += 1
                    time.sleep(0.2)  # APIレート制限対策
                except Exception as e:
                    logger.debug(f"  レコードインポート失敗: {e}")
                    failed_count += 1

            logger.info(f"  データ: 成功 {imported_count}, 失敗 {failed_count}")

            # システムフィールドに名前を設定
            try:
                table_detail = nocodb_client._request('GET', f'/db/meta/tables/{nocodb_table_id}').json()
                columns = table_detail.get('columns', [])

                field_titles = {
                    'created_at': '作成日時',
                    'updated_at': '更新日時',
                    'created_by': '作成者',
                    'updated_by': '更新者',
                    'nc_order': '順序'
                }

                for col in columns:
                    if col.get('system'):
                        col_id = col['id']
                        col_name = col.get('column_name')
                        new_title = field_titles.get(col_name, col_name)
                        nocodb_client._request(
                            'PATCH',
                            f'/db/meta/columns/{col_id}',
                            json={'title': new_title}
                        )
                logger.debug(f"  ✓ システムフィールド名設定完了")
            except Exception as e:
                logger.warning(f"  ✗ システムフィールド名設定失敗: {e}")

        logger.info(f"\n✓ {base_name} 移行完了")
        return True

    except Exception as e:
        logger.error(f"\n✗ {base_name} 移行失敗: {e}")
        return False

def main():
    # 接続情報
    airtable_token = os.getenv('AIRTABLE_TOKEN')
    nocodb_url = os.getenv('NOCODB_URL')
    nocodb_token = os.getenv('NOCODB_TOKEN')

    airtable_api = Api(airtable_token)
    nocodb_client = NocoDBClient(nocodb_url, nocodb_token)

    # NocoDBプロジェクトID
    nocodb_project_id = 'pqj22ze3jh0mkms'

    # config.ymlから移行対象ベースを取得
    with open('/Users/ksato/workspace/config.yml', 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    # スキップするベースリスト
    skip_bases = [
        'appCysQGZowfOd58i',  # BAAO - 既に移行済み
        'appg1DeWomuFuYnri',  # Zeims - APIレート制限中
        'app8uhkD8PcnxPvVx',  # SalesTailor - 移行完了
        'appXLSkrAKrykJJQm',  # eve-topi - 移行完了
        'appXvthGPhEO1ZEOv',  # HP Sales - 移行完了
        'appsticSxr1PQsZam',  # SmartFront - 移行完了
        'appvZv4ybVDsBXtvC',  # Aitle - 移行完了
        'appDd7TdJf1t23PCm',  # Senrigan - APIレート制限中
        'appJeMbMQcz507E9g',  # Mywa - APIレート制限中
        'appxybW7Hn5qjaIwP',  # BackOffice - APIレート制限中
    ]

    airtable_bases = []
    for project in config.get('projects', []):
        if 'airtable' in project:
            airtable = project['airtable']
            if airtable['base_id'] not in skip_bases:
                airtable_bases.append({
                    'id': project['id'],
                    'name': airtable['base_name'],
                    'base_id': airtable['base_id']
                })

    logger.info(f"移行対象: {len(airtable_bases)} ベース")

    # 各ベースを移行
    success_count = 0
    failed_count = 0

    for base in airtable_bases:
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
        else:
            failed_count += 1

    logger.info(f"\n{'='*60}")
    logger.info(f"移行完了: 成功 {success_count}, 失敗 {failed_count}")
    logger.info(f"{'='*60}")
    logger.info(f"\nNocoDB URL: {nocodb_url}/")

if __name__ == '__main__':
    main()
