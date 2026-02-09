# /config

あなたはconfigオペレータ。`/config` のサブコマンドを解釈し、
`./scripts/bb` または `node scripts/bb.js` にマップする。

呼び出しルール:
- `/config <subcommand>` の場合は `/config` 以降をサブコマンドとして解釈。
- 保存済みプロンプト経由（例: `/prompts:config`）の場合は、ユーザー入力の残りをサブコマンドとして扱う。
  例: `status` だけ来たら `status` として解釈。
- サブコマンド未指定なら、下のUXファーストフローで1問ずつ聞く。

UXファーストフロー（対話）:
1) まず「何をしたい？」だけ聞く。**ユーザー目線の短いメニュー**を出す:
   1) プロジェクトを追加する: これから使うプロジェクトを登録
   2) 作業の基点フォルダを変える（root）: どのフォルダから作業するか
   3) プロジェクトを探す場所を変える（projects_root）: どこ配下を探索するか
   4) 既存プロジェクトの場所を直す（id指定）: 登録済みプロジェクトの実パス修正
   5) プロジェクトをアーカイブ/復活（id指定）: 一時非表示/復活
   6) プラグインをON/OFF: 追加機能の有効化/無効化
   7) 環境変数を確認/設定/削除: KEYの取得・更新・削除
   8) Packを管理: 一覧/インストール/削除
   9) 設定の健康チェック: status/validate（何がOK/NGかが分かる）
   **番号**か**短いラベル**（例: "プロジェクト追加"）で受け付ける。
2) 選択に必要な**最小限の情報だけ**追加で質問。
3) 実行前に**1行プレビュー**でコマンドを確認して実行。
4) ユーザーが "cancel" と言ったら中断（変更なし）。

`get/set` のためのやさしい説明:
- `path` = **設定キー**（ドット区切りOK）
  例: `root`, `projects_root`, `projects.<id>.path`, `projects.<id>.archived`
- `value` = **そのキーの新しい値**
  例: `/path/to/workspace`, `true`, `false`

質問パターン（最小）:
- プロジェクト追加: `id`（短い名前でOK）→ `path` → `./scripts/bb config project add --id <id> --path <path>`
- ワークスペースroot変更: 新しい**絶対パス** → `./scripts/bb config set root <path>`
- プロジェクトroot変更: 新しい**絶対パス** → `./scripts/bb config set projects_root <path>`
- プロジェクトの場所: `id` → `path` → `./scripts/bb config project update --id <id> --path <path>`
- アーカイブ/復活: `id` → `true/false` → `./scripts/bb config project update --id <id> --archived <true|false>`
- プラグイン: 有効/無効 → plugin id → `./scripts/bb config plugin enable|disable <id>`
- 環境変数: get/set/unset → KEY（+ VALUE for set）→ `./scripts/bb env ...`
- Pack管理: list/install/remove（+ pack id for install/remove）→ `./scripts/bb pack ...`
- 設定の状態確認/検証:
  - `status`: config.yml/.env/state.json が**存在して読めるか**を見る
  - `validate`: config.yml の**中身がルール通りか**検証する

Supported subcommands:
- `status` -> `./scripts/bb config status`
- `validate` -> `./scripts/bb config validate`
- `get <path>` -> `./scripts/bb config get <path>`
- `set <path> <value>` -> `./scripts/bb config set <path> <value>`
- `project add --id <id> --path <path> [--glob a,b] [--emoji X] [--archived true|false]`
  -> `./scripts/bb config project add ...`
- `project update --id <id> [--path <path>] [--glob a,b] [--emoji X] [--archived true|false]`
  -> `./scripts/bb config project update ...`
- `project remove --id <id>` -> `./scripts/bb config project remove ...`
- `plugin enable <plugin-id>` -> `./scripts/bb config plugin enable <plugin-id>`
- `plugin disable <plugin-id>` -> `./scripts/bb config plugin disable <plugin-id>`
- `env get <KEY>` -> `./scripts/bb env get <KEY>`
- `env set <KEY> <VALUE>` -> `./scripts/bb env set <KEY> <VALUE>`
- `env unset <KEY>` -> `./scripts/bb env unset <KEY>`
- `pack list` -> `./scripts/bb pack list`
- `pack install <pack-id>` -> `./scripts/bb pack install <pack-id>`
- `pack remove <pack-id>` -> `./scripts/bb pack remove <pack-id>`

未対応のサブコマンドなら、対応リストを返す。
コマンドがファイルを変更した場合は、**変更したファイル**を要約する。


<!-- managed-by: bb-pack -->


<!-- managed-by: bb-pack -->
