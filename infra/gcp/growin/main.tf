locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ])
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "brainbase" {
  name                    = "brainbase-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "apps" {
  name                     = "brainbase-apps"
  project                  = var.project_id
  region                   = var.region
  network                  = google_compute_network.brainbase.id
  ip_cidr_range            = "10.40.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_services" {
  name          = "brainbase-private-services"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.brainbase.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.brainbase.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository" "brainbase" {
  location      = var.region
  project       = var.project_id
  repository_id = "brainbase"
  description   = "Growin専用Brainbaseのコンテナイメージ"
  format        = "DOCKER"
  labels        = var.labels

  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "brainbase-runtime"
  display_name = "Brainbase runtime"
  description  = "Growin専用Brainbaseのアプリ実行用"
}

resource "google_service_account" "ingest" {
  project      = var.project_id
  account_id   = "brainbase-ingest"
  display_name = "Brainbase ingest worker"
  description  = "Growin専用Brainbaseの取り込み処理用"
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "brainbase-deployer"
  display_name = "Brainbase deployer"
  description  = "Growin専用BrainbaseのCI/CD用"
}

resource "google_project_iam_member" "runtime_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/cloudsql.instanceUser",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "ingest_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/cloudsql.instanceUser",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/pubsub.subscriber",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/cloudbuild.builds.editor",
    "roles/run.admin",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as" {
  for_each = {
    runtime = google_service_account.runtime.name
    ingest  = google_service_account.ingest.name
  }

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_sql_database_instance" "brainbase" {
  name                = "brainbase-postgres"
  project             = var.project_id
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier              = var.database_tier
    edition           = "ENTERPRISE"
    availability_type = var.database_availability_type
    disk_type         = "PD_SSD"
    disk_size         = 20
    disk_autoresize   = true
    user_labels       = var.labels

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.brainbase.id
      enable_private_path_for_google_cloud_services = true
    }

    maintenance_window {
      day          = 7
      hour         = 18
      update_track = "stable"
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }
  }

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.private_services,
  ]
}

resource "google_sql_database" "brainbase" {
  name     = "brainbase"
  project  = var.project_id
  instance = google_sql_database_instance.brainbase.name
}

resource "google_storage_bucket" "source" {
  name                        = "${var.project_id}-source"
  project                     = var.project_id
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket" "audit" {
  name                        = "${var.project_id}-audit"
  project                     = var.project_id
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }
}

resource "google_storage_bucket_iam_member" "ingest_source_objects" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_storage_bucket_iam_member" "runtime_audit_objects" {
  bucket = google_storage_bucket.audit.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_pubsub_topic" "ingest" {
  name    = "brainbase-ingest"
  project = var.project_id
  labels  = var.labels

  message_retention_duration = "604800s"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "ingest_dead_letter" {
  name    = "brainbase-ingest-dead-letter"
  project = var.project_id
  labels  = var.labels

  message_retention_duration = "1209600s"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_subscription" "ingest" {
  name    = "brainbase-ingest-worker"
  project = var.project_id
  topic   = google_pubsub_topic.ingest.id

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.ingest_dead_letter.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.ingest_dead_letter.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.ingest.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_secret_manager_secret" "runtime" {
  for_each = toset([
    "brainbase-auth-session-secret",
    "brainbase-auth-state-secret",
    "brainbase-database-url",
    "brainbase-graph-api-token",
    "brainbase-internal-api-secret",
    "brainbase-jwt-secret",
    "brainbase-mcp-http-bearer-token",
    "brainbase-refresh-secret",
    "brainbase-service-token-secret",
  ])

  secret_id = each.value
  project   = var.project_id
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = google_secret_manager_secret.runtime

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "api" {
  name                = "brainbase-api"
  project             = var.project_id
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true
  labels              = var.labels

  template {
    service_account = google_service_account.runtime.email
    timeout         = "300s"

    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.brainbase.name
        subnetwork = google_compute_subnetwork.apps.name
      }
    }

    containers {
      image = var.api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }

      startup_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 5
        period_seconds        = 5
        failure_threshold     = 24
        http_get {
          path = "/health/ready"
        }
      }

      dynamic "env" {
        for_each = {
          BRAINBASE_AUTH_SESSION_SECRET  = "brainbase-auth-session-secret"
          BRAINBASE_AUTH_STATE_SECRET    = "brainbase-auth-state-secret"
          BRAINBASE_INTERNAL_API_SECRET  = "brainbase-internal-api-secret"
          BRAINBASE_JWT_SECRET           = "brainbase-jwt-secret"
          BRAINBASE_REFRESH_SECRET       = "brainbase-refresh-secret"
          BRAINBASE_SERVICE_TOKEN_SECRET = "brainbase-service-token-secret"
          INFO_SSOT_DATABASE_URL         = "brainbase-database-url"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      env {
        name  = "BRAINBASE_VAR_DIR"
        value = "/tmp/brainbase"
      }
      env {
        name  = "BRAINBASE_PROJECT_CATALOG_MODE"
        value = "disabled"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.runtime_access,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_public_entry" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "mcp" {
  name                = "brainbase-mcp"
  project             = var.project_id
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true
  labels              = var.labels

  template {
    service_account = google_service_account.runtime.email
    timeout         = "300s"

    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }

    containers {
      image = var.mcp_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 5
        period_seconds        = 5
        failure_threshold     = 24
        http_get {
          path = "/health"
        }
      }

      env {
        name  = "MCP_HTTP_HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "MCP_HTTP_PORT"
        value = "8080"
      }
      env {
        name  = "BRAINBASE_ENTITY_SOURCE"
        value = "graphapi"
      }
      env {
        name  = "BRAINBASE_GRAPH_API_URL"
        value = google_cloud_run_v2_service.api.uri
      }
      env {
        name  = "BRAINBASE_PROJECT_CODES"
        value = "growin"
      }
      env {
        name = "MCP_HTTP_BEARER_TOKEN"
        value_source {
          secret_key_ref {
            secret  = "brainbase-mcp-http-bearer-token"
            version = "latest"
          }
        }
      }
      env {
        name = "BRAINBASE_GRAPH_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = "brainbase-graph-api-token"
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.api,
    google_secret_manager_secret_iam_member.runtime_access,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "mcp_public_entry" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.mcp.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "migrate" {
  name                = "brainbase-migrate"
  project             = var.project_id
  location            = var.region
  deletion_protection = true
  labels              = var.labels

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "1800s"
      max_retries     = 0

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.brainbase.name
          subnetwork = google_compute_subnetwork.apps.name
        }
      }

      containers {
        image = var.migrate_image

        env {
          name = "INFO_SSOT_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = "brainbase-database-url"
              version = "latest"
            }
          }
        }
        env {
          name  = "INFO_SSOT_GIT_SHA"
          value = var.release_git_sha
        }
        env {
          name  = "INFO_SSOT_ROLLBACK_SHA"
          value = var.release_git_sha
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_access]
}
