import { readFileSync } from 'node:fs';

const reportPath = process.argv[2];
const expectedTests = Number(process.argv[3]);
if (!reportPath || !Number.isInteger(expectedTests) || expectedTests < 1) {
  console.error('usage: node scripts/assert-node-test-tap.mjs <tap-file> <expected-tests>');
  process.exit(2);
}

const text = readFileSync(reportPath, 'utf8');

function count(name) {
  const matches = [...text.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
  if (matches.length === 0) {
    throw new Error(`TAP summary is missing # ${name}`);
  }
  return Number(matches.at(-1)[1]);
}

const summary = {
  tests: count('tests'),
  pass: count('pass'),
  fail: count('fail'),
  cancelled: count('cancelled'),
  skipped: count('skipped'),
  todo: count('todo'),
};
console.log(JSON.stringify(summary));

if (summary.tests !== expectedTests
  || summary.pass !== expectedTests
  || summary.fail !== 0
  || summary.cancelled !== 0
  || summary.skipped !== 0
  || summary.todo !== 0) {
  console.error(`expected ${expectedTests} pass and 0 skip; got ${JSON.stringify(summary)}`);
  process.exit(1);
}
