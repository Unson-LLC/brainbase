---
name: executor-routing
description: Solをオーケストレーターとして維持し、明確で検証可能な実装タスクをcc-router経由の安価な実行モデルへ委任する。Nous、安価なexecutor、モデルルーティング、並列サブエージェント、Solへのエスカレーションを扱う時に使用する。
location: managed
type: project
---

# Executor Routing

## 目的

高価で高精度なモデルを判断と検証に集中させ、境界が明確な実作業を安価なモデルへ委任する。

現在の標準構成は次の通り。

- オーケストレーター: Sol
- 標準executor: cc-routerの`model-sonnet`（現在はNous PortalのDeepSeek V4 Flashへ接続）
- 検証: 決定論的なテスト、型チェック、lint、および必要に応じたSolレビュー
- エスカレーション: executorが一度失敗、または高リスク条件を検出したらSol

モデル名や価格は変更され得る。ルーティング判断とprovider設定を分離し、Skill内にAPIキーを保存しない。

## トリガー

以下の場合に使用する。

- Solから安価なモデルへ実装を委任する
- Nousをexecutorとして使う
- 複数のコーディングサブエージェントを並列実行する
- タスクごとにSolと安価なモデルを振り分ける
- executor失敗時のエスカレーションを判断する

Claude CodeからCodex CLIへ委任すること自体が目的なら、代わりに`codex-delegate`を使用する。

## ルーティング手順

### 1. Solがタスク境界を定義する

委任前に、最低限次を明記する。

- 完了条件
- 変更可能なファイルまたはディレクトリ
- 変更禁止範囲
- 実行する検証コマンド
- 一回の実装試行で終了すること
- コミットしないこと

要件が曖昧なままexecutorへ解釈を委ねない。曖昧さの解消はSolの責務とする。

### 2. リスクで実行先を選ぶ

次をすべて満たす場合は標準executorへ送る。

- 完了条件が機械的に検証できる
- 変更範囲が限定されている
- 既存パターンに沿った実装である
- 独立したテスト、型チェック、lintのいずれかがある
- 認証、権限、課金、secret、データ削除、DB migrationを含まない
- 複数repoをまたがない
- 新しいアーキテクチャ判断を必要としない

次のいずれかに該当する場合は最初からSolが担当する。

- 原因不明で再現条件も未確定の障害
- 認証、権限、暗号、secret、課金
- 破壊的操作または不可逆なデータ変更
- DB migration、公開API契約、複数repo横断
- 大規模な設計変更やプロダクト判断
- ユーザー向けE2Eの合否に人間的判断が必要

### 3. executorを一回実行する

直接実行する場合の標準形:

```bash
codex exec \
  -m model-sonnet \
  -c 'model_provider="cc-router"' \
  -s workspace-write \
  -C "$PWD" \
  -o /tmp/executor-result.md \
  "<境界・制約・検証コマンドを含むタスク>"
```

実行前にcc-routerが起動しており、`model-sonnet`のbindingが意図したsubscriptionを指していることを確認する。APIキーの値は表示・記録しない。

サブエージェント機構を使う場合も、workerが実際に`model-sonnet`と`cc-router`へ解決されることを設定または実行ログで確認する。名前だけでNous利用済みと判断しない。

### 4. Solが独立検証する

executorの最終メッセージを成功証拠にしない。Sol側で次を確認する。

1. 変更範囲が許可範囲内か
2. テストや型チェックが実際に成功するか
3. テストやfixtureを不正に弱めていないか
4. diffが完了条件を満たすか
5. secretや個人環境の絶対パスを追加していないか

検証不能な項目は成功扱いせず、`未確認`として残す。

### 5. 一度だけエスカレーションする

次のいずれかなら、同じexecutorへの反復投入を止めてSolへ戻す。

- 一回目の検証が失敗
- 許可範囲外を変更
- 要件を再解釈する必要が発生
- 同一エラーを繰り返す
- executor自身が不確実性を報告

Solは失敗したdiff、検証出力、未達の完了条件を引き継ぐ。executorへ無制限に再試行させない。

## 並列実行

並列化するのは、書き込み対象が独立しているタスクだけとする。

- 一つのexecutorにつき一つのworktreeまたは独立コピーを割り当てる
- 同じ作業ツリーへ複数executorを同時に書き込ませない
- 共有DB、共有dev server、固定ポートを使うテストは直列化する
- 最初は少数で疎通し、その後に5、10、20並列と段階的に増やす
- rate limit、失敗率、p95所要時間が悪化したら並列数を戻す
- 取り込みと最終検証はSolが直列に行う

20並列を許可することと、20並列が常に適切であることは別である。タスク分離とprovider容量を先に確認する。

## 委任プロンプトのテンプレート

```text
Goal:
<達成する状態>

Allowed scope:
<変更可能なファイルまたはディレクトリ>

Do not:
- <変更禁止範囲>
- commit or push
- perform more than one implementation attempt

Verification:
Run exactly once after implementation:
<検証コマンド>

Report:
- changed files
- verification result
- remaining uncertainty
```

## 運用メトリクス

実行先の費用対効果は、単価だけでなくタスク単位で比較する。

- 一発合格率
- 独立検証の合否
- 所要時間
- input/output/cache token
- 推定費用
- 再試行回数
- Solへのエスカレーション率
- 人間またはSolによる修正時間

割引価格が終了した場合にも判断できるよう、実トークン量を保存する。キャッシュ込みの表示と実課金tokenを混同しない。

## 現在の既知ベースライン

2026-08-06の小規模Python実装比較では、SolとNous/DeepSeek V4 Flashはいずれも6テストに一発合格した。Nousは約20秒、Solは約36秒だった一方、報告tokenはNous 96,851、Sol 24,499で、Nousは約4倍消費した。

これは小規模な一課題の観測であり、一般的な品質保証ではない。実案件の継続測定でルーティング条件を更新する。

## 関連Skill

- [codex-delegate](../codex-delegate/SKILL.md): Claude CodeからCodex CLIへの委任
- [test-strategy](../test-strategy/SKILL.md): 検証方法の選択
- [branch-worktree-rules](../branch-worktree-rules/SKILL.md): 並列作業時のworktree境界
