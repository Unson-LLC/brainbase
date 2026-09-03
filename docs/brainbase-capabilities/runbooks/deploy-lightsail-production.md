# Runbook: Deploy Lightsail Production (bb.unson.jp)

Use this when the Lightsail production SSOT server (`https://bb.unson.jp`) needs to pick up merged develop code, or when it needs recovery after an outage.

- Instance: `brainbase-nocodb` (AWS ap-northeast-1), `ubuntu@176.34.20.239`
- Repo checkout: `/home/ubuntu/brainbase` (detached HEAD pinned to a develop commit)
- Runtime: `systemd` unit `brainbase-ssot.service` → `node server.js` on host port `55123`
- Public path: `bb.unson.jp` → nginx-proxy → `brainbase-ssot-proxy` → `host.docker.internal:55123`

## 0. Connect

```bash
ssh -i ~/.ssh/lightsail-brainbase.pem ubuntu@176.34.20.239
```

If using the `paperclip` alias, confirm `~/.ssh/config` points `Host paperclip` at `176.34.20.239` (the old IP `54.249.13.70` is retired).

## 1. Pre-check current state

```bash
cd /home/ubuntu/brainbase
git status -sb            # must be clean; HEAD is normally detached at a develop commit
git log --oneline -3
systemctl status brainbase-ssot.service --no-pager | head -8
curl -fsS http://127.0.0.1:55123/api/version | node -e '
const value = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
console.log(JSON.stringify({ version: value.version, git: value.runtime?.git }, null, 2));
'
ROLLBACK_SHA="$(git rev-parse HEAD)"
grep -Eq '^[0-9a-f]{40}$' <<<"$ROLLBACK_SHA"
printf 'Record this Lightsail rollback SHA before deployment: %s\n' "$ROLLBACK_SHA"
```

Do not proceed if the worktree is dirty. First save the exact patch, untracked
file list, HEAD, service status, and `/api/version` response in an operator-only
rollback directory outside the checkout. Classify every tracked change against
the intended target commit. Restore a clean checkout only after proving each
change is already present in the target or preserving it as a reviewed patch;
never reset, clean, or stash an unclassified production change. Read back the
instance and public version with `dirty=false` before starting section 2.

## 2. Fast-forward to the target develop commit

```bash
cd /home/ubuntu/brainbase
git fetch origin
git merge --ff-only origin/develop
git log --oneline -1      # confirm the intended SHA
```

Only fast-forward merges are allowed. If `--ff-only` fails, the server checkout has diverged — stop and investigate; do not reset or force.

If `package.json` / `package-lock.json` changed in the range:

```bash
npm ci --omit=dev --ignore-scripts
```

Before restarting or switching the API/MCP service, run the mandatory Info SSOT RLS gate. A failed gate means no restart or SHA switch may proceed; verify the current service state and do not treat a previous Receipt as a successful current apply.

```bash
TARGET_SHA="$(git rev-parse HEAD)"
INFO_SSOT_GIT_SHA="$TARGET_SHA" \
INFO_SSOT_ROLLBACK_SHA="$ROLLBACK_SHA" \
INFO_SSOT_OPERATION_MODE="apply" \
INFO_SSOT_APPLY_RECEIPT_PATH="var/info-ssot-apply-receipt.json" \
bash scripts/info-ssot-apply.sh
```

The command must return successfully and produce a Receipt with `readback.status=passed`, `negative_smoke.status=passed`, and a safe `server_version`. See [`info-ssot-rls-deployment.md`](../../runbooks/info-ssot-rls-deployment.md) for the transaction, evidence, and rollback contract.

### Personal KG二段階昇格を含むrelease

対象差分に`personal-knowledge-two-stage-promotion.sql`または署名昇格runtimeが含まれる場合は、一般restartへ進む前に次の順序を守る。旧writerを動かしたままmigrationしない。

```bash
(
set -euo pipefail
TARGET_SHA="$(git rev-parse HEAD)"
grep -Eq '^[0-9a-f]{40}$' <<<"$TARGET_SHA"

# 1. writeを排水して停止し、inactiveをreadbackする。
sudo systemctl stop brainbase-ssot.service
if sudo systemctl is-active --quiet brainbase-ssot.service; then
  echo "brainbase-ssot.service is still active" >&2
  exit 1
fi

# 2. systemdと同じenv filesを読み、接続先を値非表示で検証する。
set -a
. /home/ubuntu/brainbase/.env
. /home/ubuntu/brainbase/.env.infisical
set +a
# Personal KG repositoryと同じInfo SSOT接続先を一度だけ確定する。
# SNS posting ledgerや汎用DATABASE_URLへはfallbackしない。
M5A_DATABASE_URL="${INFO_SSOT_DATABASE_URL:-${INFO_SSOT_DB_URL:-}}"
export M5A_DATABASE_URL
test -n "$M5A_DATABASE_URL"

# DB identity、status別件数、総件数、移行対象request_id集合を0600のReceiptへ固定する。
PERSONAL_KG_RELEASE_RECEIPT="var/personal-knowledge-migration-release-receipt.json"
TARGET_SHA="$TARGET_SHA" node scripts/personal-knowledge-migration-release-gate.mjs \
  preflight "$PERSONAL_KG_RELEASE_RECEIPT"

# 3. 対応checkoutのmigrationを適用する。
npm run migrate:m5a -- --only personal-knowledge

# 4. 同一対象集合のfail-closed移行、総件数・対象外status不変、RLSを機械判定する。
TARGET_SHA="$TARGET_SHA" node scripts/personal-knowledge-migration-release-gate.mjs \
  postflight "$PERSONAL_KG_RELEASE_RECEIPT"
)
```

postflightは、移行対象request ID集合が全件`pending_owner_approval`へ移りowner同意証跡がNULLへ戻ったこと、総行数不変、旧終端statusの決定的な変換（`approved`→`org_accepted`、`rejected`→`owner_rejected`）以外のstatus件数不変、RLSがENABLE/FORCEであることをすべて満たす場合だけ`status=passed`を同じReceiptへ保存する。失敗時は非zero終了し、serviceを起動しない。成功時だけsection 3で同じ`TARGET_SHA`のserviceを起動し、Personal KG本番スモークのDB/API/Graph/Receipt readbackまで実行する。

このmigration適用後は、A0署名昇格対応前のSHAへ通常rollbackしてはならない。対応SHAが起動できない場合は`brainbase-ssot.service`を停止したままpromotion writeを全面停止し、readback済みのA0対応SHAへforward fixする。DB down migrationや旧writerの再公開はしない。

### Slack installation failure diagnosticを含むrelease

対象差分に`013_slack_installation_failure_diagnostics.sql`、`tenant-production-provisioning-schema.sql`のSlack diagnostic列、またはそれらを参照するruntimeが含まれる場合は、runtimeより先にschemaを適用する。新runtimeは`failure_stage`と`cleanup_status`を通常経路で参照するため、schema未適用のままserviceを再起動してはならない。

```bash
(
set -euo pipefail
TARGET_SHA="$(git rev-parse HEAD)"
grep -Eq '^[0-9a-f]{40}$' <<<"$TARGET_SHA"

# systemdと同じ秘密管理envを読み、URL自体は表示しない。
set -a
. /home/ubuntu/brainbase/.env
. /home/ubuntu/brainbase/.env.infisical
set +a
test -n "${INFO_SSOT_DATABASE_URL:-${INFO_SSOT_DB_URL:-}}"

# apply前に同じDDLをtransaction内で検証し、lock timeout超過時は停止する。
node scripts/migrate-tenant-production-provisioning.js --dry-run

# 対象環境、TARGET_SHA、actorをrelease記録へ固定した承認済みoperatorだけが実行する。
BRAINBASE_MIGRATION_ACTOR="<approved operator>" \
  node scripts/migrate-tenant-production-provisioning.js --apply --approve-apply

# 列、CHECK制約、migration ledgerのschema hashを再読込する。
node scripts/migrate-tenant-production-provisioning.js --check
)
```

`--dry-run`、`--apply`、`--check`のいずれかが失敗した場合はsection 3へ進まず、現在のserviceを維持する。適用前に本番台帳件数と実行中transactionを確認し、`lock_timeout=5s`内に安全に取得できない場合は負荷の低い時間帯へ延期する。apply後は列をdown migrationしない。新runtimeの起動後に失敗した場合はserviceを停止し、追加列を無視できる読戻し済みのservice SHAへ戻すかforward fixする。旧SHAが追加列と互換であることを確認できない場合は起動しない。

## 3. Restart the service

```bash
sudo systemctl restart brainbase-ssot.service
node scripts/wait-for-brainbase-runtime.mjs http://127.0.0.1:55123/api/health
systemctl status brainbase-ssot.service --no-pager | head -8
```

The unit is `/etc/systemd/system/brainbase-ssot.service` with drop-ins (`infisical-env.conf`, `memory.conf`, `project-catalog-mode.conf`). Env comes from `/home/ubuntu/brainbase/.env` and `.env.infisical` — do not export secrets in the shell.

## 4. Verify

```bash
# On the instance
TARGET_SHA="$(git rev-parse HEAD)"
curl -fsS http://127.0.0.1:55123/api/health
curl -fsS http://127.0.0.1:55123/api/version | TARGET_SHA="$TARGET_SHA" node -e '
const value = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const git = value.runtime?.git;
if (git?.sha !== process.env.TARGET_SHA || git?.dirty !== false) {
  console.error(`Unexpected runtime Git state: ${JSON.stringify(git)}`);
  process.exit(1);
}
console.log(JSON.stringify(git));
'
journalctl -u brainbase-ssot.service --since "-5 min" --no-pager | tail -20
```

From your Mac, bind the same merged develop SHA explicitly and verify the public proxy path independently:

```bash
TARGET_SHA="<40-character merged develop SHA>"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]
node scripts/wait-for-brainbase-runtime.mjs https://bb.unson.jp/api/version "$TARGET_SHA"
curl -fsS -o /dev/null -w "%{http_code}\n" https://bb.unson.jp/api/health
TOKEN=$(jq -r .access_token ~/.brainbase/tokens.json)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://bb.unson.jp/api/info/graph/entities?type=project&limit=1" | jq '.[0].entity_id? // .'
```

Expected:

- `runtime.git.sha` matches the intended `origin/develop` commit
- `runtime.git.dirty` is `false`
- `https://bb.unson.jp/api/health` returns `200`
- Graph API returns entities with a valid token

## 5. Roll back the service to the recorded SHA

Use only the SHA recorded in the pre-check. A branch reset is unnecessary and prohibited. Preserve server logs and `~/.codex/var/judgment-resolver` journals. The database is forward-only: reapply and verify the current safe RLS bundle before switching only the service code to the recorded SHA.

**Personal KG migration Receiptが存在するreleaseでは、以下の一般rollbackを実行しない。** Receiptの状態にかかわらずserviceを停止したまま、A0対応SHAへforward fixする。この一般手順にはservice rollbackの例外経路を設けない。

```bash
ROLLBACK_SHA="<40-character SHA printed during pre-check>"
grep -Eq '^[0-9a-f]{40}$' <<<"$ROLLBACK_SHA"
sudo systemctl stop brainbase-ssot.service
PERSONAL_KG_RELEASE_RECEIPT="/home/ubuntu/brainbase/var/personal-knowledge-migration-release-receipt.json"
if test -e "$PERSONAL_KG_RELEASE_RECEIPT"; then
  if ! PERSONAL_KG_RELEASE_RECEIPT="$PERSONAL_KG_RELEASE_RECEIPT" node -e '
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.env.PERSONAL_KG_RELEASE_RECEIPT, "utf8"));
process.exit(receipt.schema_version === "personal_knowledge_migration_release.v1" && receipt.status === "passed" ? 0 : 1);
'; then
    echo "Personal KG migration Receipt is unreadable or invalid; general service rollback is blocked." >&2
    exit 1
  fi
  echo "Personal KG migration is forward-only; general service rollback is blocked. Keep the service stopped and forward-fix with an A0-compatible SHA." >&2
  exit 1
fi
cd /home/ubuntu/brainbase
test -z "$(git status --porcelain)"
FAILED_SHA="$(git rev-parse HEAD)"
grep -Eq '^[0-9a-f]{40}$' <<<"$FAILED_SHA"
git cat-file -e "${ROLLBACK_SHA}^{commit}"
INFO_SSOT_GIT_SHA="$FAILED_SHA" \
INFO_SSOT_ROLLBACK_SHA="$ROLLBACK_SHA" \
INFO_SSOT_OPERATION_MODE="rollback_prepare" \
INFO_SSOT_APPLY_RECEIPT_PATH="var/info-ssot-rollback-receipt.json" \
bash scripts/info-ssot-apply.sh
git switch --detach "$ROLLBACK_SHA"
if ! git diff --quiet "$ROLLBACK_SHA" "$FAILED_SHA" -- package.json package-lock.json; then
  npm ci --omit=dev --ignore-scripts
fi
sudo systemctl restart brainbase-ssot.service
node scripts/wait-for-brainbase-runtime.mjs http://127.0.0.1:55123/api/health
curl -fsS http://127.0.0.1:55123/api/version | TARGET_SHA="$ROLLBACK_SHA" node -e '
const value = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const git = value.runtime?.git;
if (git?.sha !== process.env.TARGET_SHA || git?.dirty !== false) process.exit(1);
console.log(JSON.stringify(git));
'
```

From the Mac, repeat the public `/api/version`, `/api/health`, and authenticated Graph checks from section 4 with `TARGET_SHA="$ROLLBACK_SHA"`. A successful instance check alone does not complete rollback.

The rollback Receipt must report `operation_mode=rollback_prepare`, `database_bundle_sha=$FAILED_SHA`, `service_target_sha=$ROLLBACK_SHA`, `rollback.database_strategy=forward_only_rls`, and `rollback.service_strategy=switch_to_recorded_sha`. Do not describe this procedure as a database down migration.

For a Judgment Resolver deployment, this is only the Lightsail step. Follow the four-surface rollback order in [`judgment-resolve.md`](./judgment-resolve.md#rollback) to restore the global Hook checkout, local `:31013`, persistent MCP runtime, Lightsail, and exact prior Hook file as one compatible set.

## 6. Recovery notes

- `Restart=always` / `RestartSec=5`: the service self-restarts on crash; a crash loop is visible in `journalctl -u brainbase-ssot.service`.
- Memory guard: `MemoryHigh=900M`, `MemoryMax=1200M`, `OOMPolicy=kill` — OOM kills show up as unit restarts.
- If `bb.unson.jp` fails but `127.0.0.1:55123` works, the problem is the Docker proxy chain: `docker ps` and `docker logs nginx-proxy --tail 20` / `docker logs brainbase-ssot-proxy` (compose in `/home/ubuntu/`).
- DB is System PostgreSQL 14 (`brainbase_ssot`), not Docker: `systemctl status postgresql`.

Related: `../../architecture/lightsail-infrastructure.md` (full server map).
