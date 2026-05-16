# VibePro Autonomous Development Run: People Sync Spec for Detail Entities

## Request

`未実装のものもVibeProで実装して` — `_codex/common/meta/people_sync.md` に新型6種（speaking/media_appearance/role_assignment/product/publication/press_mention）の仕様を追記。

## Interpreted Goal

people-meta SKILL.md と people.md ヘッダーから参照されている `_codex/common/meta/people_sync.md` が、人物詳細データの正本・派生・同期スクリプト・運用フローを単一の場所で説明している状態にする。

## Findings

- `people_sync.md` は既存。1〜9節で「People本体」の同期仕様（NocoDB, Slack members.yml）を定義済み。
- 新型6種に関する記載は未着手。SKILL.md と people.md からは参照されているが、本ファイルに該当情報は無かった。
- 既存セクション (1〜9) は人物本体の同期を扱っており、これらを書き換えると後方互換が崩れる。**追記が正解。**

## Implementation

Changed files:
- `_codex/common/meta/people_sync.md` （新セクション 10 を追記）

セクション 10 構成:
- 10.1 新規 entity_type と ID prefix（6種テーブル）
- 10.2 新規 rel_type（7種テーブル）
- 10.3 payload 共通フィールド（`person_id` 必須）
- 10.4 project_id の扱い（`prj_<person>_portfolio`）
- 10.5 派生（ミラー）階層図
- 10.6 同期スクリプト一覧（4本）
- 10.7 運用フロー（新規追加 / 人物昇格）
- 10.8 既知の制約（org 未登録、編集ルール、info-ssot-service.js 連動）

## Verification

```
$ wc -l _codex/common/meta/people_sync.md
156 _codex/common/meta/people_sync.md   # 68 → 156（+88行追加）
```

- 既存セクション 1〜9 は無改変
- セクション 10 は SKILL.md / people.md / sato_keigo/index.md の記述と整合
- 参照されている全パスとスクリプト名を実物と突合済み

## VibePro Judgment

`go`.

- 文書化のみで実行系の変更なし
- SKILL.md (Run 0 のコミット `9538f02a` で更新済み) → people.md (同じくコミット済み) → people_sync.md (本Run) の3点が首尾一貫
- sato_keigo を参考実装として明記、他人物の昇格テンプレートとして再利用可能

## Residual Risks

- 「他人物への展開」が今後発生するまで、仕様の実用性は未検証。最初の他人物（例: yamamoto_rikiya）昇格時に仕様の不足が露呈する可能性。
- people.md の SSOT ブロックと people_sync.md の用語が微妙にずれる箇所がある（「ミラー」vs「派生」）。次回整理時に統一候補。

## Next Actions

- 他人物の昇格機会（業務委託メンバーの詳細プロフィール構造化など）があれば、sato_keigo 構造を template に。
- seed スクリプトを `seed-person-personal-records.js <person_id>` 形式に汎用化して、人物別に複製不要にする。
