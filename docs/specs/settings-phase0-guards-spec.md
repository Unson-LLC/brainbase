---
spec_id: SPEC-settings-phase0-guards
title: Settings Phase 0 Guards Specification
status: draft
date: 2026-05-11
story_id: str.brainbase.settings-phase0-guards
related_adrs:
  - ADR-008
related_specs:
  - SPEC-acl-contract-test
implementation_files:
  - public/modules/settings/settings-core.js
  - public/modules/settings/settings-ui.js
  - server/routes/config.js
  - lib/config-parser.js
test_files:
  - tests/settings/phase0/**/*.test.js
---

# SPEC: Settings Phase 0 Guards

## 目的

account-foundation を載せる前に、既存 settings 機構の脆弱点 4 つを塞ぐ。Codex 評価で指摘された：
1. CoreApiClient が HttpClient（CSRF）を経由せず raw fetch
2. config route に requireAuth / role check 明示なし
3. plugin displayName を innerHTML 直挿し（XSS）
4. ConfigParser cache を write 後に invalidate していない

## Invariants

- **INV-1**: settings/config 系の API call は CSRF token 自動付与（HttpClient 経由）。
- **INV-2**: config write route は server-side requireAuth + role check で保護される。
- **INV-3**: plugin displayName は escape されてから innerHTML に入る（XSS 不可）。
- **INV-4**: ConfigService.write() 後、ConfigParser cache が invalidate される。

## Contracts

### Contract-1: HttpClient adoption

`CoreApiClient`（settings-core.js）の raw `fetch` 呼び出しを既存 `public/modules/core/http-client.js` の `HttpClient` に置換。CSRF token は HttpClient が header に自動付与する。

### Contract-2: config route auth

```js
// server/routes/config.js
router.post('/config', requireAuth, requireRole('gm'), controller.updateConfig);
router.get('/config', requireAuth, controller.getConfig);
```

### Contract-3: displayName escape

```js
// public/modules/settings/settings-ui.js
const label = escapeHtml(plugin.displayName || plugin.id);
container.innerHTML = `<button>${label}</button>`;
```

### Contract-4: ConfigParser cache invalidation

```js
// lib/config-parser.js or server/services/config-service.js
async write(content) {
  await fs.writeFile(...);
  ConfigParser.invalidateCache();  // 新規 method
}
```

## Scenarios

- **S-1**: API call が CSRF token を含む（HttpClient 経由確認）
- **S-2**: 未認証 actor が POST /api/config → 401
- **S-3**: member role actor が POST /api/config → 403
- **S-4**: plugin displayName `<img src=x onerror=alert(1)>` が escape される
- **S-5**: config write 後の getConfig が新値を返す（cache stale 解消）

## Anti-patterns

- **AP-1**: raw fetch を残す（CSRF bypass）
- **AP-2**: requiredLevel UI チェックだけで write を許可（server gate なし）
- **AP-3**: innerHTML に user-supplied displayName を直接埋め込む

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜4, S-1〜5, AP-1〜3 | tests/settings/phase0/**/*.test.js | ✅ |

合計 12 test files。

## 受け入れ基準

- [ ] CoreApiClient → HttpClient adaptation
- [ ] config routes に requireAuth + requireRole
- [ ] settings-ui.js で escapeHtml 通す
- [ ] ConfigParser.invalidateCache() を ConfigService.write が呼ぶ
- [ ] 12 test files pass
- [ ] Spec ✅
