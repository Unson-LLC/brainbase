# UnsonOS 文書索引

`UnsonOS` 系の文書だけを追うための索引だし。  
まず何を読むか、どの文書がどの役割かをここで掴む。

## 系譜の見方

- 各文書のタイトル直下にある `文書メタ情報` を正本として使う
- `親文書` が判断基準
- `派生元` が起点
- `関連文書` が横のつながり
- 詳しいルールは [UnsonOS 文書トレーサビリティ](./architecture/unson-os-document-traceability.md) を見る

## 入口

### フレーム

- [UnsonOS ランタイム UI フレーム](./frames/unson-os-runtime-ui-frame.md)
- [UnsonOS 文書トレーサビリティ](./architecture/unson-os-document-traceability.md)

### ストーリー

- [エージェント組織基盤ストーリー](./stories/unson-os-agent-org-foundation-story.md)
- [ポートフォリオ運営ストーリー](./stories/unson-os-portfolio-operator-story.md)
- [ゲームライク world UI ストーリー](./stories/unson-os-game-like-world-ui-story.md)
- [DAG ガードレールストーリー](./stories/unson-os-dag-guardrail-story.md)
- [現場責任者コンソールストーリー](./stories/unson-os-lead-control-console-story.md)
- [現場責任者 v0導線運用型ストーリー](./stories/unson-os-lead-workflow-validation-story.md)
- [経営者・事業責任者・現場責任者の通しシナリオ](./stories/unson-os-ceo-gm-lead-scenario.md)

## 設計

### 基本設計

- [UI コンセプト](./architecture/unson-os-ui-concept.md)
- [用語ルール](./architecture/unson-os-terminology.md)
- [ズーム契約](./architecture/unson-os-zoom-contract.md)
- [正準ドメイン](./architecture/unson-os-canonical-domain.md)

### 現場責任者まわり

- [現場責任者コンソール](./architecture/unson-os-lead-control-console.md)
- [現場責任者ランタイム構成](./architecture/unson-os-lead-runtime-architecture.md)
- [UI×制御面 整合性マトリクス](./architecture/unson-os-ui-architecture-alignment.md)

## 本流

### 現場責任者を起点に追う本流

1. [UnsonOS ランタイム UI フレーム](./frames/unson-os-runtime-ui-frame.md)
2. [現場責任者コンソールストーリー](./stories/unson-os-lead-control-console-story.md)
3. [UnsonOS 現場責任者コンソール](./architecture/unson-os-lead-control-console.md)
4. [UnsonOS 現場責任者ランタイム構成](./architecture/unson-os-lead-runtime-architecture.md)
5. [UI×制御面 整合性マトリクス](./architecture/unson-os-ui-architecture-alignment.md)

### 上位の運営導線を追う本流

1. [UnsonOS UI コンセプト](./architecture/unson-os-ui-concept.md)
2. [UnsonOS ズーム契約](./architecture/unson-os-zoom-contract.md)
3. [経営者・事業責任者・現場責任者の通しシナリオ](./stories/unson-os-ceo-gm-lead-scenario.md)

### 組織実行基盤まわり

- [エージェント組織基盤アーキテクチャ](./architecture/unson-os-agent-org-foundation-architecture.md)

## 仕様

- [エージェント組織基盤仕様](./specs/unson-os-agent-org-foundation-spec.md)
- [現場責任者 v0導線運用型仕様](./specs/unson-os-lead-v0-operating-model-spec.md)
- [現場責任者コンソール UI遷移仕様](./specs/unson-os-lead-control-console-ui-spec.md)
- [現場責任者 v0実装](./specs/unson-os-lead-v0-implementation-spec.md)

## いまの読み順

### まず全体像を掴みたいとき

1. フレーム
2. UI コンセプト
3. ズーム契約
4. 正準ドメイン

### 現場責任者から実装したいとき

1. 現場責任者コンソールストーリー
2. 現場責任者 v0導線運用型ストーリー
3. 現場責任者コンソール
4. 現場責任者ランタイム構成
5. 現場責任者コンソール UI遷移仕様
6. 現場責任者 v0導線運用型仕様
7. 現場責任者 v0実装
8. UI×制御面 整合性マトリクス

### OpenGoat / Paperclip を含めて見たいとき

1. エージェント組織基盤ストーリー
2. エージェント組織基盤アーキテクチャ
3. Paperclip アダプタースパイク
4. 現場責任者ランタイム構成

## 整理ルール

- `Frame` は上位前提
- `Story` は体験と受け入れ条件
- `Architecture` は責務と境界
- `Spec` は実装詳細

`UnsonOS` 系の文書を足すときは、まずこの索引に追記する。

## spikes

- [Paperclip アダプタースパイク](./spikes/unson-os-paperclip-adapter-spike.md)
