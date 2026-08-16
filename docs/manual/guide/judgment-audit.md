# Judgment Hostを登録して判断・参照証跡を確認する

BrainbaseのJudgment HostをCodexへ登録すると、1つのturnを3つのHookで追跡します。

1. `UserPromptSubmit` で判断episodeを開始する
2. `PostToolUse` で実際のBrainbase MCP呼び出しを順番に記録する
3. `Stop` で返答先頭の監査行を検査し、episodeを完了する

この機能はCodex向けの任意設定です。ローカルで動作し、Hosted Brainbase、secret、プロジェクトへの接続は必要ありません。

初回導入では、先にMCPの実動作を確認します。[10分で試す](/guide/quick-start)のチェックリストへ戻れば、現在地と次の確認を一枚で追えます。

## 表示の見方

知識参照が不要だったturnでは、返答の先頭が次のようになります。

```text
🧠 判断参照: 「この仕組みを説明して」を参照 → 質問として回答 ✓
📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓
```

- `🧠 判断参照` は、判断に使った実際のユーザー発言と対応方針を示します。
- `📚` は、実際に成功したBrainbase MCP呼び出し、または参照不要で0回だった事実を示します。
- `⚠️` は、参照元不明、tool error、空の結果、監査契約違反などを示します。
- 長い発言は1行へ短縮され、tokenやsecretに見える値は伏せられます。

「それでいい」の対象を会話から特定できない場合は、成功に見せません。

```text
⚠️ 判断参照: 「それでいい」の対象を特定できず → 確認質問
```

## 判断証跡と知識参照を分ける

`🧠 判断参照` は「どの依頼をどう扱ったか」の証跡であり、Brainbase MCPを呼んだ証拠ではありません。実呼び出しは、`PostToolUse` が記録した次の行で確認します。

| MCP tool | 表示 | 意味 |
| --- | --- | --- |
| `get_context` | `📚 Brainbase参照先:` | 参照先の決定 |
| `search` | `📚 Brainbase検索:` | 検索 |
| `search_personal_kg` | `📚 Brainbase取得:` | 取得 |

toolがerror、空、または不正な結果を返した場合は、対応する `⚠️` 行になります。参照が必須のturnでは、0回の表示で完了したことにはできません。

これらの表示は、ファイル書き込み、送信、公開、デプロイなどの許可や、依頼そのものの成功を証明しません。通常の権限と承認は別に必要です。

## Codexへ登録する

パッケージとしてインストールした場合は、追加される設定をプレビューします。

```bash
brainbase judgment:install --target codex --dry-run
```

リポジトリをcloneした場合は、先にビルドします。

```bash
npm run build
node dist/cli.js judgment:install --target codex --dry-run
```

確認した設定断片を新しいファイルへ保存する場合は、未作成の出力先を指定します。

```bash
brainbase judgment:install --target codex \
  --output /tmp/brainbase-judgment-hooks.json
```

出力された `UserPromptSubmit`、`PostToolUse`、`Stop` の3項目を確認し、`~/.codex/hooks.json` へBrainbaseの項目だけを統合します。コマンドは既存設定へ自動マージせず、既存ファイルも上書きしません。他のHookは残してください。

CodexからHookの信頼確認を求められた場合は、実行コマンドを確認したうえで承認し、新しいtaskを開きます。

## 登録結果を検証する

まず3つのHookとローカル正本をまとめて点検します。

```bash
brainbase doctor \
  --dir ~/.brainbase/personal-os \
  --judgment-hooks ~/.codex/hooks.json
```

`judgment_hooks.status` が `ready`、`events` が `UserPromptSubmit`、`PostToolUse`、`Stop` であることを確認します。

次に新しいCodex taskで、普通の質問と追従依頼を続けて入力します。

```text
この仕組みを説明して。
ではそのように進めて。
```

両方の返答先頭に監査行があり、2回目が直前の依頼を参照していれば判断episodeは動作しています。さらにBrainbase内の検索を依頼し、実際のtool呼び出しに対応する `📚 Brainbase検索:` などが表示されることを確認します。

## 保存と異常時の動作

初期receipt、tool event、最終監査行は `~/.brainbase/personal-os/judgment-journal/` にsessionとturn単位で保存されます。

- 同じ `tool_use_id` と同じ内容の再送は、同じeventとして扱う
- 同じ `tool_use_id` で内容が違う場合は、競合として失敗する
- journalが破損している場合は、新しいepisodeへ暗黙に置き換えない
- 対応するepisodeがない `Stop` は成功にしない
- 監査行が不足した最初の `Stop` は、1回だけ修復を要求する
- 修復後も不完全な場合は、`judgment_stop_repair_exhausted` で非0終了する

表示が出ない場合は、`doctor --judgment-hooks` の結果、3つすべてのHook、Hookの信頼状態、登録後に新しいtaskを開いたかを順に確認してください。
