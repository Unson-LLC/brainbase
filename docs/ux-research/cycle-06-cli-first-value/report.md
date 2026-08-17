# cycle-06 CLI初回価値 UX改善結果

## 結論

CLI部分は収束した。実プロセスの `onboard:start → onboard:seed → onboard:demo` は2,078msで、10分の予算内だった。ローカルtarballへインストールした公開バイナリでも、help、start、表示されたseed、表示されたdemo、doctor、doctorが表示したdemo、同一内容の再seed、再seed後のdoctorを実行した。正常系は終了コード0、復旧が必要な2経路は終了コード1だった。

ただし、demoは保存済み文脈からCLIが組み立てるサンプルである。実エージェント接続と実応答は未確認であり、製品全体の初回価値達成とは扱わない。

## 実行した経路

1. `npm run onboard:start -- ...`
2. 出力された `brainbase onboard:seed ...`
3. 出力された `brainbase onboard:demo ...`
4. `npm run doctor -- ... --format json`
5. `npm pack` したtarballを隔離consumerへインストール
6. `node_modules/.bin/brainbase` からhelp、start、seed、demo、doctorを実行

## 実測

| 証拠 | 結果 |
|---|---|
| CLI初回価値サンプル | 2,078ms / 600,000ms、保存文脈3件と実用的な4つの見出しを反映 |
| 正常系 | start、seed、demo、doctorが終了コード0 |
| 復旧 | seed前demoと不正seedはいずれも終了コード1。理由、入力例、次の操作を表示 |
| 再開・再seed | 既存状態からdemoへ復帰。同一内容を再seedしても件数は3 / 3 / 1 / 1のまま |
| ローカルtarball | SHA-256 `e7b72fd91b1c74dca1ef0cd9968213847cdd36c0d6c5d9697089abbebd72115a` |
| インストール済みdoctor | `localBackend.connected=true`、`agentMcp.status=not_verified`、`operationallyReady=false` |

## 改善した内容

- `brainbase --help` の先頭を最短3ステップにした。
- `--help` を書き込みや初期化より先に処理するようにした。
- npmが作るsymlink経由でも公開CLIエントリポイントを認識できるようにした。
- `onboard:start` と `onboard:demo` の既定出力を短くし、詳細を `--details` へ分けた。
- seedの保存内容、非削除、次コマンドを日本語で表示した。
- 不正な関係者入力を非0で止め、有効な入力を保持した再実行例を表示した。
- seed前のdemoも非0で止め、未設定をシェル上の成功へ丸めないようにした。
- demoを作成予告ではなく、判断、相談、未確認事項、次の行動を含む本文へ変えた。
- `doctor` のローカル接続と実エージェント接続を別の状態として表示した。
- 同じ文脈の再seedは更新として扱い、重複エラーにせず、既存の別データを削除しないようにした。
- demoの近くに「CLIサンプル」「実エージェント接続は未確認」「実応答の確認方法」を表示した。
- README、VitePress quick start、CLI referenceを実際の導入経路に合わせた。

## ペルソナ収束

固定したCLIコーパスを各ラウンド32の独立ペルソナ解釈へ渡した。第1〜第3ラウンドの実証可能な重大所見を修正し、第4ラウンドを最新コーパスで再評価した結果、4タスクを完了し、6ハードゲートを通過、新規のtrace-backed majorは0件となった。

軽微な摩擦として、低習熟者や音声入力ではseedコマンドが長く、低習熟者やスクリーンリーダー利用者ではhelp全文とdoctor JSONが長く感じられる可能性が残る。初回経路の冒頭3ステップと各出力の次コマンドがあるため、今回の完了を妨げる重大所見には数えなかった。

ペルソナはCLIを個別再実行していない。CLIは中央で実プロセスとして実行し、凍結したstdout、stderr、終了コード、所要時間を各ペルソナが独立に解釈した。

## 未確認境界

- 実Codex / Claude CodeセッションからのMCP `get_context` / `search`
- 実エージェントが生成した同一依頼への応答
- npm本番レジストリからのインストール
- 実在利用者の観察
- 実機、音声入力、スクリーンリーダー等の支援技術

したがって今回の判定は「CLIの初回価値サンプルと安全な復旧は収束」。実エージェント運用と本番配布は別の未確認フェーズである。
