# GitHub CI/CD実践ガイド — 安全な自動化の運用原則

**本質**: CI/CDを「自動実行するYAML」ではなく、変更を小さく検証し、権限を限定し、同じ成果物を追跡可能な形で段階的に出荷する仕組みとして設計する。

**原本**: [Google Drive](https://drive.google.com/file/d/1UviJ2AMxiLBi3kIE2dRPMzgUuYVhJApR/view?usp=drivesdk)

> GitHub Actionsの構文、ランナー、権限、料金、提供アクションは変化する。実装時にはGitHub公式文書を正本とし、OCRしたワークフローをそのまま実行しない。

## 取り込み記録

| 項目 | 結果 |
|---|---|
| PDF | 477ページ、264,466,096 bytes |
| PDF SHA-256 | `82abaf80577648cb3f5dcbfae4b68061092bff00a7b5144683a7058a4acc9537` |
| OCR | 全477ページ、394,524文字 |
| OCR SHA-256 | `9efbf283ed10a5d348ce1cbf95bf9575499fc33731a94db1baf97d11ae3d8566` |

## パイプライン

```text
変更要求
  → lint・型・単体テスト
  → ビルド
  → セキュリティと依存関係の検査
  → 不変な成果物を発行
  → 環境ごとの承認と短期認証
  → 段階的デプロイ
  → 観測・検証・ロールバック
```

## 設計原則

- トリガー、権限、同時実行、タイムアウト、失敗条件を明示する。
- Jobは依存関係を可視化し、Stepは単一の診断可能な仕事にする。
- 再利用WorkflowやActionは入力・出力・権限・版を契約化する。
- キャッシュと成果物を区別し、成果物にはコミットとビルドの出自を残す。
- 外部Actionは可変タグだけに依存せず、信頼できる版へ固定して更新管理する。
- 長期クラウド鍵を保存せず、OIDC等の短期認証と最小権限を使う。
- リリース、Packages、デプロイで同じ検証済み成果物を昇格させる。

## 実装手順

1. 手作業のビルドとテストをローカルで再現可能にする。
2. 最小のCIを追加し、必須チェックとブランチ保護へ接続する。
3. 依存キャッシュ、並列化、変更範囲の限定は測定後に加える。
4. 成果物、リリースノート、バージョン規則を定義する。
5. Environmentごとに秘密、承認者、保護規則を分ける。
6. デプロイ後のヘルス確認と自動・手動ロールバックを試験する。
7. 実行時間、待ち時間、失敗率、復旧時間、費用を継続監視する。

## セキュリティレビュー

- Forkや外部入力から秘密へ到達できないか。
- Workflowの権限はJob単位で必要最小限か。
- スクリプトへ未検証の式展開を直接埋め込んでいないか。
- サプライチェーンの版固定、検証、更新責任があるか。
- ログや成果物へ秘密・個人情報を残さないか。
- セキュリティ検査を警告だけにせず、例外承認と期限を管理しているか。

## Brainbaseでの適用

Graphにはリポジトリ、Workflow、環境、責任主体、重要な出荷判断を置く。Workflow本体と実行可能な規則は所有リポジトリを正本とする。ローカル成功、CI成功、マージ、デプロイ、利用者成果を別々の証跡として記録する。

### イベントトリガー実行

| ジョブ名 | トリガー | 目的 | ワークフロー | ランナー |
|---|---|---|---|---|
| Graph書き込み契約 | `develop`・`main`へのPull Requestとpush | Graph書き込み所有者、認証・CSRF契約、利用スクリプトの実行入口を検証する | `.github/workflows/graph-writer-contract.yml` | `ubuntu-latest` |
| VibePro Graphify影響ゲート | `develop`・`main`へのPull Request | Graph影響を伴う変更にGraphify証跡を要求する | `.github/workflows/vibepro-graphify-impact.yml` | `ubuntu-latest` |
| VibePro Graph SSOT（マージ前） | `develop`・`main`へのPull Request | チェッカーの単体テスト、Ontology履歴、外部Graph SSOTを検証する | `.github/workflows/vibepro-graph-ssot.yml` | `ubuntu-latest` |
| VibePro Ontology（push後） | `develop`・`main`・`session/**`へのpush | マージ後を含む実際のpush履歴でOntology公開契約を再検証する | `.github/workflows/vibepro-graph-ssot.yml` | `ubuntu-latest` |
| VibePro Graph SSOT（定期） | 毎日09:45（日本時間）・手動実行 | 外部Graph SSOTのドリフトを検出する | `.github/workflows/vibepro-graph-ssot.yml` | `ubuntu-latest` |
| VibePro Score Evidence（マージ前） | `develop`・`main`へのPull Request | 変更されたscore証跡、開発DAG、Story・Architecture・Specの追跡関係を検証する | `.github/workflows/vibepro-score-run.yml` | `ubuntu-latest` |
| VibePro Score Evidence（push後） | `develop`・`main`・`session/**`へのpush | `before..sha`の全変更を使い、直接pushとマージ後のscore証跡を再検証する | `.github/workflows/vibepro-score-run.yml` | `ubuntu-latest` |
| VibePro Score Evidence（手動） | 手動実行 | 単体テストとワークフロー疎通を確認する。変更ファイル集合は空として扱うため、score成果物・DAG・文書追跡の検証証跡には使わない | `.github/workflows/vibepro-score-run.yml` | `ubuntu-latest` |

Graph書き込み契約ジョブに秘密情報は不要。テスト用のローカルHTTPサーバーだけを使い、本番Graphへの書き込みは行わない。

VibePro Graph SSOTは読み取り専用の`BRAINBASE_GRAPH_API_TOKEN`を外部Graph検証ステップだけに渡す。Pull Requestとpushは同じ検査を重複させず、マージ前のコード・Graph検証とpush後の履歴検証に責務を分ける。Score Evidenceはマージ前の予防と、直接push・マージ後の検知を別の実行として維持する。

各ワークフローは`permissions: contents: read`を上限とし、checkout後は`persist-credentials: false`で認証情報を残さない。同一Pull Requestや手動・定期実行の古い実行は中止する一方、pushはSHAごとに別の排他グループとして`before..sha`の履歴検証を欠落させない。外部ActionはNode.js 24ランタイムの`actions/checkout@v5`と`actions/setup-node@v5`へ統一し、利用者ステップはNode.js 20で実行する。旧npmキャッシュの大容量復元と将来の自動キャッシュを避けるため、`setup-node`には`package-manager-cache: false`を明示する。各ジョブは10分で打ち切る。

マージ後はマージSHAに紐づくScore EvidenceとOntologyのpush実行を確認する。Score Evidenceのpushでは`${{ github.event.before }}`を`GITHUB_EVENT_BEFORE`へ渡し、複数コミットpushの先頭側を検査範囲から落とさない。
