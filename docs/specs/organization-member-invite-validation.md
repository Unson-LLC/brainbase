# 組織メンバー招待 v1 の受け入れ確認

対象は [招待仕様 v1](./organization-member-invite-v1.md) と
[Story](../stories/story-organization-member-invite-v1.md)。これは実装時に使う検証計画であり、
テスト成功・機能提供済みを示す記録ではない。仕様の AC と境界を正本とする。

## 確認環境と記録

kernel の確認は fake clock、操作を記録する DI fake、競合を制御できる repository で行う。
atomicity は fake の結果だけでは保証できないため、利用側の実ストレージ adapter でも競合試験を行う。
画面・ログイン連携は組織版のローカル fixture または検証環境で確認し、OSS に組織管理画面を追加しない。
delivery は記録用 fake を用い、実メールの送信・送信設定・本番反映を検証完了の前提にしない。

各結果には実装 PR、head SHA、実行コマンドまたは操作手順、期待値と観測値、証跡へのリンクを残す。
未実装・未実行・失敗・成功を区別し、fixture の成功を実 provider の成功として扱わない。
証跡には架空のメールアドレスとテスト用データを使い、受諾 URL の token、hash、予約マーカー、
認証情報を掲載しない。リンクの動作確認は掲載用画像とは別に行う。

## kernel / adapter の確認表

各行はまだ未実行。実装 PR で結果を記録する。

| 仕様 | 入力・操作 | 確認する結果 |
| --- | --- | --- |
| AC-01 | 許可された管理者が発行し、保存引数と戻り値を観測 | 保存は hash と record のみ。生 token は一度返る URL にのみ現れ、readback に残らない |
| AC-02 | 前後空白・大文字を含むメール、secret-shaped metadata をそれぞれ入力 | メールを正規化。禁止 field を拒否し秘密値を保存・公開しない |
| AC-03 | 検証済みメールが一致する認証済み person が受諾 | 予約→binding→確定の順で指定 tenant/role に加入し、accepted の person と時刻が一致 |
| AC-04 | 不一致メール、未検証メール、明示許可 policy を個別に試す | 既定は email_mismatch で binding なし。例外 policy の場合だけ許可 |
| AC-05 | binding の副作用なし失敗、結果不明、binding 成功後の確定失敗、確定後の監査失敗を注入 | 副作用なしの場合だけ解放。結果不明・確定失敗は accepting を保持。同じ person/role と inviteId で冪等復旧し、別 person に渡らない。確定後の監査失敗で accepted を戻さない |
| AC-06 | fake clock を期限前・期限超過に進め受諾と再送 | 期限超過は expired で binding/delivery なし。再開は reissue。期限ちょうどの扱いも実装で明示して固定時刻で試験する |
| AC-07 | pending の取り消し後に受諾。予約と取り消しを両順序で競合させる | 取り消しが先なら binding なし。予約が先なら取り消し・再発行は accept_in_progress。accepted は不変 |
| AC-08 | 同じリンクで逐次・同時に2回受諾 | 二重受諾を拒否し、別 person の binding が起こらない。復旧時の binding 再呼び出しも同一冪等キーで副作用は1回 |
| AC-09 | raw token のある pending の再送、token のない再発行、期限切れの再発行、受諾との競合 | 再送は同じリンク。再発行は旧リンクを無効にしてから新リンクを delivery に渡す。旧 record は revoked 相当で supersededByInviteId を持ち、競合で両方有効にならない |
| AC-10 | 全公開操作について権限なし・別 tenant・許可されない role を試す | 読み出しも拒否。拒否後に delivery/binding を呼ばず、他 tenant の内容を公開しない |
| AC-11 | delivery 成功・例外を注入し envelope と公開エラーを観測 | 宛先 PII と URL 内 token 以外の秘密値なし。例外の raw message を公開しない。URL と宛先をログに残さない |
| AC-12 | 許可された readback とログ・監査・エラーを収集 | 管理者にはメールと状態が見えるが hash/予約は見えない。ログ等に生メール・token がない |
| AC-13 | 全 DI を fake に置き換え実行し、fresh consumer から subpath import | 外部サービスなしで検証可能。公開 tarball の型・実行時 export が一致 |

ビルド、focused unit tests、fresh consumer smoke の結果を実装 PR に記録する。
HTTP adapter は認証済み person/tenant を信頼できる認証境界から受け取り、クライアントが任意に指定した
person/tenant をそのまま認証結果として採用しないことも利用側の試験で確かめる。

## 画面・ログインの確認と前後画像

画面の実装先は組織版。実装前後を同じ viewport・同じ架空データで撮り、PR に添付する。
変更前に画面が存在しない場合は現在の入口を撮り、存在しないことを明記する。

| 場面 | 操作と期待値 | 必要な証跡 |
| --- | --- | --- |
| 管理者の招待 | メール・許可された role を入力し発行。宛先・状態を確認 | 入口の前後画像、発行成功の画像と対応する検証結果 |
| 招待から加入 | fake delivery のリンクを開き、対象組織で選ばれたログイン方法を通り、招待 role で加入 | ログイン入口と加入後の画像、tenant/person/role の非秘密の照合結果 |
| 拒否・失効 | 未ログイン、メール不一致、期限切れ、取り消し、二重受諾を個別に試す | 各状態の表示、加入が増えていないことを示す結果 |
| 管理操作の制限 | 権限なし・別 tenant で画面と API にアクセス | 操作できない表示と API の拒否結果。ボタン非表示だけで成功扱いにしない |
| 再発行・競合 | 再発行後の旧リンクと、受諾処理中の取り消しを試す | 旧リンク拒否・処理中の競合表示と adapter 試験結果 |

ローカルでログインを模擬した場合は「ログイン方法の選択・受け渡しのみ確認」と記録する。
実 provider の往復が未確認なら、その未確認を残す。画面画像だけで kernel の atomicity や永続化の成功を証明しない。

## 完了判定

kernel 実装と組織版の adapter・画面の確認結果を揃え、未確認の統合箇所を列挙する。
この確認表の追加、仕様 PR のマージ、fake delivery の成功だけでは招待機能全体を完了にしない。
実メール送信設定と本番反映は別途承認の対象として残す。
