# 議事録保存方針 Spec v1

Story: `story-meeting-minutes-storage-policy-v1`

## 目的と選択

Brainbaseが議事録を「どこに保存したか」「どこから取り込んだか」「会議の補足情報は何か」を一つの正本として混ぜないための保存境界を定める。保存先は会社ごとに設定でき、Google カレンダー、GitHub、Google Drive のいずれかを利用開始の前提にしない。

この実装で検証する最初の実外部保存先は、管理者が設定したファイルシステムのディレクトリである。adapter はその root 配下の既存ファイルを読み取る。これは契約 fake ではなく、実際に存在するディレクトリとファイルを検査する adapter である。会社の正本がどの製品・共有領域にあるかは顧客設定で決まり、repository の実装から推測しない。

## 境界

### 本文正本・入力元・会議情報

- 本文の正本（`canonicalPlacement`）は `native` または `external` のどちらか一つである。
- 入力元（`inputSource`）は `native`、`external`、または別の取り込み経路として記録する。カレンダーは会議日時・参加者などの補足情報を提供できるが、本文の正本ではない。
- 会議コンテキスト（`meetingContext`）は本文の保存先・入力元と独立して記録する。カレンダー event ID、GitHub repository ID、Drive file ID は任意の provenance であり、meeting/minutes の ID や作成条件ではない。

### 共通外部参照契約

外部本文を参照する値は次の値を同時に持つ。

| 項目 | 契約 |
| --- | --- |
| `provider` | adapter が実際に参照した provider の識別子。製品名を普遍要件にしない |
| `locator` | provider 内で原文に到達するための値。filesystem では root 相対パス |
| `revision` | 取り込み時に観測した原文の版。filesystem ではファイルの digest に基づく revision |
| `digest` | 取り込み時の本文バイト列の SHA-256 |
| `provenance` | 取り込み経路と観測時刻。会議コンテキストとは別に保持 |

読み取りは毎回、organization 境界から注入された `authorize(request_context, operation, target)` callback を本文の読み取り前に呼び出す。request に任意の `allowed` や認可結果を持たせず、adapter は callback の現在の判定だけを受け入れる。認可なし、locator の root 外解決、symlink、revision 不一致、digest 不一致、または source 不在は本文取得成功に変換しない。過去版が取得できないとき現在版を代用しない。

filesystem adapter は外部本文を安全に読むため、設定された `max_bytes`（既定 10 MiB）を超えるファイルを拒否し、不正な UTF-8 を本文に変換しない。解決したパスの symlink 拒否に加え、`O_NOFOLLOW` でファイルを開き、file descriptor のデバイス・inode・サイズと path の実体を読み取り前後に再検証する。境界を超えた本文は `too_large`、不正なバイト列は `invalid_encoding`、接続断や読み取り不能は `unavailable` として返す。

## filesystem adapter の capability

`FilesystemMeetingMinutesAdapter` は明示された customer root を外部正本の参照境界として扱う。第一実装の capability は次の通りである。

| Capability | 値 | 説明 |
| --- | --- | --- |
| `save` | `false` | Brainbase から外部ファイルを書き換えない |
| `read` | `true` | 認可・locator・revision・digest が一致する現行本文を読む |
| `read_only` | `true` | adapter は登録・読み取りだけを提供する |
| `history` | `false` | filesystem の履歴機構を仮定しない。過去版の現在版代用は禁止 |
| `current_acl` | `injected` | OS の mode bit だけを会社 ACL とみなさず、毎回の呼び出し認可を必須にする |
| `retention_delete` | `false` | retention と削除の責任を Brainbase に移さない |

未対応 capability は画面・サービス層で「未対応」「外部管理」として説明し、成功したように返さない。external body のコピーを native snapshot として保存して二重に編集できる状態を作らない。

## 再取り込みと来歴

同一 meeting/minutes ID と同じ provider/locator/revision/digest の参照を再取り込みすると、core の dedupe 契約により既存版を再利用する。本文 digest が変わると新しい外部版として扱う。Brainbase の meeting/minutes ID と既存版の provenance は保存先変更でも維持する。外部ファイルの移動・削除・権限取消し・接続断は、観測された状態を `unavailable` として返し、移行済みや取得成功とは記録しない。

## core 接続と画面投影

`MeetingMinutesStorageController` は、core の `MeetingMinutesStore` と同じ native/external content input を受ける薄い service 境界である。controller は次の順序を固定する。

1. `native` は body を core に渡し、core が Brainbase 管理の immutable version として保存する。
2. `external` は選択された provider adapter の `register` を先に実行し、成功した `provider/locator/revision/digest` だけを core の `source_ref` に渡す。外部本文は core snapshot に複製しない。
3. external version の表示・再利用は `read_source` を通して毎回現在 ACL を確認する。core に保存された参照だけでは本文を表示せず、adapter が `available` を返した場合だけ本文を表示する。
4. registry が同じ source reference を返した場合は既存 identity を再利用し、同じ `minutes_id` の新規 version を作らない。revision/digest が変わった場合だけ core の `save_version` を呼び、新しい version を作る。
5. `rebind` は既存 `minutes_id` を維持した successor version を作る。external adapter への書き戻しは行わず、native への明示的な再配置時だけ読み取れた本文を native version に渡す。

controller の registry は組織側で core の `external_source_hook` と同じ durable registry に接続する。未指定時の in-memory registry は同一プロセス内の短命な検証用であり、再起動をまたぐ重複排除の証跡にはしない。

`ui/meeting-minutes-storage.js` は controller の projection を表示するだけの共通部品である。`native`、外部取得済み、権限不足、接続断、保存時点の版が取得できない状態を分け、provider名・locator・revision・digest と capability を表示する。本文や過去版を取得できない場合は、現在版を代用した成功表示を出さない。配置選択や再試行は host callback に委譲し、Google カレンダー、GitHub、Google Driveを画面の必須選択肢として埋め込まない。

## 実装と検証の対応

| 受入条件 | 検証 |
| --- | --- |
| AC-01 | native/external/calendar-context を別フィールドで登録する型検査と契約テスト |
| AC-02 | native 側の capability と filesystem adapter の `save=false/history=false/retentionDelete=false` を readback |
| AC-03 | locator、revision、digest、provenance、認可再確認、root escape/symlink/改変拒否のテスト |
| AC-04 | 同一参照の再取り込み dedupe と本文変更時の新 revision を core と接続して確認 |
| AC-05 | 外部ファイル rename/delete/接続 root 不在時に ID と過去の来歴を失わず制約を返すテスト |
| AC-06 | temp directory 上の実ファイルで register → read → source change → reimport → authorization revoke/disconnect を通す。契約 fake のみのテストは受入証跡にしない |

## 未確認

対象会社が選ぶ具体的な保存製品、保持期間、外部 ACL の管理主体はこの OSS Spec からは決めない。顧客設定と organization 側の認証・方針境界で確定し、実利用者の受入で確認する。今回のテストが示すのは、明示された filesystem root に対する adapter の実動作だけである。
