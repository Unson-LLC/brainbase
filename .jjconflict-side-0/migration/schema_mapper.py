"""
Schema Mapper
AirtableフィールドタイプをNocoDBフィールドタイプにマッピング
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class SchemaMapper:
    """Airtable → NocoDB スキーママッパー"""

    def __init__(self, mapping_file: str = "field-mapping.json"):
        """
        Args:
            mapping_file: フィールドマッピング定義ファイル
        """
        mapping_path = Path(__file__).parent / mapping_file
        with open(mapping_path, 'r', encoding='utf-8') as f:
            self.mapping_config = json.load(f)

        self.field_type_mapping = self.mapping_config['fieldTypeMapping']
        self.relationship_mapping = self.mapping_config['relationshipMapping']

    def map_field_type(self, airtable_field: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Airtableフィールドを NocoDBフィールドに変換

        Args:
            airtable_field: Airtableフィールド定義

        Returns:
            NocoDBフィールド定義（変換不可の場合はNone）
        """
        field_type = airtable_field.get('type')
        field_name = airtable_field.get('name')

        if field_type not in self.field_type_mapping:
            logger.warning(f"Unknown Airtable field type: {field_type} (field: {field_name})")
            return None

        mapping = self.field_type_mapping[field_type]

        if not mapping['autoMigrate']:
            logger.warning(f"Field '{field_name}' (type: {field_type}) requires manual migration: {mapping['notes']}")
            return None

        nocodb_type = mapping['nocodb']
        if not nocodb_type:
            logger.warning(f"Field '{field_name}' (type: {field_type}) is not supported in NocoDB")
            return None

        # 基本フィールド定義
        nocodb_field = {
            'column_name': self._sanitize_column_name(field_name),
            'title': field_name,
            'uidt': nocodb_type,
            'rqd': airtable_field.get('required', False)
        }

        # フィールドタイプ別の追加設定
        options = airtable_field.get('options')

        if field_type == 'singleSelect' or field_type == 'multipleSelects':
            # 選択肢を移行
            # NocoDBのdtxpは "'option1','option2'" 形式を期待
            choices = getattr(options, 'choices', []) if options else []
            choice_values = [getattr(choice, 'name', str(choice)) for choice in choices]
            # 各選択肢を単一引用符で囲み、カンマで連結
            nocodb_field['dtxp'] = ','.join(f"'{val}'" for val in choice_values)

        elif field_type == 'number':
            # 小数点設定
            precision = getattr(options, 'precision', 0) if options else 0
            nocodb_field['dtxp'] = str(precision)

        elif field_type == 'currency':
            # 通貨設定
            symbol = getattr(options, 'symbol', '$') if options else '$'
            precision = getattr(options, 'precision', 2) if options else 2
            nocodb_field['dtxp'] = json.dumps({
                'currency_locale': 'en-US',
                'currency_code': 'USD',
                'precision': precision
            }, ensure_ascii=False)

        elif field_type == 'percent':
            # パーセント設定
            precision = getattr(options, 'precision', 0) if options else 0
            nocodb_field['dtxp'] = str(precision)

        elif field_type == 'date':
            # 日付フォーマット
            date_format = getattr(options, 'date_format', None) if options else None
            if date_format:
                nocodb_field['dtxp'] = getattr(date_format, 'format', 'YYYY-MM-DD')

        elif field_type == 'dateTime':
            # 日時フォーマット
            date_fmt = getattr(options, 'date_format', None) if options else None
            time_fmt = getattr(options, 'time_format', None) if options else None
            date_str = getattr(date_fmt, 'format', 'YYYY-MM-DD') if date_fmt else 'YYYY-MM-DD'
            time_str = getattr(time_fmt, 'format', 'HH:mm') if time_fmt else 'HH:mm'
            nocodb_field['dtxp'] = f"{date_str} {time_str}"

        elif field_type == 'rating':
            # 最大値設定
            max_rating = getattr(options, 'max', 5) if options else 5
            nocodb_field['dtxp'] = json.dumps({'max': max_rating}, ensure_ascii=False)

        elif field_type == 'multipleRecordLinks':
            # リレーション設定（後でリンク作成）
            nocodb_field['uidt'] = 'LinkToAnotherRecord'
            linked_table_id = getattr(options, 'linked_table_id', None) if options else None
            nocodb_field['_link_config'] = {
                'linkedTable': linked_table_id,
                'type': 'mm'  # Many-to-Many
            }

        elif field_type == 'lookup':
            # Lookup設定
            rel_col_id = getattr(options, 'record_link_field_id', None) if options else None
            lookup_col_id = getattr(options, 'field_id_in_linked_table', None) if options else None
            nocodb_field['_lookup_config'] = {
                'relationColumn': rel_col_id,
                'lookupColumn': lookup_col_id
            }

        elif field_type == 'rollup':
            # Rollup設定
            rel_col_id = getattr(options, 'record_link_field_id', None) if options else None
            rollup_col_id = getattr(options, 'field_id_in_linked_table', None) if options else None
            nocodb_field['_rollup_config'] = {
                'relationColumn': rel_col_id,
                'rollupColumn': rollup_col_id,
                'rollupFunction': 'sum'  # デフォルト
            }

        return nocodb_field

    def _sanitize_column_name(self, name: str) -> str:
        """
        カラム名をサニタイズ（NocoDBの命名規則に合わせる）

        Args:
            name: 元のカラム名

        Returns:
            サニタイズされたカラム名
        """
        # スペースをアンダースコアに変換
        sanitized = name.replace(' ', '_')
        # 特殊文字を削除
        sanitized = ''.join(c for c in sanitized if c.isalnum() or c == '_')
        # 先頭が数字の場合はアンダースコアを追加
        if sanitized[0].isdigit():
            sanitized = '_' + sanitized
        return sanitized

    def _map_rollup_function(self, airtable_function: str) -> str:
        """
        Airtable Rollup関数をNocoDB Rollup関数にマッピング

        Args:
            airtable_function: Airtable Rollup関数

        Returns:
            NocoDB Rollup関数
        """
        function_mapping = {
            'sum': 'sum',
            'average': 'avg',
            'count': 'count',
            'countAll': 'count',
            'arrayFlatten': 'count',
            'arrayUnique': 'count',
            'arrayCompact': 'count',
            'max': 'max',
            'min': 'min',
            'and': 'count',
            'or': 'count',
            'xor': 'count'
        }
        return function_mapping.get(airtable_function, 'sum')

    def map_table_schema(self, airtable_table: Dict[str, Any]) -> Dict[str, Any]:
        """
        Airtableテーブルスキーマを NocoDBテーブルスキーマに変換

        Args:
            airtable_table: Airtableテーブル定義

        Returns:
            NocoDBテーブル定義
        """
        table_name = airtable_table.get('name')
        logger.info(f"Mapping table schema: {table_name}")

        nocodb_columns = []
        manual_migration_fields = []

        for field in airtable_table.get('fields', []):
            nocodb_field = self.map_field_type(field)

            if nocodb_field:
                nocodb_columns.append(nocodb_field)
            else:
                # 手動移行が必要なフィールド
                manual_migration_fields.append({
                    'name': field.get('name'),
                    'type': field.get('type'),
                    'reason': self.field_type_mapping.get(field.get('type'), {}).get('notes', 'Unknown')
                })

        return {
            'title': table_name,
            'columns': nocodb_columns,
            'manual_migration_fields': manual_migration_fields
        }

    def extract_formula_fields(self, airtable_table: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Formulaフィールドを抽出（手動再作成用）

        Args:
            airtable_table: Airtableテーブル定義

        Returns:
            Formulaフィールドリスト
        """
        formula_fields = []

        for field in airtable_table.get('fields', []):
            if field.get('type') == 'formula':
                formula_fields.append({
                    'table': airtable_table.get('name'),
                    'field_name': field.get('name'),
                    'formula': field.get('options', {}).get('formula', ''),
                    'notes': 'Convert Airtable formula syntax to NocoDB formula syntax'
                })

        return formula_fields
