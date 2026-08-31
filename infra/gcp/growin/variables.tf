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
