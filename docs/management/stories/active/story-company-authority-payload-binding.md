# 実行データを拘束した会社権限の取得

会社の利用者として、登録済みのプロジェクト権限でManaの実行を許可しつつ、許可後の実行データの差し替えを拒否したい。

関連: `story-canonical-company-authority-context`。A0の本番接続に必要な修正であり、Program全体やT0の本番隔離証明を完了扱いにしない。

## 受入条件

1. 正本で解決したプロジェクトのIDまたはcodeに一致する、SHA-256付きまたはfragmentなしのproject参照を受理する。
2. 権限検索には検証済みの安定参照を使い、tenant・membership・organization・project・capability・effectの制約を維持する。
3. 外側contextと内側tenant contextの署名対象には元のhash付き参照を残し、別payloadへの再利用を拒否する。
4. 不正fragmentは経路検索前に拒否し、別project・権限なしも許可しない。project参照はfragmentの有無にかかわらず正本project_idへ正規化してbindingを検索し、personal://等の参照は維持する。

仕様: `docs/specs/company-authority-payload-binding.md`。
本番配備、実権限bindingの存在、7境界のreadbackは別途検証が必要。

## Slack channelからの会社権限導出

会社の利用者として、署名検証済みのSlack channelに配置されたプロジェクトでManaを実行したい。人ごと・プロジェクトごとの新しいidentityやgrantを作らず、既存の人物・membershipとchannel policyから会社権限を解決する。

### 受入条件

1. 管理者が管理する `config/manifests/slack-channel-authority.json` をchannel policyの正本とし、Slackのworkspace・app・channel、tenant・organization、projectのID/code、MANA placement、`runtime.execute`、許可effect、revisionを保持する。1つのchannelに複数projectを設定できる。
2. 初期のback-office channelとmana channelは、それぞれ正本のproject IDに解決し、既存のactive `auth_grants`、人物、tenant membershipからcanonical personを導出する。解決中に人物・membership・external identity・grantを作成しない。
3. `project:<code>` の旧aliasを含むproject参照は正本project IDへ解決してbindingを検索する。要求projectがchannel policyにない場合や複数候補になる場合は拒否する。
4. 選択channelのprovider、top-levelと `provider_identity` のworkspace/app、Slack requesterと認証済みsubject、tenant、capability、effectが一致しない場合はfail closedする。channelが未登録の場合は既存の権限解決経路へ戻す。
5. C/G channelだけをchannel policyの対象とし、DM・personal resourceは既存経路の扱いを維持する。channel policyは `runtime.execute` だけに適用する。
6. 既存bindingの明示deny・approval・human actionとeffect制限を上書きしない。binding履歴がない場合だけchannel policyからauto authorityを導出し、superseded履歴だけの場合は許可しない。現在のrevoked binding、期限切れまたは未来有効のbindingがある場合はsynthetic autoへ切り替えず拒否する。

仕様: `docs/specs/company-authority-payload-binding.md` の「Slack channel policy」。
