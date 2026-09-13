# 俺なら返答

## Story

Codexが作業途中で佐藤さんへ不要な確認を返そうとしたとき、Brainbaseがその質問を引き取り、本人のPersonal KGにある過去判断と委任境界を使って同じturnの作業を続ける。

## 境界

```text
Codexの確認質問
       |
       v
状態確定前のHost判定 ---- 権限・秘密・不可逆操作 --------------------> 本人へ確認
       |
       | required_input_unavailable / owner_value_choice
       v
Personal KG検索
       |
       v
AIの意味判定 ---- ambiguous / no_answer / conflicting / stale / unavailable --> 本人へ一度だけ確認
       |
       | resolved（質問へ直接回答・適用可能・矛盾なし・鮮度あり）
       v
確認文を表示せず、同じCodexが根拠を適用して実行・検証を継続
```

- 初回依頼のKnowledge DAGとは別に、Stopが検出した質問文をPersonal KG検索へ渡す。
- Stopまで待たず、`brainbase_judgment_state_record`が確認待ちを確定する時点でもPersonal KGの事前検索と、検索結果に実在する証拠IDへ束縛された`resolved`判定を検証する。質問digestとの完全一致は、質問本文を取得できるStopで検証する。これにより、質問を一度表示してからStopが差し戻す二重表示を防ぐ。
- 質問文とSHA-256 digestを継続markerへ固定し、別の質問へのすり替えを防ぐ。定型・可逆な確認はKG不要、実装方式などの意味選択はKG必須と記録する。
- AIが検索結果の関連性、質問への直接回答性、今回への適用可能性、矛盾、鮮度を判定する。Hostは意味を推測せず、質問digest、検索→意味判定→実行の順序、status、証拠ID、権限境界だけを検証する。
- 検索結果が1件以上あることと、本人の回答が得られたことは別である。`resolved`だけを代理回答として使い、`ambiguous` / `no_answer` / `conflicting` / `stale` / `unavailable`は本人へ一度だけ確認する。
- Personal KGは既存の権限を広げない。元の依頼だけで決められる定型・可逆作業はKG不要で続ける。
- 権限不足、秘密不足、不可逆な外部影響、重要な金銭・契約、新しい本人価値判断は`waiting_human`にする。
- HostやPersonal KGが故障しても監査基盤の故障だけでCodexの診断操作を禁止しない。KG参照成功や許可を捏造しない。
- 継続は有限回で、実作業とreadbackがなければ完了にしない。
- 回答本文の引用、コードブロック、利用手順に含まれる質問例は、Codex自身が本人へ返す確認質問ではない。未指定の確認は回答末尾の実際の要求だけを判定する。

## 成功条件

1. 不要な確認は利用者へ再表示されず、「俺なら返答」として同一turnで処理される。
2. 継続markerに質問本文、digest、KG要否、必要時のPersonal KG query、有限なfallbackが残る。
3. 意味選択では、`search_personal_kg`の後に質問digestへ束縛された`brainbase_personal_kg_answer_record`を必須とし、`resolved`以外では自動回答しない。
4. 意味選択では、`resolved`判定より後に、その回答を反映した実作業または検証がなければ完了できない。
5. 人間専用の判断境界は自動回答しない。
6. Hook障害時も通常のCodex権限による診断を妨げない。
7. テスト手順や引用内の質問例だけでは「俺なら返答」を発火しない。
8. `required_input_unavailable`の状態記録はPersonal KG検索前には拒否されるが、無関係な検索結果だけでは拒否しない。質問へ直接答える`resolved`判定後だけ、質問ではなく実行継続へ戻される。
