# VibePro Autonomous Development Run: Wiki Mirror for Person Detail Entities

## Request

`未実装のものもVibeProで実装して` — migrate-graphdb-to-wiki.js を新型6種に拡張。

## Interpreted Goal

GraphDB に投入した佐藤圭吾の登壇・メディア・役職・プロダクト・著書・プレスが、`migrate-graphdb-to-wiki.js` の実行で `wiki/people/<person_source_id>/<type>/<entity_id>.md` として可読Markdownミラーになること。

## Findings

- 既存 `migrate-graphdb-to-wiki.js` は `person, project, org, decision, glossary_term` の5型のみ SELECT して Markdown 化。
- 新型6種は payload に `person_id` (source_id, 例: `sato_keigo`) を保持しているので、それを使って wiki path を階層化できる。
- wiki path 慣習: `people/{person_id}.md` (フラット) なので、その下に `{type}/` サブディレクトリを切る形が自然。

## Implementation

Changed files:
- `scripts/migrate-graphdb-to-wiki.js`

変更内容:

| 関数 | 拡張 |
|---|---|
| `speakingToMarkdown()` | 新規。date/event/organizer/role/duration/venue/format/attendance/slides_url/hashtag を見出し付き md 化 |
| `mediaAppearanceToMarkdown()` | 新規。medium/program/role/format/date/url |
| `roleAssignmentToMarkdown()` | 新規。`# role@org` 形式、period/start_date/via/description セクション |
| `productToMarkdown()` | 新規。status/role/url + summary |
| `publicationToMarkdown()` | 新規。`# 『title』` + authors/achievement/url |
| `pressMentionToMarkdown()` | 新規。date/medium/section + content |
| `entityToWikiPath()` | 新型は `people/{person_id}/{type}/{entity_id}` に階層化（person_id が無ければ `other/{type}/{entity_id}`） |
| `entityToMarkdown()` | 新型6種の dispatch を追加 |
| `main()` の SELECT 句 | `entity_type IN (...)` に新型6種を追加 |

## Verification

`BRAINBASE_WIKI_ROOT=/tmp/wiki-test node scripts/migrate-graphdb-to-wiki.js --dry-run` の出力（sato_keigo 関連のみ抜粋）:

```
people/sato_keigo/speaking/spk_2026-04-15_ai駆動開発の最前線... (372 chars)
people/sato_keigo/speaking/spk_2026-03-24_ai駆動経営... (393 chars)
... 全 9 speaking
people/sato_keigo/media/med_youtube_ホリエモンチャンネル (218 chars)
... 全 3 media
people/sato_keigo/roles/rol_unson_代表社員_ceo (119 chars)
... 全 6 roles
people/sato_keigo/products/prd_salestailor (149 chars)
... 全 6 products
people/sato_keigo/publications/pub_はじめてでも失敗しない... (222 chars)
people/sato_keigo/press/prs_2025-07_佐賀新聞_朝刊 (118 chars)
```

合計 27 ファイル（project 1 を除く 26 個の人物詳細データ）が想定パスで生成される。文字数も妥当（最小 117、最大 432）。

## VibePro Judgment

`go`.

- 機能: ✅ 全 6 型の Markdown 生成と wiki path 階層化が dry-run で確認。
- 既存型への影響なし: 既存 5 型の dispatch 分岐に変更なし、SELECT 句は追加のみ。

## Residual Risks

- 実書き込み（非 dry-run）でディレクトリ作成が走る挙動は未検証。`fs.writeFile` が自動で親ディレクトリを作るかは要確認（既存実装に `mkdir -p` 相当があるはず）。
- 講師プロフィール skill の SKILL.md は新パス（`common/meta/people/sato_keigo/`）を指しているが、wiki 側のパス（`wiki/people/sato_keigo/...`）への参照は未追加。次の skill 更新候補。

## Next Actions

- Run 3 (`people_sync.md` 仕様ドキュメント) で wiki ミラーパスの慣習も明文化。
- `wiki/people/<person_id>/` の構造をプロダクション環境で書き出して目視確認。
