// Node.js 18+ のネイティブ fetch を使用

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const NOCODB_API_TOKEN = process.env.NOCODB_API_TOKEN;
const PROJECT_ID = 'brainbase';

async function createWorkflowHistoryTable() {
  const url = `${NOCODB_BASE_URL}/api/v1/db/meta/projects/${PROJECT_ID}/tables`;

  const payload = {
    table_name: 'Manaワークフロー履歴',
    title: 'Manaワークフロー履歴',
    columns: [
      { column_name: 'id', title: 'ID', uidt: 'ID', pk: true, ai: true },
      { column_name: 'workflow_id', title: 'workflow_id', uidt: 'SingleLineText', rqd: true },
      { column_name: 'execution_date', title: 'execution_date', uidt: 'Date', rqd: true },
      { column_name: 'success_count', title: 'success_count', uidt: 'Number', rqd: true },
      { column_name: 'failure_count', title: 'failure_count', uidt: 'Number', rqd: true },
      { column_name: 'success_rate', title: 'success_rate', uidt: 'Number', rqd: true },
      { column_name: 'error_details', title: 'error_details', uidt: 'LongText', rqd: false },
      { column_name: 'created_at', title: 'created_at', uidt: 'DateTime', rqd: true }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xc-token': NOCODB_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`NocoDB API failed: ${response.status}`);
  }

  const result = await response.json();
  console.log('Table created:', result);

  // UNIQUE 制約追加: workflow_id + execution_date
  // （NocoDB v1 API でのインデックス作成は別途調査が必要）
}

createWorkflowHistoryTable().catch(console.error);
