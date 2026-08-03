import { mutatePersonalOs } from '../../src/ssot.js';

const [dataDir, id, delayText] = process.argv.slice(2);
if (!dataDir || !id) throw new Error('usage: ssot-writer <data-dir> <id> [delay-ms]');

await mutatePersonalOs(dataDir, async (current) => {
  await new Promise((resolve) => setTimeout(resolve, Number(delayText ?? 0)));
  return {
    ...current,
    personalKg: [...current.personalKg, { id, type: 'value', text: id }]
  };
});
