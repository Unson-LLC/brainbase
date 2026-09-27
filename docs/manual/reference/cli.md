# CLI

BrainbaseのCLIは、オンボーディング、情報源の整理、Skillsとルーティンの生成、MCP起動を提供します。

## 実行方法

リポジトリをcloneした場合、npm scriptsがあるコマンドは `npm run` で実行します。それ以外はビルド後に `node dist/cli.js` を使います。

パッケージとしてインストールした場合は、すべて `brainbase <command>` で実行できます。

`brainbase --help`はデータを書き込まず、実エージェントで本人が価値を判断するまでの5ステップを先頭に表示します。

```bash
brainbase onboard:start --target codex
# 表示された onboard:seed を確認して実行
brainbase onboard:install --target codex --dry-run
# 設定反映・再起動後、実エージェントでresolve_entity/get_context/searchを使って依頼し、本人が役立ったか判断
```

## 導入

| コマンド | 役割 | 正本への書き込み |
| --- | --- | --- |
| `onboard:start` | AIが案内する初回導入を開始する | 初期ディレクトリだけ作る |
| `onboard:init` | 最小の正本ファイルを作る | 空ファイルだけ作る |
| `onboard:seed` | 承認した自分、価値観、関係性などを登録する | する |
| `onboard:projects` | プロジェクト、関係者、関係性の登録内容を確認する | `--write` の時だけする |
| `onboard:demo` | 登録した文脈から作れるCLIサンプルを任意でプレビューする | しない |

```bash
npm run onboard:start -- --target codex
npm run onboard:init
npm run onboard:seed -- --name "名前" --project "プロジェクト"
node dist/cli.js onboard:projects --name "プロジェクト" --goal "目的"
npm run onboard:demo -- --scenario "実際に試す依頼"
```

`onboard:start`と`onboard:demo`は、通常は現在地と次の一手だけを表示します。`onboard:demo`の`cli_sample_ready`は実エージェント接続前のプレビュー準備完了であり、初回価値の達成ではありません。

`onboard:seed`の関係者は`"人|役割|覚えておく文脈"`形式です。不正な入力は保存前に拒否され、既に入力した名前、価値観、プロジェクト、判断基準、正しい関係者を保持した再実行コマンドが表示されます。

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

通常のSSOT診断では、`doctor`は`graphDiagnosis`を返し、Graphを`healthy`、`issues`、`migration_required`、`invalid`、`unavailable`に分けます。`healthy`と`issues`は終了コード0ですが、`issues`は問題なしという意味ではないため件数と内訳を確認してください。`migration_required`、`invalid`、`unavailable`は非0で終了します。legacy投影は、名前が一意に正規IDへ対応する場合だけ`projection`として数え、同名候補が複数ある場合は`unresolved`として残します。`--judgment-hooks`で指定したファイルの欠落・不正JSON・必須Hook不足など、Graph診断より前の入力エラーでは`graphDiagnosis`を返さず非0で終了します。

## 個人の記憶を組織へ登録し直す

組織環境へ移っても、手元の記憶は自動では移りません。本人が選んだものだけを、組織の個人KG（本人だけが読める領域）へ登録し直します。Graphと判断根拠の持ち込みは[検索の仕組み](/guide/search)の`graph:upgrade`を使います。

| コマンド | 役割 | 組織への送信 |
| --- | --- | --- |
| `memory:list` | 手元の記憶（`personal-knowledge-v1/`と`personal-kg.jsonl`）を、選ぶためのID・保存場所・種類・冒頭・登録状態とともに一覧する | しない |
| `memory:register` | `--id`で選んだ記憶の送信内容を確認する | `--write`の時だけ、選んだ記憶だけ送る |

```bash
node dist/cli.js memory:list
node dist/cli.js memory:list --format json
node dist/cli.js memory:register --id v1:<イベントID> --id legacy:<ID>
node dist/cli.js memory:register --id v1:<イベントID> --id legacy:<ID> --write
```

IDは、個人KG v1の記憶が`v1:<イベントID>`、旧個人KGの記憶が`legacy:<ID>`です。登録状態は`unregistered`（未登録）、`registered`（登録済み）、`changed`（登録後に手元の記憶が変わった）のいずれかです。一覧と確認はネットワークを使わず、何も送りません。

`--write`には`graph:upgrade`と同じ`BRAINBASE_ORGANIZATION_*`の4項目が必要です。トークンは本人の署名つきBearerで、所有者と組織は組織側がトークンから決めます。送るのは記憶の本文・種類・タグ・日時と、どの手元の記憶かを示すIDだけです。元ファイル、ローカルのパス、手元のメタデータは送りません。

組織側のイベントIDは、記憶の内容と出どころ、送り先の本人と組織から決まります。同じ記憶を送り直しても同じイベントになり、重複しません。手元で内容が変わった記憶を送ると新しいイベントとして登録され、前のイベントは残ります。

組織が受け付けた記憶ごとに、`<データディレクトリ>/handover/personal-memory-registrations.jsonl`へ受領記録を残します。受け付けられなかった記憶の受領記録は残さず、その時点で止まって後の記憶は送りません。未登録の記憶は、組織では検索されません。

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

## ローカルWeb

| コマンド | 役割 | 正本への書き込み |
| --- | --- | --- |
| `web:serve` | 自分だけが使うローカルWebを開く（今日、目的と現状） | 画面で評価や目的を保存した時だけする |
| `review:serve` | `web:serve`の別名 | 同上 |

```bash
brainbase web:serve --dir ~/.brainbase/personal-os
brainbase web:serve --dir /path/to/personal-os --journal /path/to/judgment-journal --port 31080
```

`127.0.0.1`だけで待ち受け、既定のポートは`31080`です。宛先がループバックの名前と待ち受け中のポートの組でない要求は断ります。保存には、起動ごとのトークンと同一オリジンが必要です。

「目的と現状」は、目的の編集（版つきで保存し、古い版からの保存は今の版を示して断る）と、World Model（変数とモデル、観測、モデルの採用）の表示です。World Modelと、目的に関係する制約は表示だけです。Graph v1のデータでは「Graphの移行が必要です」と移行のコマンドを表示し、ホストは自動で移行しません。

## Ontology

| コマンド | 役割 | 正本への書き込み |
| --- | --- | --- |
| `ontology:show` | 同梱の現行Ontology 2.0.0全体をJSONで表示する | しない |
| `ontology:audit` | ローカル正本の意味制約を監査する | しない |
| `ontology:migrate` | Graph v1からv2への移行計画を確認・適用する | `--write`の時だけ4つの正本を一括更新する |

```bash
node dist/cli.js ontology:show
node dist/cli.js ontology:audit --dir /path/to/personal-os
node dist/cli.js ontology:audit --dir /path/to/personal-os --ontology-version 0.0.0
node dist/cli.js ontology:audit --dir /path/to/personal-os --ontology-version 1.0.0
node dist/cli.js ontology:migrate --dir /path/to/personal-os
node dist/cli.js ontology:migrate --dir /path/to/personal-os --write --expected-input-digest '<previewの値>'
```

`ontology:audit` はerror違反または監査不能のときに非0で終了します。監査不能の場合は `status: "unverified"` と `violationCount: null` を返します。
`--ontology-version`でsnapshotに記録された意味versionを指定できます。Graph v2は記録済みbinding、legacy Graphは現行の`2.0.0`が既定です。Kernel導入前の解釈は`0.0.0`、最初のportable releaseは`1.0.0`です。未対応versionは拒否します。

`ontology:migrate`は既定でpreviewだけを返し、ファイルを書きません。previewの`migration_required`は移行計画を正常に提示できた状態なので終了コード0です。適用にはpreviewの`expectedInputDigest`が必須です。計画が`blocked`の場合や、書込み時に入力が変わっていた場合は非0で停止し、古い計画を適用しません。

すべての引数は次で確認できます。

```bash
node dist/cli.js --help
```
