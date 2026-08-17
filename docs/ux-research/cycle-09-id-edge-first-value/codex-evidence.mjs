export function inspectCodexEvidence(stdout) {
  const events = String(stdout)
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);

  const completedCalls = events
    .filter((event) => event.type === 'item.completed')
    .map((event) => event.item)
    .filter((item) => item?.type === 'mcp_tool_call'
      && item.server === 'brainbase'
      && item.status === 'completed'
      && item.error == null
      && item.result != null);
  const callsByTool = new Map(completedCalls.map((call) => [call.tool, call]));
  const answer = events
    .filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')
    .map((event) => String(event.item.text ?? ''))
    .at(-1) ?? '';
  const resultText = completedCalls
    .flatMap((call) => call.result?.content ?? [])
    .filter((content) => content?.type === 'text')
    .map((content) => String(content.text ?? ''))
    .join('\n');

  const resolve = callsByTool.get('resolve_entity');
  const context = callsByTool.get('get_context');
  const search = callsByTool.get('search');
  return {
    actualResolveUsed: Boolean(resolve),
    actualContextUsed: Boolean(context),
    actualSearchUsed: Boolean(search),
    usefulBodyPresent: ['Atlas導入', '田中', '判断基準', '未確認'].every((marker) => answer.includes(marker)),
    canonicalIdEvidencePresent: /canonicalEntityId|(?:project|person|decision)-[a-z0-9]/u.test(resultText)
      && /canonicalEntityId|(?:project|person|decision)-[a-z0-9]/u.test(answer),
    relationEvidencePresent: /relationPath|participates_in|governs/u.test(resultText)
      && /relationPath|participates_in|governs/u.test(answer),
    projectionBoundaryPresent: /recordClass/u.test(resultText)
      && /recordClass|正規エンティティ.*投影|投影.*正規エンティティ/u.test(answer),
    toolCalls: completedCalls.map((call) => ({ item_id: call.id, tool: call.tool }))
  };
}
