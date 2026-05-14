---
story_id: story-salestailor-ops-refactor-kernel-adapter
title: salestailor ops-department-auto-refactoring を kernel adapter 化する
source_requirement:
  parent_story: STR-006
architecture_docs:
  - path: docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
    status: accepted
depends_on:
  - story-candidate-store-cross-repo-write
status: draft
created_at: 2026-05-14
updated_at: 2026-05-14
---

# story-salestailor-ops-refactor-kernel-adapter: salestailor ops-department-auto-refactoring を kernel adapter 化する

## 背景

`Unson-LLC/salestailor` の `.github/workflows/ops-department-auto-refactoring.yml` は 3h cron で `scripts/ops-team-review.cjs` を起動し、 Codex (gpt-5-codex) に hotspot ファイルの refactor を試行させる。 結果は **repo 内の `refactoring-history.json`** に書かれ、 judge スコア >=90 なら PR 自動作成。

これは **「学習ループ」 と銘打っているが、 実体は repo 内 silo で完結する別 promotion 系**。 ADR-010 で確定した「candidate-store が canonical Memory Promotion Kernel、 他ソースは adapter として envelope を emit する」 という Decision に **直接違反している**。

加えて:

- cooldown 30 日 + TOP-N 20 file + 1 cycle 5 file の構造で 24h おきで十分律速されるため、 **3h おき (8 cycle/日) は学習効率に何も貢献していない**
- 過去 30 日で 27 success / 3 failure、 実 PR 化は 5/7 のバッチ 6 件以外で 2 ヶ月空白 = silo 学習に閉じているため他 repo / 他人格に再利用されていない
- 「judge<90 で reject された判断理由」 や 「hotspot pattern の cross-repo 性」 は kernel に流せば組織学習として再利用可能、 現状は捨てられている

「個人 KG (= candidate-store + Graph SSOT) ができた」 = silo 維持の戦略的根拠が消えた。

## 現状

- ops-refactor は別 promotion 系として独立稼働
- 学習履歴は `refactoring-history.json` (salestailor repo 内のみ)
- 他 repo / mana / brainbase Graph SSOT に何も流れていない
- 3h cron で 1 日 8 回起動、 大半は no-op の空回り (CloudWatch / GitHub Actions log に noise を蓄積)

## 変更内容

### Phase P0 (即時、 brainbase 外で完結): cron 削減

- `.github/workflows/ops-department-auto-refactoring.yml` の `schedule.cron` を削除、 `workflow_dispatch` のみ残す
- ops 部門で「明示的に走らせたい時だけ」 起動できる状態に縮退
- silo 学習 noise を即時停止し、 ADR-010 違反を最小化する

### Phase P1 (依存: `story-candidate-store-cross-repo-write` 完了後)

- brainbase 側 candidate-store の cross-repo write endpoint が公開されていることを前提に進む
- HMAC secret `CANDIDATE_STORE_HMAC_SALESTAILOR` を Infisical に登録

### Phase P2 (実装): salestailor を adapter 化

- `scripts/ops-team-review.cjs` を改修:
  - hotspot 検出結果、 judge 評価、 refactor diff、 reject 理由を Raw Ledger envelope 形式に変換
  - `source_system: 'salestailor_ops_refactor'`、 `source_event_id`, `evidence_ref` を SPEC-006 通り埋める
  - brainbase の `POST /api/candidate-store/raw-ledger` に HMAC 付きで投げる
- `refactoring-history.json` は **完全廃止** (= brainbase kernel が SSOT)
  - もしくは「過渡期の局所 cache」 として残す場合は 「kernel への投函成功フラグ」 を付与し、 投函失敗時のリプレイ用にする
- PR 自動作成機能は維持 (= 学習と自動化は別関心事、 PR 化は automation の話)

### Phase P3 (再起動): cron を kernel adapter モードで復活させるか判断

- adapter 経由で 24h おきに走らせるか、 トリガを 「hotspot 検出ジョブ完了 → kernel」 に切り替えるか
- silo 時代の 3h cron は復活させない (cooldown 30d で律速されているため意味なし)

## 成功指標

- [ ] P0 完了後、 salestailor の ops-refactor 由来 cron run が 0 件/日になる
- [ ] P2 完了後、 brainbase candidate-store に `source_system: 'salestailor_ops_refactor'` の envelope が記録される
- [ ] judge<90 で reject された refactor 試行も candidate として記録 (= 失敗パターンも学習資産として保持)
- [ ] 「同じ hotspot pattern を別 repo (mana / zeims) が当たった」 ケースで Graph 経由で参照できる
- [ ] `refactoring-history.json` が salestailor repo から削除される (or freeze)

## First Slice

- P0 のみ: `ops-department-auto-refactoring.yml` から `schedule:` ブロックを削除する PR を salestailor repo に投げる
- 完了境界: PR merge 後 24h 経過時点で salestailor の `ops-department-auto-refactoring` workflow run が 0 件

## 受け入れ基準

- [ ] P0 後、 salestailor の `ops-department-auto-refactoring` workflow が `workflow_dispatch` only になる
- [ ] P0 後、 CloudWatch / GitHub Actions log の noise が 87% 削減 (3h → 0 cycle/日)
- [ ] P1 完了 (candidate-store cross-repo write endpoint 公開) を blocker として認識
- [ ] P2 完了後、 salestailor 起動毎に brainbase kernel に envelope が届く
- [ ] P2 完了後、 `refactoring-history.json` が SSOT として参照されない

## Scope 外

- mana / zeims など別 silo の kernel 統合 (= 別 sub-story として STR-006 配下に起票)
- candidate-store endpoint の実装 (= story-candidate-store-cross-repo-write で扱う)
- Codex CLI 自体の改善 (= 上流 OSS の話)
- ops-refactor 自体の役割再定義 (「自動 refactor の戦略上の価値」 自体を問い直す議論は別)

## 補足: なぜ 「単純廃止」 ではなく adapter 化なのか

ADR-010 は **silo を kernel に統合する道筋** を示しているのであって、 「automation 機能自体を廃止せよ」 とは言っていない。 ops-refactor の自動 PR 作成は automation として価値があり (5/7 のバッチが示した)、 維持すべきは automation 側。 廃止すべきは silo の学習基盤模倣。

両者を切り分け、 学習部分のみ kernel に統合することで:

1. 戦略整合 (ADR-010 vision の実現)
2. 組織学習資産化 (judge / hotspot pattern が cross-repo で活きる)
3. log/cost 即時削減 (P0 で 87%)
4. 廃止/維持の二者択一ではない第三の道 (= forcing function として ADR-010 を完成させる)
