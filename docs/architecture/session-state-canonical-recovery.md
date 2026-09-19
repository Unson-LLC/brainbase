# 旧セッション状態管理の退役と取得障害からの回復

## Story

利用者がBrainbaseを理解・運用するとき、廃止済みの状態管理が別の正本として残らず、外部取得障害を正常な0件と誤認しないこと。

## 対象と現在地

- 基準: develop ac15239ee。前回調査の旧 session-runtime と run-cleanup-phase2 は削除済み。復活させない。
- ADR-019と現行compositionを確認した結果、セッション管理の責任はCodex app/CLI。BrainbaseのSQLite/JSONストアは両方とも未使用。旧データは移行証跡として保護する。
- 外部統計は正本ではなく取得結果の投影。取得失敗と正常な空結果を区別する。
- 本番データ操作、配備、旧データ削除、別製品への機能組込みは対象外。

## Spec / 受入条件

1. 旧SQLite/JSONストアとそれに閉じたcontroller/route/helper/専用testを削除し、active compositionへ復活させない。
2. `/api/state`はGET/POSTとも410を維持し、起動・終了で旧データを読み書きしない。既存DB/JSONは削除も移行も行わない。
3. 旧セッションstateに限定して読み書き経路を調査し、旧installerによるstate作成を停止する。不要になった旧処理は復活させない。別ドメインのstateファイルは対象にしない。
4. 外部統計のコマンド失敗・不正応答は非成功応答とし、0件の成功としてキャッシュしない。正常な空配列は正常な0件として扱い、次のリクエストで回復できる。
5. 対象テストで退役境界・障害・再試行を検証する。既存変更と本番データを保全する。

## 設計と復旧

ADR-019の責任分担を適用し、新しい状態管理基盤を増やさない。未使用ストアの不具合4件を隔離テストで再現したが、修理して温存せず実装自体を削除する。API は取得失敗を明示し、正常な取得のみ既存キャッシュの対象にする。

ロールバックはコード変更をrevertする。削除対象はGitで復元可能な未使用コードのみで、データの移行はない。ロールバックでも旧state routeを再登録しない。本番切替は別の承認を得て行う。

## 責任分担

| 対象 | 正本・責任 | 今回の扱い |
|---|---|---|
| task/thread/worktree/terminal | Codex app/CLI（ADR-019） | Brainbaseの孤立した旧storeを削除 |
| 過去のstate.db/state.json | 凍結した移行証跡 | 内容・保存場所を変更しない |
| Mana実行統計 | GitHub Actionsの実行履歴 | Brainbaseは取得結果を投影。取得失敗は503、再取得可能 |
| 正規installer | package.jsonのsetup → scripts/setup.sh | rootの旧installerは案内のみで失敗終了。自動転送しない |

## 別の変更として残す範囲

これはBrainbase全体の刷新完了ではなく、ADR-019の残存実装と統計取得障害に閉じた変更である。

- 旧UIのstate API呼出し（public/modules/session配下）は[残存整理](../verification/legacy-surface-completion.md)で物理削除済み。旧運用Skillの全面監査は、このUI整理だけでは完了扱いにしない。
- lib/runtime-paths.jsとconfig-controller.jsのstateFileパス投影は書込主体ではない。消費側を確認した別のAPI互換性変更で扱う。
- Mana統計の`test=true`疑似値と取得できない`avg_duration_ms: 0`の表示契約。今回の503修正だけで全項目の正確性を保証しない。
- Graph、Automation、認証、外部接続それぞれの正本・責任・再試行の全面監査。

## 根拠の限界

Graph検索は関連候補のみで設計本文を取得できなかった。過去の設計意図は未確認。今回の判断は最新コードと隔離された回帰テストに基づく。変更後のGraphify更新ではrouteと境界testを取得したがsetup.shは未対応でpartial。影響なしとは扱わず、import検索・shell本文確認・隔離testで補完する。

## ローカル検証（2026-09-18 / Node 22.23.2）

- 旧store/helper/controller/routeを参照するproduction importは残っていない。境界test内の禁止パス表だけを維持。
- `development-runtime-boundary`、`retired-capability`、`brainbase`、`runtime-paths`、`server-lifecycle-timeouts`、`retired-setup`の6ファイル、35テスト成功。
- 変更JSのESLint、`npm run typecheck`、`bash -n setup.sh scripts/check-worktree.sh`、`git diff --check`成功。
- 旧store削除前にはファイル不在を要求する境界testが失敗し、削除後に成功。統計取得失敗と不正runも修正前の失敗から成功を確認。
- 実際のGitHub Actions取得、本番起動、データ移行・削除は実行していない。GitHub CIとmergeはローカル検証とは別の段階。
