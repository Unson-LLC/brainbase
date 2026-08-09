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
curl -s http://127.0.0.1:55123/api/version | jq '.version, .runtime.git'
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
curl -s http://127.0.0.1:55123/api/health
curl -s http://127.0.0.1:55123/api/version | jq '.runtime.git.sha, .runtime.git.dirty'
journalctl -u brainbase-ssot.service --since "-5 min" --no-pager | tail -20

# From your Mac
curl -s -o /dev/null -w "%{http_code}\n" https://bb.unson.jp/api/health
TOKEN=$(jq -r .access_token ~/.brainbase/tokens.json)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://bb.unson.jp/api/info/graph/entities?type=project&limit=1" | jq '.[0].entity_id? // .'
```

Expected:

- `runtime.git.sha` matches the intended `origin/develop` commit
- `runtime.git.dirty` is `false`
- `https://bb.unson.jp/api/health` returns `200`
- Graph API returns entities with a valid token

## 5. Recovery notes

- `Restart=always` / `RestartSec=5`: the service self-restarts on crash; a crash loop is visible in `journalctl -u brainbase-ssot.service`.
- Memory guard: `MemoryHigh=900M`, `MemoryMax=1200M`, `OOMPolicy=kill` — OOM kills show up as unit restarts.
- If `bb.unson.jp` fails but `127.0.0.1:55123` works, the problem is the Docker proxy chain: `docker ps` and `docker logs nginx-proxy --tail 20` / `docker logs brainbase-ssot-proxy` (compose in `/home/ubuntu/`).
- DB is System PostgreSQL 14 (`brainbase_ssot`), not Docker: `systemctl status postgresql`.

Related: `../../architecture/lightsail-infrastructure.md` (full server map).
