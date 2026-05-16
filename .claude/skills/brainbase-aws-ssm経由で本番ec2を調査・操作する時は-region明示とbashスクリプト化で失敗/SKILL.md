---
name: brainbase-aws-ssm経由で本番ec2を調査・操作する時は-region明示とbashスクリプト化で失敗
description: AWS SSM経由で本番EC2を調査・操作する時は、region明示とbashスクリプト化で失敗を避ける
---

# brainbase-aws-ssm経由で本番ec2を調査・操作する時は-region明示とbashスクリプト化で失敗

## Trigger
- Use when this pattern appears: AWS SSM経由で本番EC2を調査・操作する時は、region明示とbashスクリプト化で失敗を避ける

## Steps
- 1. EC2状態確認: `aws --profile ncom --region ap-northeast-1 ec2 describe-instances --instance-ids <id>`
- 2. SSM疎通確認: `aws --profile ncom --region ap-northeast-1 ssm describe-instance-information --filters Key=InstanceIds,Values=<id>`
- 3. `/tmp/script.sh` を作成し `SCRIPT_B64=$(base64 < /tmp/script.sh | tr -d '\n')`
- 4. `ssm send-command --parameters "commands=[\"echo $SCRIPT_B64 | base64 -d > /tmp/q.sh && bash /tmp/q.sh && rm /tmp/q.sh\"]"`
- 5. DB確認で `psql` が無い場合は、アプリ配下で `sudo -u ubuntu node -e` + `@prisma/client` を使う

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/aws-ssm経由で本番ec2を調査・操作する時は-region明示とbashスクリプト化で失敗

## Source
- Promoted from explicit_learn / success