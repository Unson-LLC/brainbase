#!/bin/bash
# Shared helpers for resolving non-secret Infisical targets.

infisical_target_repo_root() {
  local source_dir
  source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$source_dir/../.." >/dev/null 2>&1 && pwd
}

infisical_expand_user_path() {
  local value="$1"
  case "$value" in
    "~") printf '%s\n' "$HOME" ;;
    "~/"*) printf '%s/%s\n' "$HOME" "${value:2}" ;;
    *) printf '%s\n' "$value" ;;
  esac
}

infisical_resolve_target() {
  local target_name="$1"
  local repo_root
  local resolver
  local output

  repo_root="${BRAINBASE_REPO_ROOT:-$(infisical_target_repo_root)}"
  resolver="$repo_root/scripts/lib/resolve-infisical-target.mjs"
  if [ ! -f "$resolver" ]; then
    echo "Infisical target resolver not found: $resolver" >&2
    return 2
  fi

  output="$(node "$resolver" --shell "$target_name")" || return $?
  eval "$output"
}

infisical_target_auth_file_at() {
  local index="$1"
  local var_name="INFISICAL_TARGET_AUTH_FILE_${index}"
  local raw="${!var_name:-}"
  [ -n "$raw" ] || return 1
  infisical_expand_user_path "$raw"
}

infisical_first_existing_target_auth_file() {
  local count="${INFISICAL_TARGET_AUTH_FILE_COUNT:-0}"
  local index=1
  local file

  while [ "$index" -le "$count" ]; do
    file="$(infisical_target_auth_file_at "$index" || true)"
    if [ -n "$file" ] && [ -f "$file" ]; then
      printf '%s\n' "$file"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

infisical_target_token_file() {
  local raw="${INFISICAL_TARGET_TOKEN_FILE:-}"
  [ -n "$raw" ] || return 1
  infisical_expand_user_path "$raw"
}

infisical_target_required_keys_joined() {
  local count="${INFISICAL_TARGET_REQUIRED_KEY_COUNT:-0}"
  local index=1
  local var_name
  local key
  local joined=""

  while [ "$index" -le "$count" ]; do
    var_name="INFISICAL_TARGET_REQUIRED_KEY_${index}"
    key="${!var_name:-}"
    if [ -n "$key" ]; then
      if [ -n "$joined" ]; then
        joined="$joined $key"
      else
        joined="$key"
      fi
    fi
    index=$((index + 1))
  done
  printf '%s\n' "$joined"
}

infisical_require_private_file() {
  local file="$1"
  local mode
  mode="$(stat -f '%OLp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || true)"
  case "$mode" in
    400|600) ;;
    *) return 1 ;;
  esac
}

infisical_read_env_file_value() {
  local file="$1"
  local key="$2"
  awk -v wanted="$key" '
    $0 ~ "^[[:space:]]*#" || $0 !~ "=" { next }
    {
      line=$0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      key=parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key != wanted) next
      sub(/^[^=]*=/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line ~ /^".*"$/ || line ~ /^'\''.*'\''$/) {
        line=substr(line, 2, length(line)-2)
      }
      print line
      exit
    }
  ' "$file"
}
