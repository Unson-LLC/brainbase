import { pathToFileURL } from 'node:url';

export function checkPrBody(body, author) {
  if (['dependabot[bot]', 'github-actions[bot]'].includes(author)) {
    return { ok: true, message: 'Brainbase: bot exemption.' };
  }
  for (const line of (body ?? '').split(/\r?\n/)) {
    const match = /^[ \t]*brainbase[ \t]*:[ \t]*(.*)$/i.exec(line.trimEnd());
    if (!match) continue;
    const value = match[1];
    const reason = /^none[\t ]*\(([^()]*)\)$/i.exec(value);
    const trimmedReason = reason?.[1].trim();
    if ((trimmedReason && !/^<[^>]*>$/.test(trimmedReason) &&
         !/^(?:TBD|TODO|XXX|N\/A|-)$/i.test(trimmedReason)) ||
        (/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value) &&
         !/^(?:TBD|TODO|XXX|N\/A|none)$/i.test(value))) {
      return { ok: true, message: 'Brainbase: valid task line.' };
    }
  }
  return { ok: false, message: 'Add Brainbase: RQ-125 or Brainbase: none (docs only) on its own line.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkPrBody(process.env.PR_BODY, process.env.PR_AUTHOR);
  if (result.ok) console.log(result.message);
  else console.error(result.message);
  process.exitCode = result.ok ? 0 : 1;
}
