import { describe, expect, it, vi } from "vitest";
import {
  evaluateJudgmentAutonomy,
  extractHumanDecisionQuestion,
  renderJudgmentAutonomyContinuation,
  visibleAnswerBody
} from "../../scripts/codex-hooks/judgment-autonomy.mjs";
const base = {
  turn_id: "turn-1",
  request: "Brainbase hooks\u3092\u4EE3\u7406\u5224\u65AD\u3067\u304D\u308B\u3088\u3046\u306B\u5B9F\u88C5\u3057\u3066",
  project_code: "brainbase",
  selected_dag_ids: ["engineering.v1", "personal-judgment.v1"]
};
describe("Brainbase proxy judgment autonomy gate", () => {
  it("strips owner audit lines before reading the final answer", () => {
    const answer = "\u{1F9E0} \u5224\u65AD\u53C2\u7167: x\n\u{1F4DA} Brainbase\u672A\u53C2\u7167: y\n\u30C6\u30B9\u30C8\u3092\u5B9F\u884C\u3057\u307E\u3059\u304B\uFF1F";
    expect(visibleAnswerBody(answer)).toBe("\u30C6\u30B9\u30C8\u3092\u5B9F\u884C\u3057\u307E\u3059\u304B\uFF1F");
    expect(extractHumanDecisionQuestion(answer)).toBe("\u30C6\u30B9\u30C8\u3092\u5B9F\u884C\u3057\u307E\u3059\u304B\uFF1F");
  });
  it("blocks routine test approval and resumes the same Codex turn", async () => {
    const result = await evaluateJudgmentAutonomy({ ...base, final_answer: "\u30C6\u30B9\u30C8\u3092\u5B9F\u884C\u3057\u307E\u3059\u304B\uFF1F" });
    expect(result).toMatchObject({
      verdict: "continue",
      reason_code: "routine_reversible_work",
      source: "deterministic"
    });
    expect(renderJudgmentAutonomyContinuation(result)).toContain("\u540C\u3058\u30BF\u30FC\u30F3\u3092\u7D9A\u884C");
    expect(renderJudgmentAutonomyContinuation(result)).toContain("\u901A\u5E38\u5DE5\u7A0B\u3092\u305D\u306E\u307E\u307E\u5B9F\u884C");
  });
  it("uses the current Codex as the semantic resolver when no independent provider exists", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u8A3C\u8DE1\u53F0\u5E33\u3068\u4EE3\u7406\u5224\u65AD\u306E\u7E26\u5207\u308A\u306E\u3069\u3061\u3089\u3092\u5148\u306B\u3057\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "continue",
      reason_code: "semantic_judgment_required",
      source: "same_codex"
    });
    expect(renderJudgmentAutonomyContinuation(result)).toContain("\u904E\u53BBDecision");
    expect(renderJudgmentAutonomyContinuation(result)).toContain("OK / NG");
  });
  it("allows a clarification explicitly selected by the accepted Judgment Receipt", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      selected_dag_ids: ["clarification.v1"],
      final_answer: "\u3069\u3061\u3089\u306E\u5BFE\u8C61\u3092\u6307\u3057\u3066\u3044\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "human_required",
      reason_code: "resolver_selected_clarification"
    });
  });
  it("allows a human question for an external action boundary", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u3053\u306E\u5909\u66F4\u3092\u672C\u756A\u3078\u30C7\u30D7\u30ED\u30A4\u3057\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "human_required",
      reason_code: "irreversible_external_action"
    });
  });
  it.each([
    "\u672C\u756A\u74B0\u5883\u3067\u30C6\u30B9\u30C8\u3092\u5B9F\u884C\u3057\u307E\u3059\u304B\uFF1F",
    "\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F",
    "\u30E6\u30FC\u30B6\u30FC\u5168\u54E1\u306E\u6A29\u9650\u3092\u5909\u66F4\u3057\u307E\u3059\u304B\uFF1F",
    "\u500B\u4EBA\u60C5\u5831\u3092\u5916\u90E8API\u3078\u6E21\u3057\u3066\u3088\u3044\u3067\u3059\u304B\uFF1F",
    "\u9867\u5BA2\u306BSlack\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u9001\u308A\u307E\u3059\u304B\uFF1F",
    "PR\u3092\u4F5C\u6210\u3057\u307E\u3059\u304B\uFF1F"
  ])("fails closed for an unapproved boundary: %s", async (finalAnswer) => {
    const result = await evaluateJudgmentAutonomy({ ...base, final_answer: finalAnswer });
    expect(result).toMatchObject({
      verdict: "human_required",
      reason_code: "irreversible_external_action",
      source: "deterministic"
    });
  });
  it("does not ask again for a release action explicitly authorized by the task", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      request: "\u4FEE\u6B63\u3057\u3066PR\u4F5C\u6210\u304B\u3089\u672C\u756A\u5C55\u958B\u307E\u3067\u5B9F\u884C\u3057\u3066",
      final_answer: "PR\u3092\u4F5C\u6210\u3057\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "continue",
      reason_code: "semantic_judgment_required",
      source: "same_codex"
    });
  });
  it("does not ask again for an explicitly authorized production deployment", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      request: "\u4FEE\u6B63\u3057\u3066\u672C\u756A\u5C55\u958B\u307E\u3067\u5B9F\u884C\u3057\u3066",
      final_answer: "\u672C\u756A\u74B0\u5883\u3078\u30C7\u30D7\u30ED\u30A4\u3057\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "continue",
      reason_code: "semantic_judgment_required",
      source: "same_codex"
    });
  });
  it("keeps external message delivery human-required even when requested", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      request: "\u9867\u5BA2\u3078Slack\u3067\u9001\u3063\u3066",
      final_answer: "\u9867\u5BA2\u3078Slack\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u9001\u308A\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "human_required",
      reason_code: "irreversible_external_action"
    });
  });
  it("allows a human question when a secret or authority is missing", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u8A8D\u8A3C\u60C5\u5831\u3092\u6559\u3048\u3066\u304F\u3060\u3055\u3044\u3002"
    });
    expect(result).toMatchObject({
      verdict: "human_required",
      reason_code: "missing_authority_or_secret"
    });
  });
  it("routes an existing business-priority choice through Brainbase instead of escalating by keyword", async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u58F2\u4E0A\u3068\u5B89\u5168\u6027\u306E\u3069\u3061\u3089\u3092\u512A\u5148\u3057\u307E\u3059\u304B\uFF1F"
    });
    expect(result).toMatchObject({
      verdict: "continue",
      reason_code: "semantic_judgment_required",
      source: "same_codex"
    });
  });
  it("calls an independent resolver only for the semantic gray zone", async () => {
    const resolver = vi.fn(async (request) => ({
      schema_version: "brainbase-autonomy-resolver-decision-v1",
      case_id: request.case_id,
      verdict: "continue",
      reason_code: "centerpin_first",
      reason: "\u4EE3\u7406\u5224\u65AD\u306E\u7E26\u5207\u308A\u304C\u30BB\u30F3\u30BF\u30FC\u30D4\u30F3\u3092\u76F4\u63A5\u8A3C\u660E\u3059\u308B\u305F\u3081",
      basis: [{ entity_id: "dec_centerpin", application: "\u4EE3\u7406\u5224\u65AD\u3092\u5148\u884C\u3059\u308B" }],
      instruction_patch: {
        cancel: ["\u8A3C\u8DE1\u53F0\u5E33\u306E\u5148\u884C\u5B9F\u88C5"],
        do_next: ["\u4EE3\u7406\u5224\u65AD\u306E\u7E26\u5207\u308A\u3092\u5B9F\u88C5\u3059\u308B"],
        acceptance_criteria: ["\u4EBA\u9593\u3078\u78BA\u8A8D\u305B\u305A\u7D9A\u884C\u3059\u308B"]
      }
    }));
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u8A3C\u8DE1\u53F0\u5E33\u3068\u4EE3\u7406\u5224\u65AD\u306E\u7E26\u5207\u308A\u306E\u3069\u3061\u3089\u3092\u5148\u306B\u3057\u307E\u3059\u304B\uFF1F"
    }, resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      verdict: "continue",
      source: "independent_resolver",
      reason_code: "resolver_continue"
    });
  });
  it("rejects a resolver decision bound to another case", async () => {
    await expect(evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u8A3C\u8DE1\u53F0\u5E33\u3068\u4EE3\u7406\u5224\u65AD\u306E\u7E26\u5207\u308A\u306E\u3069\u3061\u3089\u3092\u5148\u306B\u3057\u307E\u3059\u304B\uFF1F"
    }, async () => ({
      schema_version: "brainbase-autonomy-resolver-decision-v1",
      case_id: "wrong",
      verdict: "continue",
      reason_code: "x",
      reason: "x",
      basis: [],
      instruction_patch: { cancel: [], do_next: ["x"], acceptance_criteria: ["x"] }
    }))).rejects.toThrow("judgment_autonomy_resolver_invalid");
  });
  it("rejects a resolver decision without a Brainbase basis", async () => {
    await expect(evaluateJudgmentAutonomy({
      ...base,
      final_answer: "\u8A3C\u8DE1\u53F0\u5E33\u3068\u4EE3\u7406\u5224\u65AD\u306E\u7E26\u5207\u308A\u306E\u3069\u3061\u3089\u3092\u5148\u306B\u3057\u307E\u3059\u304B\uFF1F"
    }, async (request) => ({
      schema_version: "brainbase-autonomy-resolver-decision-v1",
      case_id: request.case_id,
      verdict: "continue",
      reason_code: "x",
      reason: "x",
      basis: [],
      instruction_patch: { cancel: [], do_next: ["x"], acceptance_criteria: ["x"] }
    }))).rejects.toThrow("judgment_autonomy_resolver_invalid");
  });
  it("does not intercept ordinary completed prose", async () => {
    const result = await evaluateJudgmentAutonomy({ ...base, final_answer: "\u5B9F\u88C5\u3068\u30C6\u30B9\u30C8\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002" });
    expect(result).toMatchObject({
      verdict: "not_applicable",
      reason_code: "not_a_human_escalation"
    });
  });
});
