# CLI

BrainbaseのCLIは、オンボーディング、情報源の整理、Skillsとルーティンの生成、MCP起動を提供します。

## 実行方法

リポジトリをcloneした場合、npm scriptsがあるコマンドは `npm run` で実行します。それ以外はビルド後に `node dist/cli.js` を使います。

パッケージとしてインストールした場合は、すべて `brainbase <command>` で実行できます。

## 導入

| コマンド | 役割 | 正本への書き込み |
| --- | --- | --- |
| `onboard:start` | AIが案内する初回導入を開始する | 初期ディレクトリだけ作る |
| `onboard:init` | 最小の正本ファイルを作る | 空ファイルだけ作る |
| `onboard:seed` | 承認した自分、価値観、関係性などを登録する | する |
| `onboard:projects` | プロジェクト、関係者、関係性の登録内容を確認する | `--write` の時だけする |
| `onboard:demo` | 登録した文脈で最初の価値を試す | しない |

```bash
npm run onboard:start -- --target codex
npm run onboard:init
npm run onboard:seed -- --name "名前" --project "プロジェクト"
node dist/cli.js onboard:projects --name "プロジェクト" --goal "目的"
npm run onboard:demo -- --scenario "実際に試す依頼"
```

## 情報源

| コマンド | 役割 | 正本への書き込み |
| --- | --- | --- |
| `onboard:recommend` | 利用ツールに合う収集方法を案内する | しない |
| `onboard:diagnose-sources` | 収集手段と対象範囲の準備状況を確認する | しない |
| `onboard:plan` | ローカル導入計画を出す | しない |
| `onboard:import` | 収集済みJSONを `sources/` に整える | 元データだけ書く |
| `onboard:extract` | 元データから確認用の情報を整理する | `--write` でも確認用下書きだけ書く |
| `onboard:apply` | 選んだ情報を正本へ反映する | `--write` の時だけする |

`onboard:candidates` は、手入力した内容を確認用の下書きとして保存する内部向けコマンドです。通常の導入ではAIの案内に従えば、名前を覚える必要はありません。

## 運用

| コマンド | 役割 | ライブ設定への書き込み |
| --- | --- | --- |
| `onboard:skills` | 公開Skillsを生成する | `--out` を付けた時だけファイルを作る |
| `onboard:routines` | `ohayo`、`oyasumi`、`retro` の定義を生成する | 定期実行は登録しない |
| `onboard:install` | MCP設定断片を出力または別ファイルへ保存する | `--output` の時だけ指定先へ新規ファイルを作る |
| `doctor` | ローカル正本、接続状態、任意でJudgment Hookを点検する | しない |
| `mcp` / `start` | MCPサーバーをstdioで起動する | しない |

```bash
node dist/cli.js onboard:skills --target codex
node dist/cli.js onboard:routines --target codex --cwd /path/to/brainbase
npm run onboard:install -- --target codex --dry-run
npm run doctor
npm run start
```

## Judgment Host

| コマンド | 役割 | ライブ設定への書き込み |
| --- | --- | --- |
| `judgment:install` | Codex用の `UserPromptSubmit`、`PostToolUse`、`Stop` Hook設定断片を生成する | `--output` の時だけ指定先へ新規ファイルを作る |
| `doctor --judgment-hooks` | 3つのHookが設定されているか点検する | しない |

```bash
brainbase judgment:install --target codex --dry-run
brainbase judgment:install --target codex --output /tmp/brainbase-judgment-hooks.json
brainbase doctor --dir ~/.brainbase/personal-os --judgment-hooks ~/.codex/hooks.json
```

`judgment:install` は既存の `~/.codex/hooks.json` へ自動マージしません。出力を確認し、Brainbaseの3項目だけを既存設定へ統合します。`--output` は未作成のファイルだけを受け付けます。導入後は新しいCodex taskを開いて確認します。

## Ontology

| コマンド | 役割 | 正本への書き込み |
| --- | --- | --- |
| `ontology:show` | 同梱のOntology 1.0.0全体をJSONで表示する | しない |
| `ontology:audit` | ローカル正本の意味制約を監査する | しない |

```bash
node dist/cli.js ontology:show
node dist/cli.js ontology:audit --dir /path/to/personal-os
node dist/cli.js ontology:audit --dir /path/to/personal-os --ontology-version 0.0.0
```

`ontology:audit` はerror違反または監査不能のときに非0で終了します。監査不能の場合は `status: "unverified"` と `violationCount: null` を返します。
`--ontology-version`でsnapshotに記録された意味versionを指定できます。未指定は`1.0.0`、Kernel導入前のlegacy解釈は`0.0.0`です。`0.0.0`では1.0.0の`effectiveAt`、supersession、conflict規則を遡及適用しません。未対応versionは拒否します。

すべての引数は次で確認できます。

```bash
node dist/cli.js --help
```
