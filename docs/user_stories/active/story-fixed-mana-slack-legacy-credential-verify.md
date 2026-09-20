---
story_id: story-fixed-mana-slack-legacy-credential-verify
status: accepted
---

# 旧版Slack接続を資格情報の版に合わせて検証できる

Brainbase運用者として、revision 1で稼働中の固定Mana Slack接続をrevision 2へ移行するとき、既存資格情報を保存時の接続版数で検証し、新しい資格情報をrevision 2で検証したい。これにより、Remote Credential Storeの版数境界を守ったままappend-only移行を完了できる。

## 受け入れ条件

- 旧接続の資格情報はconnection revision 1として検証する。
- 新しく保存した資格情報はconnection revision 2として検証する。
- すでにrevision 2の接続はrevision 2として検証する。
- 資格情報本体とopaque referenceを公開レスポンスへ含めない。
- 新規採用、既存判定、移行失敗時の補償を維持する。
