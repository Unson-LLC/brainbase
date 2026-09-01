# Project能力意図モデル v1

## 目的

Projectは最小情報で登録できるようにする。機能の未設定をProject全体の不合格にはしない。
各機能について、利用意図とその機能だけの準備状態を分けて表示する。

## 最小登録

```yaml
project_code: growin
name: Growin向けBrainbase
organization: unson
created_by: keigo
```

登録時に必須なのはこの4項目だけである。`local_path`、Slack、Mana、GitHub、Drive、関係者一覧は登録条件にしない。

登録を拒否するのは、入力形式が壊れている、`project_code`が重複している、組織一覧が未構成、組織一覧に存在しない、署名済み認証情報の所属組織と一致しない、認証または書き込み権限がない場合である。既存Projectの構成・点検・照合は、所属組織に加えて認証情報の`projectCodes`にも含まれる必要がある。`ceo`は同じ所属組織内に限りProject横断で操作できる。

`project_code`はGraph・CLI・APIで共通利用する全組織共通の一意な公開識別子である。重複時は所属組織にかかわらず`409 CONFLICT`を返すが、返す情報はコードが利用済みであることだけに限定し、既存Projectの所属組織・名称・設定は開示しない。

このAPIが確認するのはローカルProject Catalogへの登録である。Graph登録、認可grant、外部サービス上のtenant帰属は別の確認範囲であり、未検証のまま成功扱いにしない。

## 能力の利用意図

```yaml
capabilities:
  mana:
    desired_state: disabled
    reason: このProjectでは人間がSlack対応する
  slack:
    desired_state: enabled
    primary_channel_id: C123456
  github:
    desired_state: deferred
  drive:
    desired_state: enabled
    folder_id: folder-1
```

`desired_state`は次の4値だけを取る。

| 値 | 意味 |
| --- | --- |
| `enabled` | 利用する。必要な設定と検証を能力単位で点検する |
| `disabled` | 意図的に利用しない |
| `deferred` | 後で導入する |
| `unspecified` | 意図が不明。登録は止めず警告する |

点検結果はProject全体の`ready / not_ready`を返さない。Projectは`registered`、各能力は`ready`、`unconfigured`、`unverified`、`disabled`、`deferred`、`warning`のいずれかで返す。

`enabled`で必要設定が揃っただけなら`unverified`とする。`ready`は、信頼できる検証処理が`evidence_id`と`verified_at`を含む検証証跡を保存した場合だけ返す。登録・構成APIから`verification`を自己申告することはできない。

接続先IDや利用状態など検証対象の設定を変更した場合、以前の検証証跡は失効させて`unverified`へ戻す。Slack、Drive、GitHub、人物の実tenant帰属を確認する外部検証器はこの段階には含めず、未確認の参照を`ready`にしない。既存の未認証設定APIには、Project Profileのorganization、people、capabilities、created_by、success_criteriaを返さない。

Manaを`enabled`にした場合だけ、Slackが`enabled`で`primary_channel_id`を持つことを確認する。Manaが`disabled`または`deferred`ならSlack結線を要求しない。

## 関係者候補

`reconcile`は候補を自動登録しない。既存登録と照合し、未登録候補に次の選択肢を返す。

- `add`
- `add_as_external`
- `exclude`
- `defer`

候補の収集元は別のコネクターが担う。本機能は渡された証拠を候補として可視化するだけである。

## 操作

```bash
brainbase project create project.yml
brainbase project configure growin capability.yml
brainbase project inspect growin
brainbase project reconcile growin candidates.yml
```

`candidates.yml`は次の形式にする。

```yaml
people_candidates:
  - person_id: kuramoto
    evidence:
      - slack_channel_member
  - person_id: umeda
    evidence:
      - recent_meeting_participant
```

対応するAPIは次の通り。

| 操作 | API |
| --- | --- |
| 登録 | `POST /api/config/project-profiles` |
| 構成 | `PUT /api/config/project-profiles/:projectCode` |
| 点検 | `GET /api/config/project-profiles/:projectCode/inspect` |
| 照合 | `POST /api/config/project-profiles/:projectCode/reconcile` |
