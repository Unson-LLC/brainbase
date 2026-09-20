---
story_id: story-fixed-mana-slack-zero-refresh
status: accepted
---

# 更新トークンがないSlack接続を有効として採用できる

Brainbase運用者として、Slackが更新トークンを返さずRemote Credential Storeが`refresh_revision=0`を返す場合も、固定Mana Slack接続を本番へ採用し、次回の接続確認で同じ接続を有効と判定したい。これにより、接続版数と資格情報の更新版数を混同せず、実在するSlack接続を「未接続」や「競合」と誤表示しない。

## 受け入れ条件

- `refresh_revision=0`のopaque credentialを採用・保存できる。
- 負数、欠損、非整数の更新版数は拒否する。
- 接続版数2と資格情報更新版数0を別の概念として扱い、保存後の再確認は`existing`になる。
- 資格情報本体とopaque referenceを公開レスポンスへ含めない。
- 既存のappend-only revision 2移行と冪等性を維持する。
