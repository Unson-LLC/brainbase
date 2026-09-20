---
story_id: str.brainbase.wiki-script-retirement-final
title: 退役Wiki書込みスクリプトを除去する
status: active
created_at: 2026-09-20
---

# 退役Wiki書込みスクリプトを除去する

## 利用者の意図

保守者として、Wiki実行経路の退役後に残った手動書込みスクリプトをなくし、旧Wikiや旧NocoDBへ誤って書き込めない状態にしたい。保存済みのWiki・SQLite・JSONデータは保持し、保持確認に必要な読み取り専用棚卸し経路は残す。

## 受け入れ条件

- `merge-codex-to-wiki.js`、`reorganize-wiki.sh`、`create-story-records-from-wiki.js` の実装と実行経路をリポジトリから除去する。
- 除去対象を呼び出す現行のサーバー・CLI・package scriptがないことを確認する。歴史的な文書や移行ヘルプの文字列は、実行元とは区別して残件に記録する。
- `migrate-graphdb-to-wiki.js` と `populate-wiki-pages.js` は保存データの棚卸しに限り、`--dry-run` なしで副作用を起こさない退役境界を保持する。
- 保存済みWiki・`wiki_pages`・SQLite・JSONデータ、本番環境、現行Graph・Slack認証を変更しない。
- 対象テストで削除範囲と、保持する読み取り専用棚卸し範囲を検出できる。

## スコープ外

- Wiki保存データや `wiki_pages` の削除・移行・ハッシュ台帳作成。
- `/api/wiki`、NocoDB API、認証、SNS、Graphの実装変更。
- `link-story-ids-to-nocodb.js` など、今回の3本以外の旧業務スクリプトの整理。

## 関連仕様

- [退役Wiki書込みスクリプトSpec](../../specs/story-wiki-script-retirement-final-spec.md)
- [未使用Wikiの実行経路除去](./story-unused-wiki-retirement.md)
