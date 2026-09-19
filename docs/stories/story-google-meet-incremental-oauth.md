# story-google-meet-incremental-oauth

## Outcome

Brainbaseへログイン済みの利用者が、既存のGoogle OAuth clientを使ってGoogle Meetとカレンダー添付のGoogle Docs議事録を読み取り、会議後メールをGmailの下書きとして保存できる。ログイン権限は広げず、送信権限は与えず、ウッディ環境へclient secretや`credentials.json`を配布しない。

## Development mode

SIMPLIFICATION。既存の`google-workspace` provider、OAuth state、tenant credential storeを再利用し、別のGoogle認証基盤を作らない。

## Acceptance criteria

1. 通常ログインのscopeは`openid profile email`のまま変わらない。
2. 会議接続は`meetings.space.readonly`、`calendar.readonly`、`documents.readonly`、`gmail.compose`だけを段階的に要求する。`gmail.send`は要求しない。
3. 追加認可ではoffline access、incremental authorization、明示的consentを要求する。
4. token exchangeとrefreshは同じOAuth clientを使い、secret/tokenをログへ出さない。
5. Meet APIの会議記録一覧をread-onlyで取得できるprovider契約を持つ。
6. refresh token本文は通常DBの`credential_ref`へ保存しない。
7. Calendar予定の添付メタデータを読み、添付されたGoogle Docs議事録の本文を取得できるprovider契約を持つ。
8. Meet文字起こしと発話エントリをread-onlyで取得できるprovider契約を持つ。
9. Google Docs以外の一般Drive添付を読むための広い`drive.readonly`権限は要求しない。
10. 会議後メールはGmail下書きとして保存でき、送信は行わない。
11. 会議ワークフローはopaqueなcredential refだけを扱い、OAuth tokenを成果物・状態・応答へ露出しない。
