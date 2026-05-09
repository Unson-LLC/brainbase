# Runbook: Migrate Infisical Secrets Across Orgs/Projects

Use this when secrets need to move from one Infisical Org/project to another (e.g., post Org分離, project rename, env restructure).

secret値は端末・ログ・diffに出さないこと。すべての中間ファイルは chmod 600 + 上書き削除。

## Pre-flight

事前にマイグレーション元と先のIDを揃える。

```bash
JWT=$(~/.local/bin/infisical user get token --plain 2>/dev/null)
SRC_ORG=<source-org-id>
DST_ORG=<dest-org-id>

scope() {
  curl -sS -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d "{\"organizationId\":\"$1\"}" \
    "https://infisical.unson.jp/api/v3/auth/select-organization" | jq -r '.token'
}
SRC=$(scope "$SRC_ORG")
DST=$(scope "$DST_ORG")
```

## Step 1. Count Source Secrets (No Values)

```bash
curl -sS -H "Authorization: Bearer $SRC" \
  "https://infisical.unson.jp/api/v3/secrets/raw?workspaceId=<SRC_PROJECT_ID>&environment=<ENV>&secretPath=<PATH_URLENCODED>" \
  | jq '.secrets | length'
```

migration対象が複数env/pathに分かれている場合は全て列挙する。

## Step 2. Pull Source To Secure Tmp

```bash
mkdir -p /tmp/migrate
chmod 700 /tmp/migrate

curl -sS -H "Authorization: Bearer $SRC" \
  "https://infisical.unson.jp/api/v3/secrets/raw?workspaceId=<SRC_PROJECT_ID>&environment=<ENV>&secretPath=<PATH>" \
  -o /tmp/migrate/src.json
chmod 600 /tmp/migrate/src.json
```

key名のみ確認:

```bash
jq -r '.secrets[].secretKey' /tmp/migrate/src.json | sort
```

## Step 3. Create Target Folder If Path Is Not Root

```bash
curl -sS -X POST -H "Authorization: Bearer $DST" -H "Content-Type: application/json" \
  -d '{"workspaceId":"<DST_PROJECT_ID>","environment":"<ENV>","name":"<folder-name>","path":"/"}' \
  "https://infisical.unson.jp/api/v1/folders" | jq '.folder.path'
```

ルート (`/`) なら不要。

## Step 4. Bulk Import

```bash
jq -c --arg env "<ENV>" '{
  projectSlug:"<DST_SLUG>",
  environment:$env,
  secretPath:"<PATH>",
  secrets: [.secrets[] | {
    secretKey,
    secretValue,
    secretComment: (.secretComment // ""),
    type: (.type // "shared"),
    skipMultilineEncoding: (.skipMultilineEncoding // false)
  }]
}' /tmp/migrate/src.json > /tmp/migrate/payload.json
chmod 600 /tmp/migrate/payload.json

curl -sS -X POST -H "Authorization: Bearer $DST" -H "Content-Type: application/json" \
  -d @/tmp/migrate/payload.json \
  "https://infisical.unson.jp/api/v3/secrets/batch/raw" \
  -o /tmp/migrate/result.json
chmod 600 /tmp/migrate/result.json

jq '.secrets | length' /tmp/migrate/result.json
```

## Step 5. Verify Hash Match

```bash
curl -sS -H "Authorization: Bearer $DST" \
  "https://infisical.unson.jp/api/v3/secrets/raw?workspaceId=<DST_PROJECT_ID>&environment=<ENV>&secretPath=<PATH>" \
  -o /tmp/migrate/dst.json
chmod 600 /tmp/migrate/dst.json

SRC_HASH=$(jq -r '.secrets | sort_by(.secretKey) | .[] | "\(.secretKey)=\(.secretValue)"' /tmp/migrate/src.json | shasum -a 256 | awk '{print $1}')
DST_HASH=$(jq -r '.secrets | sort_by(.secretKey) | .[] | "\(.secretKey)=\(.secretValue)"' /tmp/migrate/dst.json | shasum -a 256 | awk '{print $1}')
[ "$SRC_HASH" = "$DST_HASH" ] && echo "OK" || echo "MISMATCH"
```

key名一致は別途 `diff <(jq -r '.secrets[].secretKey' src.json | sort) <(jq -r ... dst.json | sort)`。

## Step 6. Cleanup

```bash
for f in /tmp/migrate/*.json; do
  SIZE=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  /bin/dd if=/dev/urandom of="$f" bs=1 count="$SIZE" conv=notrunc 2>/dev/null
  /bin/rm -f "$f"
done
rmdir /tmp/migrate
```

## Step 7. Pre-Delete Safety Check

旧project削除前に runtime consumer がないか確認:

```bash
curl -sS -H "Authorization: Bearer $SRC" \
  "https://infisical.unson.jp/api/v1/workspace/<SRC_PROJECT_ID>/service-token" | jq '.serviceTokenData | length'
curl -sS -H "Authorization: Bearer $SRC" \
  "https://infisical.unson.jp/api/v2/workspace/<SRC_PROJECT_ID>/identity-memberships" | jq '.identityMemberships | length'
curl -sS -H "Authorization: Bearer $SRC" \
  "https://infisical.unson.jp/api/v1/workspace/<SRC_PROJECT_ID>/integrations" | jq '.integrations | length'
```

3つとも `0` なら自動runtimeから参照されていない。直書きの `INFISICAL_PROJECT_ID=<SRC_ID>` がGitHub Actions/Vercelに残っているケースは事前検知不可。

## Step 8. Delete Old Project

deleteProtection が true なら先に解除:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $SRC" -H "Content-Type: application/json" \
  -d '{"hasDeleteProtection":false}' \
  "https://infisical.unson.jp/api/v1/workspace/<SRC_PROJECT_ID>" | jq '.workspace.hasDeleteProtection'

curl -sS -X DELETE -H "Authorization: Bearer $SRC" \
  "https://infisical.unson.jp/api/v1/workspace/<SRC_PROJECT_ID>"
```

## Rollback

完全に失敗した場合:

- 新Org側のproject DELETE で逆方向cleanup
- 旧Org側projectを残していれば runtime は影響なし (Identity/integrationが旧側のまま)
- どうしようもない場合は Lightsail snapshot `brainbase-nocodb-before-infisical-*` から復元
