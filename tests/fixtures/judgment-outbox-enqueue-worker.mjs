import { enqueueJudgmentKnowledgeEvent } from '../../src/judgment-event-outbox.ts';

const directory = process.argv[2];
const event = JSON.parse(process.argv[3]);

try {
  const result = enqueueJudgmentKnowledgeEvent(event, { directory });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
