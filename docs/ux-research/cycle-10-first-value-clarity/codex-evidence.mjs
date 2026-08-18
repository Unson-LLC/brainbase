export function inspectCodexEvidence(stdout) {
  const events = String(stdout).split(/\r?\n/u).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const calls = events.filter((event) => event.type === 'item.completed')
    .map((event) => event.item)
    .filter((item) => item?.type === 'mcp_tool_call' && item.server === 'brainbase'
      && item.status === 'completed' && item.error == null && item.result != null);
  const answer = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')
    .map((event) => String(event.item.text ?? '')).at(-1) ?? '';
  const resultText = calls.flatMap((call) => call.result?.content ?? [])
    .filter((content) => content?.type === 'text').map((content) => String(content.text ?? '')).join('\n');
  const tools = new Set(calls.map((call) => call.tool));
  const requiredHeadings = ['覚えていたこと', 'つながったこと', '次にできること'];
  const headingPositions = requiredHeadings.map((heading) => answer.indexOf(heading));
  return {
    actualResolveUsed: tools.has('resolve_entity'),
    actualContextUsed: tools.has('get_context'),
    actualSearchUsed: tools.has('search'),
    usefulBodyPresent: ['Atlas導入', '田中', '判断基準', '未確認'].every((marker) => answer.includes(marker)),
    conciseStructurePresent: answer.trimStart().startsWith('## 覚えていたこと')
      && headingPositions.every((position) => position >= 0)
      && headingPositions.every((position, index) => index === 0 || position > headingPositions[index - 1]),
    technicalEvidenceInTools: /canonicalEntityId|(?:project|person|decision)-[a-z0-9]/u.test(resultText)
      && /relationPath|participates_in|governs/u.test(resultText),
    tableAbsent: !/^\s*\|.+\|\s*$/mu.test(answer),
    internalNarrationAbsent: !/(?:skill|スキル).*(?:読み|使)|リトライ|tool orchestration|ツールを呼び/u.test(answer),
    answer,
    toolCalls: calls.map((call) => ({ item_id: call.id, tool: call.tool }))
  };
}
