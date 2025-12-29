# AWS設定
variable "aws_region" {
  description = "AWS region for Lightsail instance"
  type        = string
  default     = "ap-northeast-1" # 東京リージョン
}

# Lightsailインスタンス設定
variable "instance_name" {
  description = "Lightsail instance name"
  type        = string
  default     = "brainbase-nocodb"
}

variable "bundle_id" {
  description = "Lightsail bundle ID (プラン選択)"
  type        = string
  default     = "medium_3_0" # 2GB RAM, 2 vCPU, 60GB SSD, $12/月
  # その他のプラン:
  # small_3_0: 1GB RAM, 1 vCPU, 40GB SSD, $7/月
  # large_3_0: 4GB RAM, 2 vCPU, 80GB SSD, $20/月
}

variable "environment" {
  description = "Environment (production, staging)"
  type        = string
  default     = "production"
}

# セキュリティ設定
variable "allowed_ssh_cidrs" {
  description = "SSH接続を許可するCIDRリスト"
  type        = list(string)
  default     = ["0.0.0.0/0"] # 本番運用時は特定IPに制限推奨
}

variable "allowed_nocodb_cidrs" {
  description = "NocoDB API接続を許可するCIDRリスト"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# NocoDB設定
variable "nocodb_admin_email" {
  description = "NocoDB admin email"
  type        = string
  sensitive   = true
}

variable "nocodb_admin_password" {
  description = "NocoDB admin password"
  type        = string
  sensitive   = true
}

variable "postgres_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

# バックアップ設定
variable "backup_s3_bucket" {
  description = "S3 bucket for NocoDB backups"
  type        = string
  default     = "brainbase-backups"
}

variable "backup_retention_days" {
  description = "Backup retention period (days)"
  type        = number
  default     = 30
}
