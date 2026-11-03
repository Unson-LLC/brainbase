# Story: 公開MCPでTask queueの仕事を進める

Story ID: `story-mcp-queue-task-tools-v1`

状態: Develop / Unreleased（実装PR。fixture で検証、実 API は未確認）

## Story

Task queueで働くAI member / agentとして、公開`@unson/brainbase-mcp`のMCP toolsで、自分のTaskを確認し、割当可能なTaskをclaimし、成果のevidenceを添付して完了を報告したい。同じ契約をstdioとStreamable HTTPで利用し、operator overlayのruntime複製に依存せず仕事を進めたい。

## 受け入れ条件の概要

- AC-1〜AC-3: 公開tool定義、一覧・詳細・ページング、認証済みagentに限定した認可が揃う。
- AC-4〜AC-6: ID指定claim（owner承認済み）/ claim next、lease更新、evidence追加、完了を含む状態更新がhost注入のQueueTaskBackendへ届く。
- AC-7〜AC-9: 再送・競合・不正入力・API障害が構造化結果となり、annotationsが副作用を正しく示す。
- AC-10〜AC-12: stdio / HTTPとoperator overlayが同じ契約テストを実行でき、公開subpathを外部consumerから利用できる。

各ACの正本と追加する正確なテスト名は[Spec](../specs/mcp-queue-task-tools-v1.md#受け入れ条件と追加するテスト)に置く。これは将来の実装検収条件であり、本docs PRでテストを実装済みとは扱わない。

## 対象外

- factory dispatch、run起動、worker選択、予算・並列数の新しい制御。
- operator overlayの切替・重複実装の削除。その完了は公開package提供、同じ契約テストの成功、利用側の依存更新を別途確認して判断する。
- server-side queue、保存形式、claim選択・lease・完了判定の変更。
- 人間の承認の作成、Task作成・削除、組織管理UI、認証providerの実装。

## 残る判断

ownerが2026-11-01に7 tools（確認済み5 tools + `get_task` / `claim_task`）での進行を承認した。ID指定claimとagent限定詳細取得の正式API、応答schema、完了再送の保証範囲は未確認のまま残り、Specの未確認事項で扱う。local-firstの既存18 toolsに組織サービスを必須化しない。

queue toolsはhost注入のQueueTaskBackendに依存し、特定hosted APIを必須にしない。backend注入時はowner承認済みの7 toolsを登録する。
