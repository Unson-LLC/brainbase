#!/bin/bash
# NocoDB PostgreSQL バックアップスクリプト
# 日次でPostgreSQLダンプを取得し、S3にアップロード

set -euo pipefail

# 設定読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
else
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

# 必須環境変数チェック
: "${POSTGRES_PASSWORD:?環境変数 POSTGRES_PASSWORD が設定されていません}"
: "${AWS_ACCESS_KEY_ID:?環境変数 AWS_ACCESS_KEY_ID が設定されていません}"
: "${AWS_SECRET_ACCESS_KEY:?環境変数 AWS_SECRET_ACCESS_KEY が設定されていません}"
: "${BACKUP_S3_BUCKET:?環境変数 BACKUP_S3_BUCKET が設定されていません}"

# 変数設定
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-nocodb}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/tmp/nocodb-backup"
BACKUP_FILE="nocodb_backup_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="nocodb-postgres"

# ログ関数
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# バックアップディレクトリ作成
mkdir -p "$BACKUP_DIR"

# PostgreSQLダンプ取得
log "Starting PostgreSQL dump..."
docker exec -t "$CONTAINER_NAME" pg_dump -U nocodb -d nocodb \
  | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

if [ $? -eq 0 ]; then
  log "PostgreSQL dump completed: ${BACKUP_FILE}"
  DUMP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
  log "Dump size: ${DUMP_SIZE}"
else
  log "Error: PostgreSQL dump failed"
  exit 1
fi

# S3アップロード
log "Uploading to S3..."
aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}" \
  "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${BACKUP_FILE}" \
  --region ap-northeast-1

if [ $? -eq 0 ]; then
  log "S3 upload completed: s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${BACKUP_FILE}"
else
  log "Error: S3 upload failed"
  exit 1
fi

# ローカルバックアップファイル削除
rm -f "${BACKUP_DIR}/${BACKUP_FILE}"
log "Local backup file removed"

# 古いバックアップ削除（S3）
log "Cleaning up old backups (retention: ${BACKUP_RETENTION_DAYS} days)..."
CUTOFF_DATE=$(date -d "${BACKUP_RETENTION_DAYS} days ago" +"%Y-%m-%d" 2>/dev/null || date -v-${BACKUP_RETENTION_DAYS}d +"%Y-%m-%d")

aws s3 ls "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/" \
  | awk '{print $4}' \
  | grep -E "nocodb_backup_[0-9]{8}_[0-9]{6}\.sql\.gz" \
  | while read -r file; do
      file_date=$(echo "$file" | grep -oE "[0-9]{8}" | head -1)
      file_date_formatted="${file_date:0:4}-${file_date:4:2}-${file_date:6:2}"

      if [[ "$file_date_formatted" < "$CUTOFF_DATE" ]]; then
        log "Deleting old backup: $file (date: $file_date_formatted)"
        aws s3 rm "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/$file" --region ap-northeast-1
      fi
    done

log "Backup completed successfully"

# Slack通知（オプション）
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  curl -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"✅ NocoDB バックアップ完了\\nファイル: ${BACKUP_FILE}\\nサイズ: ${DUMP_SIZE}\"}"
fi

exit 0
