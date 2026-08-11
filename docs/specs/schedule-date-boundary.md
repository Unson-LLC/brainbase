# Schedule Date Boundary Spec

Google Calendar取得コマンドには `[date, nextDate)` の範囲を渡す。その応答を信頼せず、正規化後にサーバー設定タイムゾーンで再判定する。

- timed event: `startDateTime` のローカル日付が指定日と一致
- all-day event: `startDate <= date < endDate`

取得失敗の診断情報と並び順は既存契約を維持する。
