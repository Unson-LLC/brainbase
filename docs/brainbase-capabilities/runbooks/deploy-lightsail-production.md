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

Do not proceed if the worktree is dirty — inspect the diff first and decide whether it is server-only state that must be preserved or stale changes.

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
npm ci --omit=dev
```

Before restarting the API/MCP service, run the mandatory Info SSOT RLS gate. A failed gate means the service must remain stopped; do not treat a previous Receipt as a successful current apply.

```bash
TARGET_SHA="$(git rev-parse HEAD)"
INFO_SSOT_GIT_SHA="$TARGET_SHA" \
INFO_SSOT_ROLLBACK_SHA="$ROLLBACK_SHA" \
INFO_SSOT_APPLY_RECEIPT_PATH="var/info-ssot-apply-receipt.json" \
bash scripts/info-ssot-apply.sh
```

The command must return successfully and produce a Receipt with `readback.status=passed` and `negative_smoke.status=passed`. See [`info-ssot-rls-deployment.md`](../../../runbooks/info-ssot-rls-deployment.md) for the transaction, evidence, and rollback contract.

## 3. Restart the service

```bash
sudo systemctl restart brainbase-ssot.service
sleep 3
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
curl -fsS https://bb.unson.jp/api/version | TARGET_SHA="$TARGET_SHA" node -e '
const value = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const git = value.runtime?.git;
if (git?.sha !== process.env.TARGET_SHA || git?.dirty !== false) {
  console.error(`Unexpected public runtime Git state: ${JSON.stringify(git)}`);
  process.exit(1);
}
console.log(JSON.stringify(git));
'
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

## 5. Roll back to the recorded SHA

Use only the SHA recorded in the pre-check. A branch reset is unnecessary and prohibited. Preserve server logs and `~/.codex/var/judgment-resolver` journals.

```bash
ROLLBACK_SHA="<40-character SHA printed during pre-check>"
grep -Eq '^[0-9a-f]{40}$' <<<"$ROLLBACK_SHA"
cd /home/ubuntu/brainbase
test -z "$(git status --porcelain)"
FAILED_SHA="$(git rev-parse HEAD)"
git cat-file -e "${ROLLBACK_SHA}^{commit}"
git switch --detach "$ROLLBACK_SHA"
if ! git diff --quiet "$ROLLBACK_SHA" "$FAILED_SHA" -- package.json package-lock.json; then
  npm ci --omit=dev
fi
INFO_SSOT_GIT_SHA="$ROLLBACK_SHA" \
INFO_SSOT_ROLLBACK_SHA="$FAILED_SHA" \
INFO_SSOT_APPLY_RECEIPT_PATH="var/info-ssot-rollback-receipt.json" \
bash scripts/info-ssot-apply.sh
sudo systemctl restart brainbase-ssot.service
sleep 3
curl -fsS http://127.0.0.1:55123/api/health
curl -fsS http://127.0.0.1:55123/api/version | TARGET_SHA="$ROLLBACK_SHA" node -e '
const value = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const git = value.runtime?.git;
if (git?.sha !== process.env.TARGET_SHA || git?.dirty !== false) process.exit(1);
console.log(JSON.stringify(git));
'
```

From the Mac, repeat the public `/api/version`, `/api/health`, and authenticated Graph checks from section 4 with `TARGET_SHA="$ROLLBACK_SHA"`. A successful instance check alone does not complete rollback.

For a Judgment Resolver deployment, this is only the Lightsail step. Follow the four-surface rollback order in [`judgment-resolve.md`](./judgment-resolve.md#rollback) to restore the global Hook checkout, local `:31013`, persistent MCP runtime, Lightsail, and exact prior Hook file as one compatible set.

## 6. Recovery notes

- `Restart=always` / `RestartSec=5`: the service self-restarts on crash; a crash loop is visible in `journalctl -u brainbase-ssot.service`.
- Memory guard: `MemoryHigh=900M`, `MemoryMax=1200M`, `OOMPolicy=kill` — OOM kills show up as unit restarts.
- If `bb.unson.jp` fails but `127.0.0.1:55123` works, the problem is the Docker proxy chain: `docker ps` and `docker logs nginx-proxy --tail 20` / `docker logs brainbase-ssot-proxy` (compose in `/home/ubuntu/`).
- DB is System PostgreSQL 14 (`brainbase_ssot`), not Docker: `systemctl status postgresql`.

Related: `../../architecture/lightsail-infrastructure.md` (full server map).
