# インスタンス情報
output "instance_id" {
  description = "Lightsail instance ID"
  value       = aws_lightsail_instance.nocodb.id
}

output "instance_name" {
  description = "Lightsail instance name"
  value       = aws_lightsail_instance.nocodb.name
}

output "instance_arn" {
  description = "Lightsail instance ARN"
  value       = aws_lightsail_instance.nocodb.arn
}

# ネットワーク情報
output "static_ip_address" {
  description = "Static IP address for NocoDB"
  value       = aws_lightsail_static_ip.nocodb.ip_address
}

output "public_ip_address" {
  description = "Public IP address (same as static IP)"
  value       = aws_lightsail_instance.nocodb.public_ip_address
}

output "private_ip_address" {
  description = "Private IP address"
  value       = aws_lightsail_instance.nocodb.private_ip_address
}

# 接続情報
output "ssh_command" {
  description = "SSH接続コマンド"
  value       = "ssh ubuntu@${aws_lightsail_static_ip.nocodb.ip_address}"
}

output "nocodb_url" {
  description = "NocoDB URL (HTTP)"
  value       = "http://${aws_lightsail_static_ip.nocodb.ip_address}:8080"
}

output "nocodb_url_https" {
  description = "NocoDB URL (HTTPS) - 要SSL証明書設定"
  value       = "https://${aws_lightsail_static_ip.nocodb.ip_address}"
}

# リソース情報
output "bundle_id" {
  description = "Lightsail bundle ID (pricing plan)"
  value       = aws_lightsail_instance.nocodb.bundle_id
}

output "availability_zone" {
  description = "Availability zone"
  value       = aws_lightsail_instance.nocodb.availability_zone
}

# 次のステップ案内
output "next_steps" {
  description = "デプロイ後の次のステップ"
  value       = <<-EOT
    1. SSH接続: ssh ubuntu@${aws_lightsail_static_ip.nocodb.ip_address}
    2. Docker Composeデプロイ: cd /opt/nocodb && docker-compose up -d
    3. NoCoDB初期設定: http://${aws_lightsail_static_ip.nocodb.ip_address}:8080 にアクセス
    4. 環境変数設定: NOCODB_URL=http://${aws_lightsail_static_ip.nocodb.ip_address}:8080
    5. バックアップ設定: cron daily backup to S3
  EOT
}
