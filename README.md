# Brainbase 個人オンボーディングキット

Brainbaseは、自分が承認した仕事の前提をCodex、Claude Code、CodeCodeへ渡すための、ローカル優先のMCPサーバーです。

最初の目標は情報源をすべて接続することではありません。自分、仕事、関係者、判断基準の最小文脈を保存し、10分以内に「同じ前提を説明し直さず役立つ出力」を確認することです。

Brainbaseの中核仮説は、個人や会社の知性は単なる情報量ではなく、**何を根拠に、誰が、どのように判断し、その結果から判断をどう更新してきたか**に宿るというものです。Knowledgeは最終目的ではなくEvidenceであり、Brainbaseは判断能力を外在化し、人間とAIが再利用できる形で残すことを目指します。詳しくは [Brainbase Core Philosophy](docs/core-philosophy.md) を参照してください。

Ontology 2.0.0は、ローカルファイルへ持ち運べる意味契約に、Relation Registryで管理する正規エンティティ間のIDエッジを追加します。ホスト型Brainbaseを必要とせず、型、関係語彙、検証制約、決定論的な判断推論、バージョン移行を定義します。履歴解釈として0.0.0と1.0.0も選択できます。

このリポジトリに、社内BrainbaseのUI、セッション実行基盤、xterm転送、ワークフロー管制、SNS運用、ホスト型バックエンド、Infisical設定、雲孫の社内データは含みません。それらは社内版`brainbase-unson`の範囲です。

## マニュアル

Read the public onboarding manual at [brainbase.pages.dev](https://brainbase.pages.dev/). It guides users through five phases: choose one real use case, register approved work context, prove the first value, add only necessary sources, and operationalize Skills, routines, and MCP.

For the shortest safe path, open [10分で試す](https://brainbase.pages.dev/guide/quick-start). It keeps the first prompt, MCP setup, optional Judgment Host setup, verification, and interruption recovery in one resumable checklist.

The manual is the best starting point for first-time users. It explains Brainbase concepts, the first onboarding flow, MCP registration, project context setup, source onboarding, daily routines, and CLI reference.

## エージェントと始める

BrainbaseはCodex、Claude Code、CodeCodeから導入できます。最初に目指すのは接続設定ではなく、自分の文脈を使った役立つ出力です。

```bash
npm install
npm run build
npm run onboard:start -- --target codex
```

`onboard:start`は日本語の初回導入コマンドです。最小ディレクトリだけを作り、本人、プロジェクト、関係者、判断、メール、カレンダー、ドライブ、タスクの事実は、利用者が承認するまで保存しません。通常表示は次の一手だけに絞り、全項目は`--details`で確認できます。

公開CLIをインストール済みなら、次の5ステップです。

```bash
brainbase onboard:start --target codex
# 表示された onboard:seed を確認して実行
brainbase onboard:install --target codex --dry-run
# 設定を承認・反映し、Codexを再起動
# 新しいCodexでBrainbaseのresolve_entity/get_context/searchを使って実際の依頼を試す
```

リポジトリをcloneした場合も、`npm run onboard:start -- --target codex`から同じ順序で進めます。

利用者がBrainbaseの導入を依頼したら、エージェントはチェックリストを返すだけでなく、この公開CLIを実行します。承認された最小文脈を保存し、MCP設定を反映した新しい実エージェントで`resolve_entity`、`get_context`、`search`を使って現実の依頼へ回答します。その実回答を見た本人が「役立った」と判断して初めて初回価値です。`ready: true`、`cli_sample_ready`、CLIの処理時間、合成ペルソナ評価、Skillsやルーティンの生成、`onboard:install --dry-run`だけでは導入完了ではありません。
