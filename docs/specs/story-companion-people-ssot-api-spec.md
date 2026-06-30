# story-companion-people-ssot-api

## Story

Mac CompanionのTask候補レビューで担当者を選ぶとき、候補はAIの抽出文字列やSpeakerラベルではなく、BrainbaseのGraph SSOTに登録されたpersonエンティティを正本として取得する。
正本に存在しない担当者は、Mac CompanionからGraph SSOTへpersonとして登録し、以後の担当者選択候補として同じAPIから取得できる。

## Invariants

- INV-people-ssot-1: `GET /api/companion/people?source=graph_ssot&type=person` はGraph SSOTのpersonエンティティだけを担当者候補として返す。
- INV-people-ssot-2: `Speaker 1` のような話者ラベルや、AI推定名だけの値は正本候補として返さない。
- INV-people-ssot-3: `/api/companion/people` は既存のnative companion APIと同じbearer/service/internal認証ガードを通す。
- INV-people-ssot-4: `POST /api/companion/people` はGraph SSOTのpersonを作成または更新し、アクセス可能なprojectへの`member_of` edgeも作る。

## API Contract

`GET /api/companion/people?source=graph_ssot&type=person`

Response:

```json
{
  "source": "graph_ssot",
  "type": "person",
  "count": 1,
  "people": [
    {
      "id": "person_yajima_tsuyoshi",
      "entity_id": "person_yajima_tsuyoshi",
      "person_id": "person_yajima_tsuyoshi",
      "display_name": "矢島剛",
      "name": "矢島剛",
      "aliases": ["矢島さん"],
      "email": "yajima@example.com",
      "org": "Hotel Client",
      "role": "",
      "status": "active",
      "source": "graph_ssot"
    }
  ]
}
```

`POST /api/companion/people`

Request:

```json
{
  "source": "graph_ssot",
  "type": "person",
  "name": "矢島剛",
  "aliases": ["矢島さん"]
}
```

Response:

```json
{
  "source": "graph_ssot",
  "type": "person",
  "person": {
    "id": "person_yajima_tsuyoshi",
    "entity_id": "person_yajima_tsuyoshi",
    "person_id": "person_yajima_tsuyoshi",
    "display_name": "矢島剛",
    "name": "矢島剛",
    "aliases": ["矢島さん"],
    "status": "active",
    "source": "graph_ssot"
  }
}
```

## Verification

- `npm test -- tests/server/routes/companion-approval-inbox.test.js`
