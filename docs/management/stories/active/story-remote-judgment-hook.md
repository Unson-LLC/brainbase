# Story: 外部Claude実行をBrainbase判断ライフサイクルへ接続する

## 利用者価値

Slackへ議事録ファイルを投稿した利用者として、Cloudflare Container内のClaudeが議事録を生成するときも、Codexと同じBrainbase Judgment Resolverの判断・知識参照・監査を必須にしたい。これにより、Brainbaseを参照しないまま議事録が生成される状態をなくす。

## 受け入れ条件

- [x] AC1: 外部Hostは認証済みHTTP入口から `UserPromptSubmit`、`PostToolUse`、`Stop` を送信できる。
- [x] AC2: 入口は既存の `processHookPayload` を呼び、別の判断実装を持たない。
- [x] AC3: bearer tokenが欠落・不一致なら、Hook処理を実行せず401を返す。
- [x] AC4: `UserPromptSubmit`でResolverがunmanaged、timeout、invalid receiptならモデル実行前に失敗する。
- [x] AC5: `PostToolUse`と`Stop`は同じsession/turnのepisodeへ記録され、必要なKnowledge Resolver呼び出しと監査行が欠ける場合はStopをblockする。
- [x] AC6: 既存のloopback `/host/judgment/resolve` とCodex Hookの挙動は変えない。
- [x] AC7: `UserPromptSubmit`の正常応答は、canonical episodeのroute receipt IDとSHA-256 digestを外部Hostへ返し、表示文から再生成させない。欠落・不正値はfail closedにする。

## 成功指標

- 対象Claude生成の100%が、completeなjudgment episode receiptを持つか、モデル実行前に停止する。
- Resolver障害時に管理外の議事録を生成する件数が0件である。
