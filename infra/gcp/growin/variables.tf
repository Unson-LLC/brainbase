variable "project_id" {
  description = "Growin専用Brainbaseを配置するGoogle CloudプロジェクトID"
  type        = string
  default     = "brainbase-505912"
}

variable "region" {
  description = "主要リソースを配置するGoogle Cloudリージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "リソースを識別する環境名"
  type        = string
  default     = "production"
}

variable "google_workspace_domain" {
  description = "GrowinのGoogle Workspaceでログインを許可するドメイン"
  type        = string
  default     = "growin.jp"
}

variable "database_tier" {
  description = "Cloud SQLのマシンタイプ"
  type        = string
  default     = "db-custom-1-3840"
}

variable "database_availability_type" {
  description = "Cloud SQLの可用性。productionではREGIONALを推奨"
  type        = string
  default     = "REGIONAL"

  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.database_availability_type)
    error_message = "database_availability_typeはZONALまたはREGIONALを指定してください。"
  }
}

variable "labels" {
  description = "全リソースに付与する共通ラベル"
  type        = map(string)
  default = {
    application = "brainbase"
    customer    = "growin"
    managed_by  = "terraform"
  }
}

variable "release_git_sha" {
  description = "配置するソースの完全なGit SHA"
  type        = string
}

variable "rollback_git_sha" {
  description = "障害時に戻す確認済みの旧安定版Git SHA"
  type        = string
}

variable "api_public_url" {
  description = "Google認証の確認URL生成に使うBrainbase API公開URL"
  type        = string
  default     = "https://brainbase-api-lmc74punpa-an.a.run.app"
}

variable "api_image" {
  description = "Brainbase APIのコンテナイメージ"
  type        = string
}

variable "mcp_image" {
  description = "Brainbase MCPのコンテナイメージ"
  type        = string
}

variable "migrate_image" {
  description = "DBマイグレーション用コンテナイメージ"
  type        = string
}

variable "auth_bootstrap_image" {
  description = "Growin初期利用者の認証・権限登録用コンテナイメージ。未指定時はmigrate_imageを使用"
  type        = string
  default     = ""
}
