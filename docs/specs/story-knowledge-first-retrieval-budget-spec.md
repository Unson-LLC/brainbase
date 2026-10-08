# 初回取得と検索時間予算

Story: [story-knowledge-first-retrieval-budget](../user_stories/active/story-knowledge-first-retrieval-budget.md)

`src/knowledge-continuation.ts`の状態に省略可能な`retrieval_started_at: number | null`を追加する。新規はnull。全検査を通った最初のsearch/read/follow_relation予約時だけnowを設定する。`started_at`はlookup生成の監査時刻として残す。

expireはretrieval_started_atからmillisecondsを測る。値が未保存の旧状態はattemptsまたは取得pendingがあればstarted_atを使い、無ければ未着手とする。新規でも保存後の時刻を変更しない。終端状態を自動で開かない。

検索前のStopでは時間だけを理由に終端にしない。既存のstop_requests/rejected_plans上限で有限に終了する。contextにretrieval_phase（not_started / in_flight / attempted）を出す。取得の有無は時間開始と区別し、pendingは取得完了の証拠にしない。

`tests/knowledge-continuation.test.ts`で、121秒後の初回許可、不正計画後の遅延初回、検索開始後120秒の期限切れ、serialization後の予算保持、旧状態の有無・終端維持、0回Stopの続行と有限終了を検証する。既存の取得・認証・finish検査を回帰実行する。

Hostの最終結果への反映は利用側repoの対応Storyで扱う。パッケージ試験のみで配備済みHostの修正を主張しない。

レビューで、時間切れ時に取得予約が消えて未着手へ戻る経路を確認した。期限切れの予約は結果不明のtransport_errorとして残し、遅延結果で終端を再開しない。旧終端の予約も同じ規則で正規化する。

検証: Node22.23.2でcontinuation/lookupの43テスト成功。独立レビューの予約消去指摘を修正し、期限超過の結果と旧終端予約の正規化を検査した。
