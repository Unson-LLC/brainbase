#!/usr/bin/env bash
set -euo pipefail

RYOKO_USER="${RYOKO_USER:-ryoko}"
HOME_DIR="${HOME_DIR:-/home/$RYOKO_USER}"
STATE_DIR="${OPENRYOKO_RUN_RECEIPT_STATE_DIR:-$HOME_DIR/.local/state/openryoko-run-receipt}"
OUTBOX_DIR="${OPENRYOKO_RUN_RECEIPT_OUTBOX_DIR:-$STATE_DIR/outbox}"
DEAD_LETTER_DIR="${OPENRYOKO_RUN_RECEIPT_DEAD_LETTER_DIR:-$STATE_DIR/dead-letter}"
MAX_OUTBOX_AGE_SECONDS="${OPENRYOKO_MAX_OUTBOX_AGE_SECONDS:-300}"
GATEWAY_URL="${OPENRYOKO_GATEWAY_URL:-http://127.0.0.1:7777/}"
MEMINFO_FILE="${OPENRYOKO_MEMINFO_FILE:-/proc/meminfo}"

count_json_files() {
  local directory="$1"
  if [[ ! -d "$directory" ]]; then
    printf '0\n'
    return
  fi
  find "$directory" -maxdepth 1 -type f -name '*.json' -print | wc -l | tr -d ' '
}

oldest_file_age_seconds() {
  local directory="$1"
  local file modified_epoch oldest_epoch=""
  if [[ ! -d "$directory" ]]; then
    printf '0\n'
    return
  fi
  while IFS= read -r file; do
    if [[ "$(uname -s)" == "Darwin" ]]; then
      modified_epoch="$(stat -f '%m' "$file")"
    else
      modified_epoch="$(stat -c '%Y' "$file")"
    fi
    if [[ -z "$oldest_epoch" || "$modified_epoch" -lt "$oldest_epoch" ]]; then
      oldest_epoch="$modified_epoch"
    fi
  done < <(find "$directory" -maxdepth 1 -type f -name '*.json' -print)
  if [[ -z "$oldest_epoch" ]]; then
    printf '0\n'
    return
  fi
  awk -v now="$(date +%s)" -v oldest="$oldest_epoch" \
    'BEGIN { age = now - int(oldest); if (age > 0) print age; else print 0 }'
}

gateway_status="unreachable"
if curl --fail --silent --show-error --max-time 5 "$GATEWAY_URL" >/dev/null 2>&1; then
  gateway_status="healthy"
fi

openryoko_service="$(systemctl is-active openryoko.service 2>/dev/null || true)"
receipt_timer="$(systemctl is-active openryoko-run-receipt.timer 2>/dev/null || true)"
outbox_count="$(count_json_files "$OUTBOX_DIR")"
dead_letter_count="$(count_json_files "$DEAD_LETTER_DIR")"
oldest_outbox_age_seconds="$(oldest_file_age_seconds "$OUTBOX_DIR")"
disk_used_percent="$(
  df -P "$HOME_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
)"
memory_available_kib="$(
  awk '/^MemAvailable:/ { print $2 }' "$MEMINFO_FILE"
)"

failures=()
[[ "$openryoko_service" == "active" ]] || failures+=("openryoko_service_inactive")
[[ "$receipt_timer" == "active" ]] || failures+=("receipt_timer_inactive")
[[ "$gateway_status" == "healthy" ]] || failures+=("gateway_unreachable")
[[ "$dead_letter_count" -eq 0 ]] || failures+=("dead_letter_present")
if [[ "$outbox_count" -gt 0 && "$oldest_outbox_age_seconds" -gt "$MAX_OUTBOX_AGE_SECONDS" ]]; then
  failures+=("outbox_stalled")
fi

failures_json="$(
  if [[ "${#failures[@]}" -eq 0 ]]; then
    printf '[]\n'
  else
    printf '%s\n' "${failures[@]}" | jq -R . | jq -s .
  fi
)"

jq -cn \
  --arg status "$([[ "${#failures[@]}" -eq 0 ]] && printf healthy || printf unhealthy)" \
  --arg observed_at "$(date --utc +%Y-%m-%dT%H:%M:%SZ)" \
  --arg openryoko_service "$openryoko_service" \
  --arg receipt_timer "$receipt_timer" \
  --arg gateway "$gateway_status" \
  --argjson outbox_count "$outbox_count" \
  --argjson dead_letter_count "$dead_letter_count" \
  --argjson oldest_outbox_age_seconds "$oldest_outbox_age_seconds" \
  --argjson disk_used_percent "$disk_used_percent" \
  --argjson memory_available_kib "$memory_available_kib" \
  --argjson failures "$failures_json" \
  '{
    status: $status,
    observed_at: $observed_at,
    services: {
      openryoko: $openryoko_service,
      receipt_timer: $receipt_timer,
      gateway: $gateway
    },
    receipt_delivery: {
      outbox_count: $outbox_count,
      dead_letter_count: $dead_letter_count,
      oldest_outbox_age_seconds: $oldest_outbox_age_seconds
    },
    resources: {
      disk_used_percent: $disk_used_percent,
      memory_available_kib: $memory_available_kib
    },
    failures: $failures
  }'

[[ "${#failures[@]}" -eq 0 ]]
