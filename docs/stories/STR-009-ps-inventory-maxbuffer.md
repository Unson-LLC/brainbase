---
story_id: STR-009
title: ps inventory スキャンの maxBuffer 不足による無音失明を解消する
source_requirement:
  requirement_title: "brainbase自体のLokiログを分析し可観測性と自己復旧の信頼性を損なう不具合を解消する"
architecture_docs:
  - kind: adr_unnecessary
    reason: Node child_process の ps 呼び出しに maxBuffer オプションを足すだけで、アーキテクチャ・データフロー・永続化・公開APIに変更はない。共有定数1つの追加と既存3箇所のオプション付与に閉じる。
status: in_progress
created_at: 2026-06-02
updated_at: 2026-06-02
---

# STR-009: ps inventory スキャンの maxBuffer 不足による無音失明を解消する

## 背景

brainbase の Loki に `[runtime-inventory] ps command failed { error: "stdout maxBuffer length exceeded" }` が断続的に出ていた。

`ps -axo ...command=` はプロセスのフルコマンド（全 argv）を含むため、claude/codex/node セッションが多くコマンド行が長い混雑時には出力が Node の child_process デフォルト maxBuffer（1MB）を超える。超えると ps 呼び出しが例外を投げ、runtime inventory と terminal reconciler は **プロセスを1つも観測できない（空）** 状態になる。inventory が無音で失明し、reconciler は ttyd 観測を失って状態を誤分類しうる。

実測でも 10,000 文字超のコマンド行が存在し、ピーク時に 1MB を超えうることを確認した。

## 誰が

brainbase の自己復旧（PTY Watchdog / terminal reconciler）と運用監視に依存する開発者として。

## 何を

ps inventory スキャンが、出力サイズが大きいというだけの理由で失敗しない状態にしたい。プロセス観測は混雑時でも完了し、inventory と reconciler が実プロセスを正しく観測できてほしい。

## なぜ

プロセス観測が無音で失敗すると、inventory は空を返し、reconciler は ttyd の生存を確認できず状態を誤判定しうる。自己復旧と監視はプロセス観測の正確さが前提なので、観測がサイズ起因で落ちてはならない。

## 受け入れ基準

- [ ] getRuntimeInventory の `ps -axo` 呼び出しに、1MB デフォルトを十分超える maxBuffer が渡される
- [ ] terminal reconciler の `_listProcesses` の `ps -axo` 呼び出しに、同様に十分大きい maxBuffer が渡される
- [ ] maxBuffer 追加後も `_listProcesses` は ps 出力を従来どおり行パースしてプロセス配列を返す
- [ ] VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- ps 失敗時の `catch` が空配列/空文字を返す既存挙動の変更（blind 観測時に reconciler の recovery を抑止する設計は別 Story）。本変更は maxBuffer 起因の失敗を取り除くことに閉じる。
- `[PTY Watchdog] reconciliation recovered 36 issue(s)` の慢性化（ps が 1MB 未満の時も発生しており、stale セッションの非収束という別根因の疑い。別 Story）。
- `ps aux | grep ttyd` 等、grep 済みで出力が小さい別系統の ps 呼び出し。
- ps 出力カラムの絞り込み（command= を comm= 等へ変更する最適化）。

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。
