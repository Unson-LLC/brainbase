---
name: brainbase-slackドラフトは同一チャンネル内で見つけにくく-thread-tsとdraft-idまで記録
description: Slackドラフトは同一チャンネル内で見つけにくく、thread_tsとdraft_idまで記録する
---

# brainbase-slackドラフトは同一チャンネル内で見つけにくく-thread-tsとdraft-idまで記録

## Trigger
- Use when this pattern appears: Slackドラフトは同一チャンネル内で見つけにくく、thread_tsとdraft_idまで記録する

## Steps
- 1. `slack_send_message_draft`実行後、tool resultの`draft_id` / `channel_id` / `channel_link`を記録する
- 2. スレッド宛なら送信時に指定した`thread_ts`も併記する
- 3. ユーザーには「どのドラフトか」を `宛先 + スレッド文脈 + draft_id + channel link` で返す
- 4. 同一チャンネル内に複数ドラフトがある場合は、該当スレッドを開いて返信欄を見るよう明記する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/slackドラフトは同一チャンネル内で見つけにくく-thread-tsとdraft-idまで記録

## Source
- Promoted from explicit_learn / success