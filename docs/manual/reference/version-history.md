# バージョン履歴

このページでは、公開マニュアルに関係する履歴だけを記録します。

## 次期0.3.0候補

- Graph v2で人物、組織、プロジェクト、判断を安定IDのエッジで接続
- Relation Registryにより、関係名、接続可能な型、探索方向を一元管理
- Graph v1を自動更新せず、preview digest付きの`ontology:migrate`で原子的に移行
- Ontology 2.0.0を追加し、1.0.0を変更せず履歴解釈として保持
- `resolve_entity`で文章中の表現を正規エンティティIDへ接続し、本文を保持しないEvidence Receiptを返却
- 生成tarballを新しい利用環境へインストールし、公開CLIと実MCP readbackを検証するconsumer smokeを追加
- 候補tarballの取得から実CLI、実MCP、実Codexによる相談メモまでを51,069msで完了し、32の合成ペルソナすべてが初回価値と再利用意向を認識
- Cycle 09で既知の知識構造Major 0件、新規Major 0件を確認

この項目は公開前の候補です。Cycle 09はローカル候補tarballと合成ペルソナによる証拠であり、人間の利用観察、実機・支援技術評価、npm registry版での価値確認は未収集です。npm registryへの公開とfresh installの再確認が終わるまでは、公開済みversionとして扱いません。

## 0.2.0

- 接続済みソースを最小scopeで取り込み、候補の確認から最初の価値検証まで進めるConnected-world onboardingを追加
- 初心者向けオンボーディングで、復旧手順とMCP導入後の次行動をより明確に表示
- Codexの `UserPromptSubmit`、`PostToolUse`、`Stop` を1つのportable judgment episodeとして扱うローカルHostを追加
- 返答の先頭に、実際に参照したユーザー発言と判断結果を `🧠 判断参照:` として短く表示
- 判断証跡と実際のBrainbase MCP呼び出しを分け、検索・取得・参照先と0回だった事実を `📚` / `⚠️` で表示
- 参照元を特定できない追従依頼は成功に見せず、確認質問または警告として表示
- receipt、順序付きtool event、表示行を同じjournalに保存し、重複・競合・破損・orphan Stopをfail closedで処理
- `doctor --judgment-hooks` による3 Hookの導入検証を追加

## 2026-07-10

- 導入手順を、準備、仕事の前提、最初の価値、必要な情報源、運用開始の5フェーズへ再構成
- 重複していた概要ページを全体像へ統合
- 利用者が整理する情報と、実際の正本ファイル構造を分けて説明
- 情報源ごとの対応範囲と、Skills、ルーティン、MCPを使った運用開始手順を追加

## 0.1.0

- Brainbase VitePress manualを追加
- MCP導入、プロジェクト文脈、ソースヒアリング、日次ルーティンの初版を作成
- 既存の設計docsを公開マニュアルのナビゲーションから分離
