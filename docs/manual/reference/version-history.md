# バージョン履歴

このページでは、公開マニュアルと公開packageに関係する履歴を記録します。実装済み・`develop`・計画中の境界は[現在の状態](/guide/status)を優先してください。

## Unreleased — develop

- 公開コピーを「一般論ではなく、あなたの判断基準から始まるAI。」へ更新
- 現行OSSのローカル優先・単一所有者向け価値を、組織版の将来価値より先に説明
- 毎回の説明、最初のズレ、特定AIへの文脈依存を減らす利用者価値をトップページへ追加
- CodexやClaude Codeは思考・実行を担い、Brainbaseは仕事の前提と判断基準の正本を担う境界を明示
- 個人で判断基盤を育て、権限・承認・例外・監査が必要な段階でOrganization / Enterpriseへアップグレードする経路を追加
- 人間が目的・判断基準・委任範囲を決め、AIが探索・比較・反証・承認範囲の実行を担う境界を明示
- Judgment DAGの利用者向け説明とReleased / Develop / Plannedの状態ページを追加
- `public-message.json`からREADME、manual、Core Philosophy、agent instructions、package descriptionを同期
- Brainbase Graphのsnapshot hash付きcandidateから、review用PRを作るpromotion workflowを追加
- pull requestでdocs check / build / smokeを行い、`develop` merge後にCloudflare Pagesへ自動deploy
- 配信後に公開URLをreadbackし、コピーとbuild SHAを確認

## 0.4.0

- Brainbaseをmemory retrievalだけでなくjudgment systemとして定義
- OSSと組織版で共有するJudgment DAG architectureとroadmapを追加
- typed DAG contract、`depends_on` mirror、layer、scope、cycle、missing dependencyのpreflight validationを追加
- 公開contract schema、fixture、source lock、digestをpackageへ同梱
- Graph v2、Ontology 2.0.0、Relation Registry、`resolve_entity`、Evidence Receiptを継続提供

`executeJudgmentDAG`のローカルrunnerは0.4.0 release後に`develop`へ追加されたため、0.4.0公開範囲と混同しません。

## 0.3.1

- 初回回答を「覚えていたこと」「つながったこと」「次にできること」の3つへ整理
- 正規Graphの事実と、回答時点で未確認の内容を分けて表示
- ID、パス、digest、tool traceなどの内部証跡を初期表示から外し、必要なときだけ確認できる構成へ変更
- 実CLI、実MCP、実Codexを使ったCycle 10で、32の合成ペルソナすべてが10分以内の初回価値と再利用意向を認識

Cycle 10は公開候補tarballと合成ペルソナによる証拠です。実際の人間、実機、支援技術、およびnpm registry公開版を使った価値認識は公開前には確認していません。

## 0.3.0

- Graph v2で人物、組織、プロジェクト、判断を安定IDのedgeで接続
- Relation Registryにより、関係名、接続可能な型、探索方向を一元管理
- Graph v1を自動更新せず、preview digest付きの`ontology:migrate`で原子的に移行
- Ontology 2.0.0を追加し、1.0.0を変更せず履歴解釈として保持
- `resolve_entity`で文章中の表現を正規entity IDへ接続し、本文を保持しないEvidence Receiptを返却
- 生成tarballを新しい利用環境へinstallし、公開CLIと実MCP readbackを検証するconsumer smokeを追加
- 候補tarballの取得から実CLI、実MCP、実Codexによる相談メモまでを51,069msで完了し、32の合成ペルソナすべてが初回価値と再利用意向を認識
- Cycle 09で既知の知識構造Major 0件、新規Major 0件を確認

Cycle 09はローカル候補tarballと合成ペルソナによる証拠です。人間の利用観察、実機・支援技術評価、npm registry版を使った利用者価値の確認は含みません。公開完了は、Actionsの成功だけでなくnpm registryのversion、`gitHead`、integrity、dist-tag、fresh install、GitHub Releaseを照合して判定します。

## 0.2.0

- 接続済みsourceを最小scopeで取り込み、候補の確認から最初の価値検証まで進めるConnected-world onboardingを追加
- 初心者向けオンボーディングで、復旧手順とMCP導入後の次行動をより明確に表示
- Codexの`UserPromptSubmit`、`PostToolUse`、`Stop`を1つのportable judgment episodeとして扱うローカルHostを追加
- 返答の先頭に、実際に参照したユーザー発言と判断結果を`🧠 判断参照:`として短く表示
- 判断証跡と実際のBrainbase MCP呼び出しを分け、検索・取得・参照先と0回だった事実を`📚` / `⚠️`で表示
- 参照元を特定できない追従依頼は成功に見せず、確認質問または警告として表示
- receipt、順序付きtool event、表示行を同じjournalに保存し、重複・競合・破損・orphan Stopをfail closedで処理
- `doctor --judgment-hooks`による3 Hookの導入検証を追加

## 2026-07-10

- 導入手順を、準備、仕事の前提、最初の価値、必要な情報源、運用開始の5フェーズへ再構成
- 重複していた概要ページを全体像へ統合
- 利用者が整理する情報と、実際の正本file構造を分けて説明
- sourceごとの対応範囲と、Skills、routine、MCPを使った運用開始手順を追加

## 0.1.0

- Brainbase VitePress manualを追加
- MCP導入、project文脈、source hearing、日次routineの初版を作成
- 既存の設計docsを公開manualのnavigationから分離
