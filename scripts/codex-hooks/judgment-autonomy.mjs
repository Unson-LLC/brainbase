import { createHash } from "node:crypto";
const AUDIT_LINE = /^(?:🧠 |📚 Brainbase|⚠️ (?:Brainbase|判断))/u;
const QUESTION_END = /(?:[?？]|(?:選んで|教えて|確認して|承認して)(?:ください|下さい)?[。.]?)$/u;
const HUMAN_QUESTION_PATTERNS = [
  /(?:しても|して|進めても|実行しても|変更しても|修正しても|作成しても)(?:よい|いい|良い)ですか/u,
  /(?:しますか|進めますか|実行しますか|変更しますか|修正しますか|作成しますか)/u,
  /(?:どちら|どれ|何を|どう)(?:に|を|で)?(?:します|進めます|選びます|すべき)か/u,
  /(?:どちら|どの|何の).+(?:ですか|ますか)/u,
  /(?:送って|渡して|共有して)(?:も)?(?:よい|いい|良い)ですか/u,
  /(?:選んで|教えて|確認して|承認して)(?:ください|下さい)/u,
  /(?:送信|送付|公開|投稿|デプロイ|マージ|merge|push|publish|作成|削除|破棄|変更|共有)(?:しても|して)?(?:よい|いい|良い)ですか/iu,
  /(?:送ります|公開します|投稿します|デプロイします|マージします|作成します|削除します|破棄します|変更します|共有します|渡します)か/iu,
  /(?:should i|would you like|do you want|which (?:option|one)|please (?:choose|confirm|approve)|can i)\b/iu
];
const EXTERNAL_ACTION_TERMS = [
  "\u5916\u90E8\u9001\u4FE1",
  "\u30E1\u30FC\u30EB\u9001\u4FE1",
  "\u9001\u4FE1\u3057\u307E\u3059\u304B",
  "\u516C\u958B\u3057\u307E\u3059\u304B",
  "\u6295\u7A3F\u3057\u307E\u3059\u304B",
  "\u672C\u756A\u30C7\u30D7\u30ED\u30A4",
  "\u672C\u756A\u3078\u30C7\u30D7\u30ED\u30A4",
  "pr\u3092\u4F5C\u6210",
  "pull request",
  "issue\u3092\u4F5C\u6210",
  "github issue",
  "slack",
  "\u30E1\u30FC\u30EB",
  "webhook",
  "\u5916\u90E8api",
  "\u5916\u90E8\u30B5\u30FC\u30D3\u30B9",
  "\u5171\u6709\u3057\u307E\u3059\u304B",
  "\u6E21\u3057\u3066\u3088\u3044",
  "merge\u3057\u307E\u3059\u304B",
  "push\u3057\u307E\u3059\u304B",
  "publish",
  "send",
  "deploy",
  "merge",
  "push",
  "post"
];
const DESTRUCTIVE_TERMS = [
  "\u672C\u756A\u30C7\u30FC\u30BF\u3092\u524A\u9664",
  "\u672C\u756A\u524A\u9664",
  "\u672C\u756ADB",
  "drop table",
  "truncate",
  "production delete",
  "\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9\u3092\u524A\u9664",
  "db\u3092\u524A\u9664",
  "\u524A\u9664\u3057\u307E\u3059\u304B",
  "\u6D88\u53BB\u3057\u307E\u3059\u304B",
  "\u4E0D\u53EF\u9006",
  "\u53D6\u308A\u6D88\u305B\u306A\u3044",
  "\u7834\u68C4",
  "\u5168\u524A\u9664",
  "\u4E0A\u66F8\u304D"
];
const PRODUCTION_ACTION_TERMS = [
  "\u672C\u756A\u74B0\u5883",
  "\u672C\u756A\u3067",
  "\u672C\u756A\u3078",
  "production",
  "prod",
  "\u5546\u7528\u74B0\u5883",
  "\u9867\u5BA2\u74B0\u5883"
];
const AUTHORITY_CHANGE_TERMS = [
  "\u6A29\u9650\u3092\u5909\u66F4",
  "\u6A29\u9650\u4ED8\u4E0E",
  "\u7BA1\u7406\u8005\u6A29\u9650",
  "owner\u6A29\u9650",
  "role\u3092\u5909\u66F4",
  "rbac",
  "\u30A2\u30AF\u30BB\u30B9\u6A29",
  "permission change",
  "grant access",
  "admin role"
];
const SENSITIVE_DATA_TERMS = [
  "\u500B\u4EBA\u60C5\u5831",
  "\u6A5F\u5BC6\u60C5\u5831",
  "\u9867\u5BA2\u60C5\u5831",
  "\u533B\u7642\u60C5\u5831",
  "\u8A8D\u8A3C\u60C5\u5831\u3092\u9001",
  "\u79D8\u5BC6\u60C5\u5831\u3092\u9001",
  "personal data",
  "pii",
  "confidential",
  "health data",
  "credential\u3092\u9001"
];
const AUTHORITY_TERMS = [
  "\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093",
  "\u6A29\u9650\u4E0D\u8DB3",
  "\u8A8D\u8A3C\u60C5\u5831",
  "\u79D8\u5BC6\u60C5\u5831",
  "api key",
  "credential",
  "permission denied",
  "access denied",
  "secret\u304C\u5FC5\u8981",
  "\u30C8\u30FC\u30AF\u30F3\u304C\u5FC5\u8981"
];
const MATERIAL_COMMITMENT_TERMS = [
  "\u8CFC\u5165",
  "\u767A\u6CE8",
  "\u652F\u6255\u3044",
  "\u6C7A\u6E08",
  "\u5951\u7D04\u7DE0\u7D50",
  "\u6CD5\u7684",
  "\u91D1\u984D",
  "\u8AB2\u91D1",
  "purchase",
  "payment",
  "sign the contract",
  "legal commitment"
];
const EXPLICIT_NEW_OWNER_VALUE_TERMS = [
  "\u65E2\u5B58\u306E\u5224\u65AD\u57FA\u6E96\u3067\u306F\u6C7A\u3081\u3089\u308C\u306A\u3044",
  "brainbase\u306B\u5224\u65AD\u57FA\u6E96\u304C\u306A\u3044",
  "\u65B0\u3057\u3044\u4FA1\u5024\u5224\u65AD\u3092\u6C7A\u3081\u308B\u5FC5\u8981",
  "\u3053\u308C\u307E\u3067\u6C7A\u3081\u3066\u3044\u306A\u3044\u65B9\u91DD",
  "no existing decision principle",
  "new owner value choice is required"
];
const ROUTINE_TERMS = [
  "\u30C6\u30B9\u30C8",
  "lint",
  "format",
  "\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8",
  "build",
  "\u30D3\u30EB\u30C9",
  "\u578B\u30C1\u30A7\u30C3\u30AF",
  "typecheck",
  "\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u3080",
  "\u30D5\u30A1\u30A4\u30EB\u3092\u78BA\u8A8D",
  "\u8ABF\u67FB",
  "\u691C\u7D22",
  "\u30ED\u30B0\u3092\u78BA\u8A8D",
  "\u5DEE\u5206\u3092\u78BA\u8A8D",
  "dry-run",
  "\u30ED\u30FC\u30AB\u30EB",
  "\u53EF\u9006",
  "\u5C0F\u3055\u306A\u4FEE\u6B63",
  "\u7DE8\u96C6",
  "\u5B9F\u88C5\u65B9\u6CD5",
  "\u30EA\u30D5\u30A1\u30AF\u30BF",
  "read the file",
  "run the test",
  "run tests",
  "inspect",
  "search",
  "local change"
];
const RELEASE_PIPELINE_TERMS = [
  "pr\u3092\u4F5C\u6210",
  "pull request",
  "merge",
  "\u30DE\u30FC\u30B8",
  "push",
  "publish",
  "\u516C\u958B",
  "deploy",
  "\u30C7\u30D7\u30ED\u30A4",
  "\u672C\u756A\u5C55\u958B",
  "\u672C\u756A\u53CD\u6620",
  "release",
  "\u30EA\u30EA\u30FC\u30B9"
];
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON only supports finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("canonical JSON only supports JSON values");
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function containsAny(text, terms) {
  const normalized = text.toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term.toLocaleLowerCase()));
}
function requestAuthorizesExternalAction(request, question) {
  if (containsAny(question, RELEASE_PIPELINE_TERMS)) {
    return containsAny(request, RELEASE_PIPELINE_TERMS);
  }
  return false;
}
function visibleAnswerBody(answer) {
  const lines = answer.replaceAll("\r\n", "\n").split("\n");
  while (lines.length > 0 && (lines[0].trim() === "" || AUDIT_LINE.test(lines[0]))) lines.shift();
  return lines.join("\n").trim();
}
function extractHumanDecisionQuestion(answer) {
  const body = visibleAnswerBody(answer);
  if (!body) return null;
  const paragraphs = body.split(/\n\s*\n/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const candidate = paragraphs.at(-1) ?? body;
  const lines = candidate.split("\n").map((line) => line.trim()).filter(Boolean);
  const question = lines.slice(-3).join(" ").slice(-1200).trim();
  if (!question || !QUESTION_END.test(question)) return null;
  return HUMAN_QUESTION_PATTERNS.some((pattern) => pattern.test(question)) ? question : null;
}
function continuationPatch(question, semantic) {
  return {
    cancel: [`\u4EBA\u9593\u3078\u306E\u78BA\u8A8D\u8CEA\u554F: ${question}`],
    do_next: semantic ? [
      "Brainbase MCP\u304B\u3089\u4ECA\u56DE\u306E\u76EE\u7684\u3001\u9069\u7528\u53EF\u80FD\u306A\u5224\u65AD\u57FA\u6E96\u3001\u904E\u53BBDecision\u3001\u59D4\u4EFB\u5883\u754C\u3092\u53D6\u5F97\u3059\u308B",
      "\u5019\u88DC\u3092\u6BD4\u8F03\u3057\u3001\u65E2\u5B58\u306E\u4EBA\u9593\u7531\u6765\u306E\u57FA\u6E96\u3092\u4ECA\u56DE\u306E\u5177\u4F53\u7684\u72B6\u6CC1\u3078\u9069\u7528\u3057\u3066OK / NG / \u6761\u4EF6\u4ED8\u304DOK\u3092\u6C7A\u3081\u308B",
      "NG\u306A\u3089\u7406\u7531\u3060\u3051\u3067\u6B62\u3081\u305A\u3001\u4EE3\u66FF\u884C\u52D5\u3068\u5B8C\u4E86\u6761\u4EF6\u3092\u4F5C\u696D\u8A08\u753B\u3078\u53CD\u6620\u3059\u308B",
      "\u5B89\u5168\u304B\u3064\u59D4\u4EFB\u7BC4\u56F2\u5185\u306A\u3089\u540C\u3058Codex\u30BF\u30FC\u30F3\u3067\u8ABF\u67FB\u30FB\u5B9F\u88C5\u30FB\u691C\u8A3C\u3092\u7D9A\u884C\u3059\u308B"
    ] : [
      "\u8CEA\u554F\u5BFE\u8C61\u306E\u901A\u5E38\u5DE5\u7A0B\u3092\u305D\u306E\u307E\u307E\u5B9F\u884C\u3059\u308B",
      "\u7D50\u679C\u3092\u691C\u8A3C\u3057\u3001\u5931\u6557\u6642\u306F\u5B89\u5168\u306A\u4EE3\u66FF\u624B\u6BB5\u3092\u8A66\u3059",
      "\u540C\u3058Codex\u30BF\u30FC\u30F3\u3067\u5B8C\u4E86\u307E\u3067\u7D9A\u884C\u3059\u308B"
    ],
    acceptance_criteria: [
      "\u4EBA\u9593\u3078\u540C\u3058\u78BA\u8A8D\u3092\u518D\u9001\u3057\u306A\u3044",
      "\u4E0D\u53EF\u9006\u306A\u5916\u90E8\u64CD\u4F5C\u3001\u5B9F\u8A3C\u6E08\u307F\u306E\u6A29\u9650\u4E0D\u8DB3\u3001\u65E2\u5B58\u57FA\u6E96\u304B\u3089\u6C7A\u3081\u3089\u308C\u306A\u3044\u65B0\u3057\u3044\u4FA1\u5024\u5224\u65AD\u3060\u3051\u3092\u518D\u30A8\u30B9\u30AB\u30EC\u30FC\u30B7\u30E7\u30F3\u3059\u308B",
      "\u6700\u7D42\u56DE\u7B54\u306F\u65E2\u5B58\u306EBrainbase audit_contract\u3082\u6E80\u305F\u3059"
    ]
  };
}
function resolverRequest(context, question, caseId) {
  return {
    schema_version: "brainbase-autonomy-resolver-request-v1",
    case_id: caseId,
    turn_id: context.turn_id,
    task_request: context.request,
    proposed_human_question: question,
    ...context.project_code ? { project_code: context.project_code } : {},
    selected_dag_ids: [...context.selected_dag_ids],
    policy: {
      default_behavior: "continue",
      complexity_behavior: "decompose_and_continue",
      human_only: [
        "irreversible_external_action",
        "missing_authority_or_secret",
        "material_commitment",
        "new_owner_value_choice"
      ]
    }
  };
}
function validateResolverDecision(decision, caseId) {
  if (decision?.schema_version !== "brainbase-autonomy-resolver-decision-v1" || decision.case_id !== caseId || !["continue", "human_required"].includes(decision.verdict) || typeof decision.reason_code !== "string" || !decision.reason_code.trim() || typeof decision.reason !== "string" || !decision.reason.trim() || !Array.isArray(decision.basis) || decision.basis.length === 0 || !decision.basis.every((entry) => entry && typeof entry.entity_id === "string" && entry.entity_id.trim().length > 0 && typeof entry.application === "string" && entry.application.trim().length > 0)) {
    throw new Error("judgment_autonomy_resolver_invalid");
  }
  if (decision.verdict === "continue") {
    const patch = decision.instruction_patch;
    if (!patch || !Array.isArray(patch.cancel) || !Array.isArray(patch.do_next) || patch.do_next.length === 0 || !Array.isArray(patch.acceptance_criteria) || patch.acceptance_criteria.length === 0 || ![...patch.cancel, ...patch.do_next, ...patch.acceptance_criteria].every((item) => typeof item === "string" && item.trim().length > 0)) {
      throw new Error("judgment_autonomy_resolver_instruction_missing");
    }
    const delegatedInstructions = [...patch.cancel, ...patch.do_next, ...patch.acceptance_criteria].join(" ");
    if (containsAny(delegatedInstructions, EXTERNAL_ACTION_TERMS) || containsAny(delegatedInstructions, DESTRUCTIVE_TERMS) || containsAny(delegatedInstructions, MATERIAL_COMMITMENT_TERMS)) {
      throw new Error("judgment_autonomy_resolver_authority_expansion");
    }
  }
  if (decision.verdict === "human_required" && (typeof decision.human_question !== "string" || !decision.human_question.trim())) {
    throw new Error("judgment_autonomy_resolver_human_question_missing");
  }
  return decision;
}
async function evaluateJudgmentAutonomy(context, resolver) {
  const question = extractHumanDecisionQuestion(context.final_answer);
  const caseId = sha256(canonicalJson({
    turn_id: context.turn_id,
    request: context.request,
    question,
    project_code: context.project_code ?? null,
    selected_dag_ids: [...context.selected_dag_ids]
  }));
  if (!question) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "not_applicable",
      reason_code: "not_a_human_escalation",
      reason: "The final answer does not request a human decision or approval.",
      question: null,
      source: "deterministic",
      instruction_patch: null,
      resolver_decision: null
    };
  }
  if (context.selected_dag_ids.includes("clarification.v1")) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "human_required",
      reason_code: "resolver_selected_clarification",
      reason: "The accepted Judgment Receipt explicitly selected a missing referent clarification.",
      question,
      source: "deterministic",
      instruction_patch: null,
      resolver_decision: null
    };
  }
  if (containsAny(question, AUTHORITY_TERMS)) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "human_required",
      reason_code: "missing_authority_or_secret",
      reason: "The agent reports a missing authority or secret that the worker cannot invent.",
      question,
      source: "deterministic",
      instruction_patch: null,
      resolver_decision: null
    };
  }
  if (containsAny(question, MATERIAL_COMMITMENT_TERMS)) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "human_required",
      reason_code: "material_commitment",
      reason: "The requested decision creates a material financial, legal, or contractual commitment.",
      question,
      source: "deterministic",
      instruction_patch: null,
      resolver_decision: null
    };
  }
  const destructive = containsAny(question, DESTRUCTIVE_TERMS);
  const production = containsAny(question, PRODUCTION_ACTION_TERMS);
  const authorityChange = containsAny(question, AUTHORITY_CHANGE_TERMS);
  const sensitiveData = containsAny(question, SENSITIVE_DATA_TERMS);
  const externalAction = containsAny(question, EXTERNAL_ACTION_TERMS);
  const authorizedReleaseAction = requestAuthorizesExternalAction(context.request, question);
  if (destructive || authorityChange || sensitiveData || (production || externalAction) && !authorizedReleaseAction) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "human_required",
      reason_code: "irreversible_external_action",
      reason: "The requested decision crosses a production, destructive, authority, sensitive-data, or unapproved external-action boundary.",
      question,
      source: "deterministic",
      instruction_patch: null,
      resolver_decision: null
    };
  }
  if (containsAny(question, EXPLICIT_NEW_OWNER_VALUE_TERMS)) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "human_required",
      reason_code: "owner_value_choice",
      reason: "The existing packet does not establish a reusable owner value choice.",
      question,
      source: "deterministic",
      instruction_patch: null,
      resolver_decision: null
    };
  }
  if (containsAny(question, ROUTINE_TERMS)) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "continue",
      reason_code: "routine_reversible_work",
      reason: "The question concerns routine, reversible work already implied by the task.",
      question,
      source: "deterministic",
      instruction_patch: continuationPatch(question, false),
      resolver_decision: null
    };
  }
  if (!resolver) {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "continue",
      reason_code: "semantic_judgment_required",
      reason: "The case requires semantic application of Brainbase judgments; the current Codex worker must resolve it before escalating.",
      question,
      source: "same_codex",
      instruction_patch: continuationPatch(question, true),
      resolver_decision: null
    };
  }
  const decision = validateResolverDecision(await resolver(resolverRequest(context, question, caseId)), caseId);
  if (decision.verdict === "human_required") {
    return {
      schema_version: "brainbase-autonomy-evaluation-v1",
      case_id: caseId,
      verdict: "human_required",
      reason_code: "resolver_human_required",
      reason: decision.reason,
      question: decision.human_question ?? question,
      source: "independent_resolver",
      instruction_patch: null,
      resolver_decision: decision
    };
  }
  return {
    schema_version: "brainbase-autonomy-evaluation-v1",
    case_id: caseId,
    verdict: "continue",
    reason_code: "resolver_continue",
    reason: decision.reason,
    question,
    source: "independent_resolver",
    instruction_patch: decision.instruction_patch ?? null,
    resolver_decision: decision
  };
}
function renderJudgmentAutonomyContinuation(evaluation) {
  if (evaluation.verdict !== "continue" || !evaluation.instruction_patch) {
    throw new TypeError("Only continue evaluations can be rendered as a continuation");
  }
  const patch = evaluation.instruction_patch;
  return [
    "\u3053\u306E\u78BA\u8A8D\u8CEA\u554F\u306F\u4EBA\u9593\u3078\u9001\u3089\u305A\u3001Brainbase\u306E\u4EE3\u7406\u5224\u65AD\u30EB\u30FC\u30D7\u3068\u3057\u3066\u540C\u3058\u30BF\u30FC\u30F3\u3092\u7D9A\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    `\u5224\u5B9A\u7406\u7531: ${evaluation.reason}`,
    `\u4E2D\u6B62: ${patch.cancel.join(" / ")}`,
    `\u6B21\u306B\u884C\u3046\u3053\u3068:
${patch.do_next.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    `\u5B8C\u4E86\u6761\u4EF6:
${patch.acceptance_criteria.map((item) => `- ${item}`).join("\n")}`
  ].join("\n");
}
export {
  evaluateJudgmentAutonomy,
  extractHumanDecisionQuestion,
  renderJudgmentAutonomyContinuation,
  visibleAnswerBody
};
