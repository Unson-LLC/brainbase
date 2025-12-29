terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Lightsailインスタンス（NocoDB + PostgreSQL）
resource "aws_lightsail_instance" "nocodb" {
  name              = var.instance_name
  availability_zone = "${var.aws_region}a"
  blueprint_id      = "ubuntu_22_04"
  bundle_id         = var.bundle_id # medium_3_0: 2GB RAM, 2 vCPU, 60GB SSD

  # ユーザーデータ（初期セットアップスクリプト）
  user_data = <<-EOF
    #!/bin/bash
    set -e

    # システムアップデート
    apt-get update
    apt-get upgrade -y

    # Docker & Docker Composeインストール
    apt-get install -y apt-transport-https ca-certificates curl software-properties-common
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Dockerサービス開始
    systemctl enable docker
    systemctl start docker

    # 作業ディレクトリ作成
    mkdir -p /opt/nocodb
    cd /opt/nocodb

    # Docker Compose設定ダウンロード（後でGitHubから取得する想定）
    echo "NocoDB setup ready. Deploy docker-compose.yml manually."

    # AWS CLI インストール（バックアップ用）
    apt-get install -y awscli

    # 日次バックアップ用cronジョブ設定（後で手動設定）
    echo "Backup cron job: to be configured manually"
  EOF

  tags = {
    Name        = var.instance_name
    Environment = var.environment
    Project     = "brainbase"
    ManagedBy   = "Terraform"
  }
}

# 静的IP割り当て
resource "aws_lightsail_static_ip" "nocodb" {
  name = "${var.instance_name}-ip"
}

resource "aws_lightsail_static_ip_attachment" "nocodb" {
  static_ip_name = aws_lightsail_static_ip.nocodb.name
  instance_name  = aws_lightsail_instance.nocodb.name
}

# ファイアウォール設定
resource "aws_lightsail_instance_public_ports" "nocodb" {
  instance_name = aws_lightsail_instance.nocodb.name

  # SSH
  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = var.allowed_ssh_cidrs
  }

  # HTTP
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  # HTTPS
  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }

  # NocoDB (開発用)
  port_info {
    protocol  = "tcp"
    from_port = 8080
    to_port   = 8080
    cidrs     = var.allowed_nocodb_cidrs
  }
}
