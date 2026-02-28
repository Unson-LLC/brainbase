import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot'
});

await client.connect();

const result = await client.query(`
  SELECT payload 
  FROM graph_entities 
  WHERE entity_type='contact' 
  LIMIT 3
`);

result.rows.forEach((row, i) => {
  console.log(`\n=== Contact ${i+1} ===`);
  console.log(JSON.stringify(row.payload, null, 2));
});

await client.end();
