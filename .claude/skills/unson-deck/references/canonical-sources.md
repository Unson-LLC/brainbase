# 合同会社雲孫 資料正本マニフェスト

確認日: 2026-08-13

## Graph

| 種別 | ID | 用途 |
|---|---|---|
| 組織 | `unson` | 正式社名 `合同会社雲孫` |
| ブランド | `brand_unson` | ブランド人格、配色、書体、ロゴ規則 |
| 資料テンプレートポインタ | `doc_unson_deck_template_current` | DriveのCURRENT、現行版、制作Skillを解決する入口 |

Graphを毎回取得し、このファイルの記載だけでブランド事実を代用しない。

## Google Drive

アカウント: `info@unson.jp`  
クライアント: `default`

| 対象 | ID | 規則 |
|---|---|---|
| 雲孫ブランド資料ルート | `1YwEWHORh87E25Jhx1FsplFetpsijgBxh` | 探索の入口 |
| 資料テンプレート | `1IoFoj0lfgX8j1jqtWYDkLM2IG9xuY7jV` | CURRENTと版フォルダの親 |
| CURRENT | `1vVQUFYw2mWU_zKnyGIPWrW9mgPM5EMKD` | 現行版を決める唯一のDrive入口 |
| `v1.0.0` | `1oApBxMUJ5unxQQHRC7iB4crFbaSyiEVo` | 初回承認版 |
| テンプレートZIP | `1jF5Y9qHt8MonYh-THf2imDrnq1bfO_KV` | v1.0.0配布パッケージ |
| デザインシステム | `19sgPq57y2z7paD5JLz8390LBhfNF2z9g` | v1.0.0の視覚規則 |
| 全8ページ一覧 | `1YKzfcTfkANmTW2WPYY42G15oLD2zhL01` | 一覧検品用 |
| 正式ロゴ候補 | `1nG_YDZkDP3BK0IfS_0RPT8psJUx_wCL0` | Graphのロゴ規則と照合して使用 |
| 旧参考資料 | `1cBHfo-q0VQIyg9keISgQRuByrxL1zFuA` | 通常制作では探索・参照しない |

## CURRENT解決契約

1. `資料テンプレート`直下から名前が完全一致する`CURRENT.md`を取得する。
2. `version`、`release_folder_id`、`template_zip_id`を読む。
3. `release_folder_id`が実在し、その名称が`version`と一致することを確認する。
4. ZIPとデザインシステムが同じ版フォルダの子であることを確認する。
5. 不一致、重複CURRENT、取得失敗は `未確認` として制作を停止する。

## 参照禁止

- `旧参考資料`配下のファイル
- workspaceの`_codex/artifacts`を永続正本として扱うこと
- BAAOのSkill、ロゴ、配色、テンプレート
- 個人の絶対パスをGraphへ登録すること
