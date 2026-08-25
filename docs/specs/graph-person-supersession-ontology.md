# Graph人物supersession Ontology 1.1.0 Spec

## AC-001 Additive release

1.1.0は`previous_version: 1.0.0`、`compatibility.classification: backward_compatible`、`migration.required: false`を持ち、1.0.0のentity/relation/constraint/inference key集合をすべて包含する。SemVer上の変更種別はadditive minorとする。

## AC-002 Relation contract

`superseded_by`は次の契約を持つ。

```json
{
  "from": ["person"],
  "to": ["person"],
  "cardinality": "many_to_one",
  "lifecycle": "persistent",
  "provenance": "explicit"
}
```

`person -> person`はvalid、`person_alias -> person`と`person -> org`はinvalidでなければならない。

## AC-003 Publication integrity

release bytesのSHA-256がindexの`content_digest`と一致する。提案段階では1.0.0をcurrentのまま保持し、1.1.0にReceipt metadataを付けない。公開段階では既存publisherだけが署名Receipt、current、compatibility viewを一括更新する。

## AC-004 Production readback

公開後、本番version/current APIが1.1.0と同じdigest・署名状態を返し、Batch 1の`per_ -> per_ota_shi` / `superseded_by` Edgeについてunknown relationとendpoint violationが0件になる。全Graphの既存違反件数は別欄で実数を報告する。
