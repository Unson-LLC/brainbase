// 作成したタスクを確認
const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const TABLE_ID = 'ml7hpqcvv3v8dms';
let JWT_TOKEN = null;

async function signin() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/auth/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!response.ok) throw new Error(`Signin failed: ${response.status}`);
    const data = await response.json();
    JWT_TOKEN = data.token;
}

async function fetchTask(id) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${TABLE_ID}/records/${id}`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch task: ${response.status}`);
    return await response.json();
}

async function main() {
    await signin();
    const task = await fetchTask(25);
    console.log('Created task:', JSON.stringify(task, null, 2));
}

main().catch(console.error);
