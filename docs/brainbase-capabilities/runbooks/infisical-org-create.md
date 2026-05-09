# Runbook: Create New Infisical Organization

Use this when a new legal entity needs its own Infisical Org (e.g., spinning out a product into a separate company, or onboarding a partner with its own infra).

self-hosted Infisical (`https://infisical.unson.jp`) Community版ではOrg switcher dropdownにOrg作成UIが出ない。CLI/APIで作成する。

## Pre-flight

```bash
# CLI is installed and logged in (Mac本体での login が安定)
~/.local/bin/infisical --version
~/.local/bin/infisical user get token --plain | head -c 5  # token先頭だけ確認、本体は出さない
```

ログインが切れている場合は Mac 本体ターミナルで:

```bash
~/.local/bin/infisical login --domain https://infisical.unson.jp
```

ttyd経由のセッションはbrowser callback先のlocalhostがCLI host側になるため失敗する。

## Create Org

```bash
JWT=$(~/.local/bin/infisical user get token --plain 2>/dev/null)

curl -sS -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"<OrgName>"}' \
  "https://infisical.unson.jp/api/v2/organizations" \
  | jq '.organization | {id, name, slug}'
```

Creator (login user) は自動で admin role 付与される。

## Verify

```bash
curl -sS -H "Authorization: Bearer $JWT" \
  "https://infisical.unson.jp/api/v1/organization" \
  | jq '.organizations[] | {name, slug}'
```

## Switch Scope For Cross-Org Operations

```bash
SCOPED=$(curl -sS -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"organizationId\":\"<NEW_ORG_ID>\"}" \
  "https://infisical.unson.jp/api/v3/auth/select-organization" | jq -r '.token')
```

新Org内のリソース操作は `$SCOPED` を Authorization に使う。

## Invite Members

```bash
curl -sS -X POST -H "Authorization: Bearer $SCOPED" -H "Content-Type: application/json" \
  -d '{"inviteeEmails":["someone@example.com"],"organizationId":"<NEW_ORG_ID>","organizationRoleSlug":"admin"}' \
  "https://infisical.unson.jp/api/v1/invite-org/signup"
```

`completeInviteLinks: []` が返れば SMTP 経由で招待メールが送信されている。

## Cleanup On Mistake

probe など誤って作った Org を削除する場合は、その Org に scope してから:

```bash
curl -sS -X DELETE -H "Authorization: Bearer $SCOPED" \
  "https://infisical.unson.jp/api/v2/organizations/<ID>"
```

JWT scope が他Orgだと 403 になる。
