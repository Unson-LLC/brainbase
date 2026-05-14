---
story_id: story-candidate-store-cross-repo-write
title: candidate-store の cross-repo write API endpoint を公開する
source_requirement:
  parent_story: STR-006
architecture_docs:
  - path: docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
    status: accepted
spec_docs:
  - path: docs/specs/mana-secretary-memory-promotion-spec.md
    status: accepted
status: draft
created_at: 2026-05-14
updated_at: 2026-05-14
---

# story-candidate-store-cross-repo-write: candidate-store の cross-repo write API endpoint を公開する

## 背景

ADR-010 で `candidate-store` は brainbase の **canonical Memory Promotion Kernel** と決定済み。 mana / zeims / salestailor / SNS feedback などの全ソースは別 promotion 系を作らず、 同じ candidate-store contract に Raw Ledger 互換 envelope を emit する設計。

しかし、 現状は:

- `server/services/candidate-store/` 配下のコアコンポーネント (`candidate-repository.js`, `dreaming-job.js`, `pii-scanner.js`, `promotion-gate-service.js`, `raw-ledger-adapter.js`, `auto-promote-policy/private-preference.js`, `candidate-store-schema.sql`) は **実装済**
- ただし **`server/routes/` / `server/controllers/` に外部 repo から書き込める HTTP endpoint が未公開**
- 結果として cross-repo 連携 (mana / salestailor / zeims など) が **物理的にできない状態**
- silo 学習系 (例: salestailor の `ops-department-auto-refactoring` の `refactoring-history.json`) が kernel に流れ込めず、 ADR-010 違反のまま放置されている

## 現状

- candidate-store の内部 service / repository は動く
- private preference の auto-promote 経路は brainbase 内のみ
- mana / salestailor から envelope を投げる先が無い

## 変更内容

### 何を

- `POST /api/candidate-store/raw-ledger`: Raw Ledger envelope を受信し candidate draft を生成する endpoint
- `POST /api/candidate-store/candidates`: 直接 candidate を投げ込む (mana の Dreaming 出力をそのまま受ける場合用) endpoint
- HMAC + role 検証 (`actions:write` / `candidate:write` 等のスコープを `permission_snapshot.roles` から検証)
- envelope schema 検証 (SPEC-006 の Raw Ledger record 仕様準拠)
- audit log 残存 (誰が、いつ、どこから、何を投げたか)

### なぜ

- ADR-010 vision の **最低前提**。 cross-repo の adapter を書き始める前に「受け口」が無いと話にならない。
- silo の kernel 統合が始まらない最大のブロッカーを除去する。

### 誰が

- 利用側: mana Lambda / salestailor self-hosted runner / zeims プロダクト / 今後の SNS feedback ingestion
- 認証主体: 各 repo の deployment identity (HMAC secret は Infisical 経由で配布)
- 受信主体: brainbase-ui (port 31013 or 独立 service)

## 成功指標

- [ ] mana / salestailor / 任意のテスト client から POST して envelope が candidate-store に届く
- [ ] 不正な envelope (schema 違反 / HMAC 不一致 / role 不足) は 400/401/403 で reject される
- [ ] audit log に source / actor / timestamp / decision が残る
- [ ] 既存 brainbase 内部の candidate-store 処理 (Dreaming, Promotion Gate) が回帰せず動く

## First Slice

- 1 endpoint (`POST /api/candidate-store/raw-ledger`) のみ
- HMAC 検証 + 最小 envelope schema バリデーション
- 受信した envelope を既存 `raw-ledger-adapter.js` 経由で candidate-store に投入
- contract test: 「正常 envelope → candidate 生成成功」 「不正 envelope → 4xx」 の 2 シナリオ

## 受け入れ基準

- [ ] `server/routes/candidate-store-routes.js` (or equivalent) が express に登録される
- [ ] `server/controllers/candidate-store-controller.js` が HMAC + schema 検証を行う
- [ ] envelope 受信から candidate 投入までの flow が contract test で通る
- [ ] HMAC secret は Infisical で管理し、 source ごとに別 secret (`CANDIDATE_STORE_HMAC_MANA`, `CANDIDATE_STORE_HMAC_SALESTAILOR`, ...)
- [ ] OpenAPI / Schema doc が `docs/api/candidate-store-cross-repo-write.md` に出る

## Scope 外 (本 story では扱わない)

- mana / salestailor の adapter 実装 (= 別 story: story-salestailor-ops-refactor-kernel-adapter)
- UI から candidate を見る経路 (= STR-006 First Slice で扱う)
- Dreaming job の改善
- Graph promotion logic の変更
