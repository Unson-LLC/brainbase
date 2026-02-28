---
name: form-submission-recovery
description: フォーム送信タスクが処理されない場合のリカバリー手順。BatchJobステータス修正、キューネーム不一致解決、BullMQ重複排除回避。
---

# フォーム送信リカバリースキル

フォーム送信タスクが処理されない場合のリカバリー手順。

## 環境設定

実行前に対象環境の環境変数ファイルを指定してください：

```bash
# 本番環境の場合
export ENV_FILE=.env.vercel-prod

# プレビュー環境の場合
export ENV_FILE=.env.vercel-preview
```

以降のコマンドでは `$ENV_FILE` を使用します。

## 使用タイミング

- フォーム送信タスクがPENDING/PROCESSINGから進まない
- 「プロジェクトが既に完了しているため、フォーム送信をスキップしました」エラー
- キューにジョブがあるのにWorkerが処理しない

## リカバリー手順

### 1. 状況確認

```bash
# BatchJobのステータス確認
source $ENV_FILE && DATABASE_URL="$DATABASE_URL" npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const batchJob = await prisma.batchJob.findUnique({
    where: { id: 'BATCH_JOB_ID' },
    select: { id: true, status: true },
  });
  console.log('BatchJob status:', batchJob?.status);

  const stats = await prisma.deliveryTask.groupBy({
    by: ['status'],
    where: { batchJobId: 'BATCH_JOB_ID' },
    _count: { status: true },
  });
  stats.forEach(s => console.log(s.status + ':', s._count.status));

  await prisma.\$disconnect();
}
main();
"

# キューの状態確認（正しいキュー名: form-submission）
source $ENV_FILE && REDIS_URL="$REDIS_URL" npx tsx tools/check-queue-status.ts
```

### 2. よくある原因と対処

#### 原因A: BatchJobがCOMPLETEDになっている

**エラーメッセージ**: 「プロジェクトが既に完了しているため、フォーム送信をスキップしました」

**対処**: BatchJobをPROCESSINGに戻す

#### 原因B: キューネームの不一致

**確認方法**:

```bash
# 両方のキューを確認
source $ENV_FILE && REDIS_URL="$REDIS_URL" npx tsx -e "
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const redis = new IORedis(process.env.REDIS_URL);

async function main() {
  const q1 = new Queue('form-submission', { connection: redis });
  const q2 = new Queue('formSubmission', { connection: redis });

  console.log('form-submission:', await q1.getJobCounts('waiting', 'active'));
  console.log('formSubmission:', await q2.getJobCounts('waiting', 'active'));

  await q1.close(); await q2.close();
  redis.disconnect();
}
main();
"
```

**正しいキュー名**: `form-submission`（Workerが監視するキュー）

#### 原因C: BullMQの重複排除

同じjobIdで再追加してもスキップされる。新しいjobIdで追加する必要がある。

### 3. リカバリー実行

```bash
source $ENV_FILE && DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" npx tsx -e "
const { PrismaClient, DeliveryTaskStatus, BatchJobStatus } = require('@prisma/client');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const redis = new IORedis(process.env.REDIS_URL);
const formQueue = new Queue('form-submission', { connection: redis });

const BATCH_JOB_ID = '対象のBatchJobID';

async function main() {
  console.log('=== リカバリー開始 ===');

  // 1. BatchJobをPROCESSINGに変更
  await prisma.batchJob.update({
    where: { id: BATCH_JOB_ID },
    data: { status: BatchJobStatus.PROCESSING },
  });
  console.log('BatchJobをPROCESSINGに変更');

  // 2. 古いジョブを削除（BullMQの重複排除を回避）
  const oldKeys = await redis.keys('bull:formSubmission:*');
  if (oldKeys.length > 0) {
    await redis.del(...oldKeys);
    console.log('古いジョブ削除:', oldKeys.length);
  }

  // 3. PENDING/PROCESSING/FAILEDタスクを取得
  const tasks = await prisma.deliveryTask.findMany({
    where: {
      batchJobId: BATCH_JOB_ID,
      status: { in: [DeliveryTaskStatus.PENDING, DeliveryTaskStatus.PROCESSING, DeliveryTaskStatus.FAILED] },
    },
    include: {
      company: { select: { id: true, url: true } },
      batchJob: { include: { sendingGroup: { select: { userId: true } } } },
    },
  });

  console.log('対象タスク:', tasks.length);

  if (tasks.length === 0) {
    console.log('対象なし');
    await prisma.\$disconnect();
    await formQueue.close();
    redis.disconnect();
    return;
  }

  // 4. PENDINGにリセット
  await prisma.deliveryTask.updateMany({
    where: { id: { in: tasks.map(t => t.id) } },
    data: {
      status: DeliveryTaskStatus.PENDING,
      errorMessage: null,
      startedAt: null,
      submissionStatus: null,
    },
  });
  console.log('PENDINGにリセット:', tasks.length);

  // 5. form-submissionキューに追加（新しいjobId）
  const userId = tasks[0]?.batchJob?.sendingGroup?.userId || '';
  const timestamp = Date.now();
  let count = 0;

  for (const task of tasks) {
    const targetUrl = task.formUrl || task.company?.url || '';
    await formQueue.add('form-submission', {
      deliveryTaskId: task.id,
      companyId: task.companyId,
      targetUrl,
      userId,
    }, {
      jobId: 'recover-' + timestamp + '-' + task.id,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    count++;
  }

  console.log('form-submissionキューに追加:', count);
  console.log('=== 完了 ===');

  await prisma.\$disconnect();
  await formQueue.close();
  redis.disconnect();
}

main();
"
```

### 4. 処理確認

```bash
# 30秒後に状況確認
sleep 30 && source $ENV_FILE && REDIS_URL="$REDIS_URL" npx tsx tools/check-queue-status.ts
```

## チェックリスト

- [ ] BatchJobのステータスがPROCESSINGになっているか
- [ ] ジョブが`form-submission`キューに追加されているか
- [ ] 新しいjobIdで追加されているか（重複排除回避）
- [ ] Workerがジョブを処理しているか（Active > 0）

## 注意事項

- Workerは`form-submission`キューを監視（`formSubmission`ではない）
- BullMQは同じjobIdで再追加してもスキップする
- `removeOnComplete: true`の場合、完了したジョブは自動削除される
