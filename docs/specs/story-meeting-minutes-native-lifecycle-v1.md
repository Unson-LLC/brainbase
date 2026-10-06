# Meeting minutes native lifecycle v1

このSpecは `story-meeting-minutes-native-lifecycle-v1` の最小実装契約を固定する。
外部のカレンダー、リポジトリ、組織プロバイダを必要条件にせず、Brainbaseの個人データ領域で会議と議事録の本文を保存し、版と確認の履歴を正本として読み戻す。

## 境界

- 正本は会議、議事録文書、議事録版の3つのドメイン記録で構成する。
- `meeting_id`、`minutes_id`、`version_id` はBrainbaseが生成する安定IDであり、外部サービスのIDをそのまま正本の識別子にしない。
- メタデータ（会議日時、参加者、タイトルなど）と本文は別の概念として扱う。本文は版に属し、メタデータは会議または議事録文書に属する。
- 本文の保存は `MeetingMinutesStoragePort` に委譲できる。既定実装は `BRAINBASE_PERSONAL_OS_DIR` または `~/.brainbase/personal-os/meeting-minutes.json` のローカルファイルである。保存はファイルロック下の再読込み・CAS・一時ファイル置換で行い、プロセスをまたぐ同時書込みも一方だけを成功させる。
- ストレージはスナップショットを一時ファイルへ書いて同一ディレクトリ内で置換する。読めない・不正な・競合したスナップショットを空一覧として扱わない。
- ACLの判定はドメイン外の認可ポートへ委譲する。ローカル既定はホストが認証した単一所有者 `self` であり、リクエスト本文の `actor_id` や組織名を権限の根拠にしない。
- 外部参照は任意の `source_ref`（provider、locator、revision、digest、任意のprovenance）として記録できるが、外部本文を別の書込み正本にはしない。native本文と外部参照は同じ版の中でちょうど一方を持つ。
- 確認は採用、判断、Task実行を発生させない。確認済み版のID、確認者、時刻だけを不変履歴として残す。

## ドメイン記録

```ts
interface Meeting {
  meeting_id: string;
  title: string;
  scheduled_at?: string;
  ended_at?: string;
  participant_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  created_actor_id: string;
  revision: number;
}

interface MinutesDocument {
  minutes_id: string;
  meeting_id: string;
  title: string;
  metadata: Record<string, unknown>;
  version_ids: string[];
  current_version_id?: string;
  confirmed_version_id?: string;
  created_at: string;
  created_actor_id: string;
  updated_at: string;
  revision: number;
}

interface MinutesVersion {
  version_id: string;
  minutes_id: string;
  meeting_id: string;
  predecessor_version_id?: string;
  body?: string;
  body_digest?: string;
  created_at: string;
  created_actor_id: string;
  confirmation?: {
    version_id: string;
    actor_id: string;
    confirmed_at: string;
  };
  source_ref?: {
    provider: string;
    locator: string;
    revision: string;
    digest: string;
    provenance?: Record<string, unknown>;
  };
}

`body` と `source_ref` は版ごとにちょうど一方を持つ。`source_ref` の provider・locator・revision・digest は省略できず、adapter固有の provenance は正本へ保持する。
```

`version_id` は保存済み本文とdigestの組み合わせを識別する不変記録である。同じ議事録の訂正は新しい版を追加し、`predecessor_version_id` で直前の版へ戻れる。確認済み版を訂正して保存すると、新しい版は未確認となり、旧版の確認レシートは旧版に残る。

## サービス契約

ドメインサービスは、現在の認証済み主体を含む `MeetingMinutesRequestContext` をすべての読み書きに要求する。実装上のsnake_case APIは次のとおりで、組織側は同じポートを認証済みcontextと保存portへ接続する。

- `list_meetings(context)` は主体から読める会議だけを返す。
- `create_meeting(input, context)` は会議と最初の議事録文書を作成し、正本の読み戻し一致を確認する。
- `create_minutes(meetingId, input, context)` は同じ会議へ別の議事録文書を追加する。
- `get_meeting(meetingId, context)` は会議、議事録文書、版履歴、各版の確認レシートを返す。meeting/document/version の現在認可をすべて通過しない限り本文を返さない。
- `get_version(meetingId, minutesId, versionId, context)` は現在認可を通した正確な版だけを返す。
- `save_version(input, context)` は本文または外部参照を検証し、新しい不変版を作成する。`expected_revision` が現在値と一致しない場合は書き込まず競合を返す。
- `confirm_version(input, context)` は現在のACLを再評価し、指定された正確な版を確認する。版が現在版でない場合も、対象版の存在と権限を検証したうえでその版のレシートを作る。
- `createMeetingMinutesVersionPort(store).readExact(reference, access)` は lineage などの読取り専用利用者へ正確な版を公開する。呼出しごとに native store の現在認可を通す。

すべての変更操作は本文の `actor_id` を無視し、コンテキストの主体とホストが付与した時刻を記録する。ストレージポートの集約revisionも比較し、同時書込みを成功として上書きしない。

## HTTP

ローカルWebと組織Webは同じパス契約を使い、組織側は認証・ACL・保存portだけを差し替える。

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/meeting-minutes` | 会議一覧 |
| `POST` | `/api/meeting-minutes` | 会議と議事録文書の作成 |
| `GET` | `/api/meeting-minutes/:meeting_id` | 会議詳細と版履歴 |
| `POST` | `/api/meeting-minutes/:meeting_id/minutes` | 議事録本文の新規版保存 |
| `POST` | `/api/meeting-minutes/:meeting_id/minutes/:minutes_id/confirm` | 指定版の確認 |

変更リクエストは `Idempotency-Key` を受け付け、キー・主体・payloadの組を同じスナップショットへ保存する。同じキーと主体・payloadの再送は、再起動後も対象を現在認可して読み戻した同じ結果を返す。payload違いは `409` とし、失敗結果を成功レシートとして保持しない。版保存と確認の競合は `409`、本文や識別子の不正は `422`、認可失敗は `403`、読み書き不能は `500` のJSONエラーとする。成功レスポンスは必ず読み戻した記録を返す。

## UI

OSSの共有画面はプロバイダ固有の接続操作を持たず、会議一覧、会議詳細、議事録の版履歴、本文入力、版ごとの確認を同じ画面遷移で提供する。APIのbase pathは `createMeetingMinutesUI` の設定で差し替えられる。空一覧はストレージが正常に空であることを確認できたときだけ表示し、読み込みエラーは理由と再試行を表示する。

## 受入検証

1. 外部連携なしで会議を作り、本文の保存、一覧、詳細、版履歴、確認を実画面から行う。
2. 保存前にプロセスを再起動し、同じIDと本文digestを読み戻す。
3. 同じ `expectedRevision` から二つの保存を試し、一方だけが成功し、他方は409で下書きを失わないことを確認する。
4. 確認済み版を訂正し、新版が未確認、旧版の確認レシートが残ることを確認する。
