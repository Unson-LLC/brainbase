output "artifact_registry_repository" {
  description = "コンテナの送信先"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.brainbase.repository_id}"
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL接続名"
  value       = google_sql_database_instance.brainbase.connection_name
}

output "cloud_sql_private_ip" {
  description = "Cloud SQLのプライベートIP"
  value       = google_sql_database_instance.brainbase.private_ip_address
}

output "runtime_service_account" {
  description = "アプリ実行用サービスアカウント"
  value       = google_service_account.runtime.email
}

output "ingest_service_account" {
  description = "取り込み処理用サービスアカウント"
  value       = google_service_account.ingest.email
}

output "deployer_service_account" {
  description = "CI/CD用サービスアカウント"
  value       = google_service_account.deployer.email
}

output "source_bucket" {
  description = "取り込み元ファイル用バケット"
  value       = google_storage_bucket.source.name
}

output "audit_bucket" {
  description = "監査証跡用バケット"
  value       = google_storage_bucket.audit.name
}
