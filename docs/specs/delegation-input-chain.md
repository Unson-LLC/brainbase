# Spec: 同じ送り元の委任入力列

Story: `docs/management/stories/active/story-delegation-input-chain.md`

- 信頼済みCodex App transcriptの既存session/turn/namespace/完全な包みの検証を維持する。
- 単一入力は従来どおり。複数入力は、先頭が一意なcreate_thread、残りがsend_message_to_thread、全件が同じ空でないsource_thread_idの場合だけ一つの入力列として扱う。
- 全promptを記録順に保持し、明示的な入力番号と追加指示の区切りを加える。先頭または最後だけを選ばず、モデルが追加指示による変更を解釈する。
- 同じturnの委任tool出力に不正な包み、空の送り元または空のpromptが含まれる場合、一部の制約だけを採用せず復旧全体を拒否する。
- 異なる送り元、複数create、作成前のsend、createを含まない複数sendは従来どおり復旧しない。別turnの指示を取り込まない。
- 復旧のoriginとroute_applicationは変更しない。既存episodeの契約は書き換えない。初回Stopより前の処理を監査済みと見なさない。
- 自動検証は正常な3入力列の保存、全制約と順序、拒否条件、単一入力・通常開始の回帰を含む。
