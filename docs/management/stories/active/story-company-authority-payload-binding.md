# 実行データを拘束した会社権限の取得

会社の利用者として、登録済みのプロジェクト権限でManaの実行を許可しつつ、許可後の実行データの差し替えを拒否したい。

関連: `story-canonical-company-authority-context`。A0の本番接続に必要な修正であり、Program全体やT0の本番隔離証明を完了扱いにしない。

## 受入条件

1. 正本で解決したプロジェクトのIDまたはcodeに一致する、SHA-256付きproject参照を受理する。
2. 権限検索には検証済みの安定参照を使い、tenant・membership・organization・project・capability・effectの制約を維持する。
3. 外側contextと内側tenant contextの署名対象には元のhash付き参照を残し、別payloadへの再利用を拒否する。
4. 不正fragmentは経路検索前に拒否し、別project・権限なしも許可しない。fragmentなしの既存参照は維持する。

仕様: `docs/specs/company-authority-payload-binding.md`。
本番配備、実権限bindingの存在、7境界のreadbackは別途検証が必要。
