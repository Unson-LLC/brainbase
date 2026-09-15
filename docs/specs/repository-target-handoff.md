# 変更先の判断をVibeProへ渡す

## 目的と成功条件

利用者として、Brainbaseが今回の修正先と判断したリポジトリと、VibeProが送信するリポジトリを一致させたい。
変更先が未確定なら実行用引数を作らない。originやディレクトリ名から補わない。

## 最小の接続

`scripts/repository-target-handoff.mjs` の `buildRepositoryTargetHandoff` は、判断済みの `repository`（GitHubのowner/name）と作業場所の絶対パス `cwd` を受け取り、VibePro用の引数配列と環境変数の差分を返す。
シェル文字列を組み立てず、外部コマンドは実行しない。

`--repo` と `VIBEPRO_EXPECTED_REPOSITORY` には同じ値を渡す。呼び出し側は既存環境より返却された環境差分を優先し、別の `--repo` を追加しない。
値は今回の変更内容とリポジトリの役割に基づく判断から渡す。Judgment Resolverのreceipt自体をpush許可として扱わない。
この関数は判断の正しさ・承認を検証するものではない。

## 合意済みの最終構成

- 公開共通コア：`brainbase`
- 非公開の共通組織版本体：`brainbase-organization`
- 雲孫の社内利用設定：`brainbase-config-unson`
- Growin設定・導入・受入：既存のBacklog Git
- 提供者運用：本体・会社別設定から分離した非公開の運用管理先

`brainbase-unson` は分離元であり、最終的な共通組織版本体の名前ではない。
これは移行先の方針であり、各リポジトリが作成済みであることを意味しない。実在確認前に最終名へ送信しない。
この文書は判断方針を示すもので、組織情報のGraph正本に代わる自動ルーティング台帳ではない。

## 移管後の境界

共通の組織接続クライアント、その単体・Windows実機テスト、専用CI、配布仕様は `brainbase-organization` が所有する。移管元の `brainbase-unson` には同じ実装やEVO2 workflowを重複保持しない。

一方、既存本番NocoDBは安全なデータ移行、照合、切替、切戻しの証拠が揃うまで削除しない。これは共通組織UIからNocoDBへ直接接続してよいという意味ではない。共通組織UIは認証・組織境界・監査を担う正規APIだけを利用し、NocoDBのURL、token、base/table IDを受け取らず、直接read/writeしない。移行期間中のNocoDB永続層と雲孫固有運用はこの分離元に残せるが、共通UIの依存先にはしない。

NocoDBの撤去は、件数と内容の照合、writer排水、正本切替、利用者readback、切戻し手順を含む別の承認済み移行として扱う。このoverlay縮小だけを撤去証拠にはしない。

## 今回の検証範囲と未接続部分

単体テストで、変更先の保持、未指定の拒否、不正値の拒否、絶対パスの必須化を確認する。
VibeProのローカル変更との接続確認は、引数を照合関数へ渡すだけとし、pushしない。

## 実行経路への接続

`.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs` に `pr-create --cwd <絶対パス> --repo <判断済みowner/name>` を追加した。
これは外部書き込みを行う入口であり、実行前に通常のpush・PR作成の権限確認が必要。今回のテストでは実行部を置き換え、外部書き込みしていない。
版検証、照合機能の対応確認、明示した変更先を伴うPR実行の順に処理する。
対応確認で生成するURLは機能確認用であり、実際の送信先を確認した証拠ではない。実際のURLはVibeProのPR実行処理とGitのpre-pushで照合する。

`.husky/pre-push` の先頭から同じ実行契約の `push-target` を呼び出す。
Gitの第2引数（実際の送信先URL）と、判断済みの `VIBEPRO_EXPECTED_REPOSITORY` をVibeProの `guard target` で照合する。
旧来のスキップ設定、ブランチによる分岐よりも先に実行する。旧CLIの終了コード0だけでは成功と扱わず、対応する形式の照合結果を必須にする。

モデルの判断を自動抽出する処理は追加していない。判断した変更先を上記入口に明示して呼び出す。
レビュー・公開済みのVibePro `0.2.0-beta.23`（source `80e0b5cf1ae133be802c88344cf7cf35abd1b597`）へ固定値を更新した。
稼働checkoutの有効なフックでも一致・不一致・未指定を検証した。詳細と切戻し境界は `repository-target-activation-2026-09-13.md` を参照。
未公開の変更へ版番号・信頼ハッシュを付け替えて検証を迂回しない。
Backlogの送信先照合は未対応。Growin向けの組織版提供も未実施。
一致確認だけでは、変更内容や到達可能なGit履歴の公開可否を保証しない。

## ローカル検証結果

- `node --test tests/unit/repository-target-runtime.test.mjs tests/unit/repository-target-handoff.test.mjs`：10件成功。
- Brainbaseの照合関数からローカルVibeProの実CLIを子プロセスで呼ぶ確認：一致は成功、不一致は拒否。push・PR作成は実行していない。
- 変更先未指定で `.husky/pre-push` を直接起動：旧スキップ設定があっても停止。
- `bash -n .husky/pre-push` と `git diff --check`：成功。
- 既存の `vibepro-runtime-hook-contract.test.js`：初回はVitest依存パッケージの解決に失敗。2026-09-13、既存のVitestをprogrammatic APIで起動し、`config:false` と `vitest` の明示aliasで対象ファイルを実行、7件成功。標準プロジェクト設定を含む全体テストの成功ではない。依存の追加インストールはしていない。
- 2026-09-13の有効化前確認：正規launcherが使うパッケージは `0.2.0-beta.22`。そのCLIに `repository-target-v1` / `guard target` の実装は見つからない。対象worktreeの `core.hooksPath` は `.husky/_` だが、その `pre-push` は存在しない。共有設定やlauncherは変更していない。
- Graphify：インデックスなし。影響範囲は未確認であり、影響なしとは扱わない。
