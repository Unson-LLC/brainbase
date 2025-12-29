#!/usr/bin/env python3
"""
Airtable to NocoDB Migration Script
全12 Airtable basesをNocoDBに一括移行
"""

import os
import sys
import yaml
import json
import logging
from pathlib import Path
from typing import Dict, List, Any
from dotenv import load_dotenv
from tqdm import tqdm
from pyairtable import Api as AirtableApi
from colorlog import ColoredFormatter

from nocodb_client import NocoDBClient
from schema_mapper import SchemaMapper


# ロギング設定
def setup_logging():
    """カラーログ設定"""
    formatter = ColoredFormatter(
        "%(log_color)s%(levelname)-8s%(reset)s %(blue)s%(message)s",
        datefmt=None,
        reset=True,
        log_colors={
            'DEBUG': 'cyan',
            'INFO': 'green',
            'WARNING': 'yellow',
            'ERROR': 'red',
            'CRITICAL': 'red,bg_white',
        }
    )

    handler = logging.StreamHandler()
    handler.setFormatter(formatter)

    logger = logging.getLogger()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    return logger


class AirtableToNocoDBMigration:
    """Airtable → NocoDB 移行オーケストレーター"""

    def __init__(self, config_path: str):
        """
        Args:
            config_path: config.yml のパス
        """
        self.logger = logging.getLogger(__name__)

        # 環境変数読み込み
        load_dotenv()

        # 設定読み込み
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)

        # Airtableクライアント初期化
        airtable_api_key = os.getenv('AIRTABLE_API_KEY')
        if not airtable_api_key:
            raise ValueError("環境変数 AIRTABLE_API_KEY が設定されていません")
        self.airtable = AirtableApi(airtable_api_key)

        # NocoDBクライアント初期化
        nocodb_url = os.getenv('NOCODB_URL')
        nocodb_token = os.getenv('NOCODB_TOKEN')
        if not nocodb_url or not nocodb_token:
            raise ValueError("環境変数 NOCODB_URL または NOCODB_TOKEN が設定されていません")
        self.nocodb = NocoDBClient(nocodb_url, nocodb_token)

        # スキーママッパー初期化
        self.mapper = SchemaMapper()

        # 移行結果レポート
        self.migration_report = {
            'projects': [],
            'total_tables': 0,
            'total_records': 0,
            'manual_migration_fields': [],
            'errors': []
        }

    def get_airtable_bases(self) -> List[Dict[str, Any]]:
        """
        config.ymlから Airtable base 一覧を取得

        Returns:
            base一覧（base_id, base_name, project_id含む）
        """
        bases = []

        for project in self.config.get('projects', []):
            airtable_config = project.get('airtable')
            if airtable_config:
                bases.append({
                    'project_id': project['id'],
                    'base_id': airtable_config['base_id'],
                    'base_name': airtable_config['base_name']
                })

        self.logger.info(f"Found {len(bases)} Airtable bases in config.yml")
        return bases

    def migrate_base(self, base_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        単一 Airtable base を NocoDB に移行

        Args:
            base_info: base情報（base_id, base_name, project_id）

        Returns:
            移行結果
        """
        base_id = base_info['base_id']
        base_name = base_info['base_name']
        project_id = base_info['project_id']

        self.logger.info(f"\n{'=' * 60}")
        self.logger.info(f"Migrating base: {base_name} ({base_id})")
        self.logger.info(f"{'=' * 60}")

        result = {
            'project_id': project_id,
            'base_id': base_id,
            'base_name': base_name,
            'tables': [],
            'total_records': 0,
            'manual_fields': [],
            'errors': []
        }

        try:
            # 1. NocoDBプロジェクト作成
            self.logger.info("Step 1: Creating NocoDB project...")
            nocodb_project = self.nocodb.create_project(
                title=base_name,
                description=f"Migrated from Airtable base {base_id}"
            )
            nocodb_project_id = nocodb_project['id']
            self.logger.info(f"NocoDB project created: {nocodb_project_id}")

            # 2. Airtableベーススキーマ取得
            self.logger.info("Step 2: Fetching Airtable base schema...")
            base = self.airtable.base(base_id)
            airtable_tables = base.schema().tables

            # 3. テーブル移行
            for airtable_table_schema in tqdm(airtable_tables, desc="Migrating tables"):
                # テーブル名からTableオブジェクト取得
                table_result = self.migrate_table(
                    nocodb_project_id,
                    base,
                    airtable_table_schema
                )
                result['tables'].append(table_result)
                result['total_records'] += table_result['record_count']
                result['manual_fields'].extend(table_result['manual_fields'])

                if table_result['errors']:
                    result['errors'].extend(table_result['errors'])

        except Exception as e:
            error_msg = f"Error migrating base {base_name}: {str(e)}"
            self.logger.error(error_msg)
            result['errors'].append(error_msg)

        return result

    def migrate_table(
        self,
        nocodb_project_id: str,
        airtable_base: Any,
        airtable_table_schema: Any
    ) -> Dict[str, Any]:
        """
        単一テーブルを移行

        Args:
            nocodb_project_id: NocoDBプロジェクトID
            airtable_base: Airtable baseオブジェクト
            airtable_table_schema: AirtableテーブルスキーマObject

        Returns:
            移行結果
        """
        table_name = airtable_table_schema.name
        self.logger.info(f"\n  Migrating table: {table_name}")

        result = {
            'table_name': table_name,
            'record_count': 0,
            'manual_fields': [],
            'errors': []
        }

        try:
            # 1. スキーママッピング
            table_schema_info = {
                'name': table_name,
                'fields': [
                    {
                        'name': field.name,
                        'type': field.type,
                        'options': field.options if hasattr(field, 'options') else {},
                        'required': getattr(field, 'required', False)
                    }
                    for field in airtable_table_schema.fields
                ]
            }

            nocodb_schema = self.mapper.map_table_schema(table_schema_info)
            result['manual_fields'] = nocodb_schema['manual_migration_fields']

            # 2. NocoDBテーブル作成
            nocodb_table = self.nocodb.create_table(
                nocodb_project_id,
                table_name,
                nocodb_schema['columns']
            )
            nocodb_table_id = nocodb_table['id']

            # 3. Airtableデータ取得
            self.logger.info(f"    Fetching records from Airtable...")
            # Tableオブジェクトを取得してレコードを取得
            airtable_table = airtable_base.table(table_name)
            airtable_records = list(airtable_table.all())
            total_records = len(airtable_records)
            self.logger.info(f"    Found {total_records} records")

            # 4. レコード移行（バッチ処理）
            batch_size = 100
            for i in range(0, total_records, batch_size):
                batch = airtable_records[i:i + batch_size]
                nocodb_records = [self.convert_record(record) for record in batch]

                self.nocodb.bulk_create_records(
                    nocodb_project_id,
                    table_name,
                    nocodb_records
                )

                result['record_count'] += len(batch)
                self.logger.info(f"    Migrated {result['record_count']}/{total_records} records")

        except Exception as e:
            error_msg = f"Error migrating table {table_name}: {str(e)}"
            self.logger.error(error_msg)
            result['errors'].append(error_msg)

        return result

    def convert_record(self, airtable_record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Airtableレコードを NocoDBレコードに変換

        Args:
            airtable_record: Airtableレコード

        Returns:
            NocoDBレコード（LinkedRecordsフィールドを除外）
        """
        # Airtableレコードは { 'id': '...', 'fields': {...}, 'createdTime': '...' } 形式
        # NocoDBレコードは { 'field1': value1, 'field2': value2, ... } 形式

        # LinkedRecordsフィールドを除外
        # LinkedRecordsは配列でかつ要素が "rec" で始まるAirtable record ID
        nocodb_record = {}
        for field_name, field_value in airtable_record['fields'].items():
            # 配列フィールドでかつ全要素が "rec" で始まる場合はLinkedRecords
            if isinstance(field_value, list) and field_value and all(
                isinstance(v, str) and v.startswith('rec') for v in field_value
            ):
                # LinkedRecordsは後で移行するため、初回は除外
                self.logger.debug(f"Skipping LinkedRecords field: {field_name}")
                continue

            nocodb_record[field_name] = field_value

        return nocodb_record

    def run(self, test_base_name=None):
        """移行を実行"""
        self.logger.info("=" * 80)
        self.logger.info("Airtable to NocoDB Migration")
        self.logger.info("=" * 80)

        # Airtable bases取得
        all_bases = self.get_airtable_bases()

        # テストモード: 特定のbaseのみ移行
        if test_base_name:
            bases = [b for b in all_bases if b['base_name'] == test_base_name]
            if not bases:
                self.logger.error(f"Base '{test_base_name}' not found")
                return
            self.logger.info(f"TEST MODE: Migrating only {test_base_name}")
        else:
            bases = all_bases

        # 各baseを移行
        for base_info in bases:
            base_result = self.migrate_base(base_info)
            self.migration_report['projects'].append(base_result)
            self.migration_report['total_tables'] += len(base_result['tables'])
            self.migration_report['total_records'] += base_result['total_records']
            self.migration_report['manual_migration_fields'].extend(base_result['manual_fields'])
            self.migration_report['errors'].extend(base_result['errors'])

        # 最終レポート出力
        self.print_report()
        self.save_report()

    def print_report(self):
        """移行レポートをコンソール出力"""
        self.logger.info("\n" + "=" * 80)
        self.logger.info("Migration Report")
        self.logger.info("=" * 80)

        self.logger.info(f"\nProjects migrated: {len(self.migration_report['projects'])}")
        self.logger.info(f"Total tables: {self.migration_report['total_tables']}")
        self.logger.info(f"Total records: {self.migration_report['total_records']}")

        if self.migration_report['manual_migration_fields']:
            self.logger.warning(f"\n⚠️  Manual migration required for {len(self.migration_report['manual_migration_fields'])} fields:")
            for field in self.migration_report['manual_migration_fields'][:10]:  # 最初の10件のみ表示
                self.logger.warning(f"  - {field['name']} ({field['type']}): {field['reason']}")

            if len(self.migration_report['manual_migration_fields']) > 10:
                self.logger.warning(f"  ... and {len(self.migration_report['manual_migration_fields']) - 10} more")

        if self.migration_report['errors']:
            self.logger.error(f"\n❌ {len(self.migration_report['errors'])} errors occurred:")
            for error in self.migration_report['errors'][:5]:
                self.logger.error(f"  - {error}")

            if len(self.migration_report['errors']) > 5:
                self.logger.error(f"  ... and {len(self.migration_report['errors']) - 5} more")

        self.logger.info("\n✅ Migration completed!")

    def save_report(self):
        """移行レポートをJSONファイルに保存"""
        report_file = Path(__file__).parent / 'migration_report.json'

        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(self.migration_report, f, indent=2, ensure_ascii=False)

        self.logger.info(f"\n📄 Full report saved to: {report_file}")


def main():
    """メイン処理"""
    setup_logging()
    logger = logging.getLogger(__name__)

    # config.ymlパス
    config_path = Path(__file__).parent.parent / 'config.yml'

    if not config_path.exists():
        logger.error(f"Error: config.yml not found at {config_path}")
        sys.exit(1)

    # コマンドライン引数でテストモード設定可能
    test_base = sys.argv[1] if len(sys.argv) > 1 else None

    try:
        migration = AirtableToNocoDBMigration(str(config_path))
        migration.run(test_base_name=test_base)
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
