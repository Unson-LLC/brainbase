# Corrected actual-host trace

Surface: MCP Inspector 2.0.0 connected to repository build `bfaed02d72e643c6c5933b447371cc491d147089` through stdio.

Evaluator: Codex using 32 synthetic persona lenses from the frozen rotation manifest. The personas are structured review lenses, not human participants. They evaluated one shared actual-host walkthrough; this is not 32 independent human sessions.

## Onboarding completion

1. Opened `brainbase_onboarding_first_value` and confirmed all seven documented fields rendered in the actual host UI.
2. Started a run with one ready Drive source and one Gmail source still waiting for authorization.
3. Confirmed each successful result included `runId`, `nextAction.tool`, an instruction, and required IDs.
4. Ingested an inferred Decision candidate.
5. Tried direct approval and confirmed the error named both safe recovery choices: human-confirmed `edit` or `reject`.
6. Used `edit`, then recorded the first-value receipt.
7. Submitted `review=useful` while the host still retained the prior `answerHash` and `usedCanonicalIds` fields.
8. Confirmed the final result was `first_value_answer_reviewed` with `nextAction: null`.

## Ontology understanding

1. Opened and executed `get_ontology` in the actual host UI.
2. Confirmed the result began with `beginnerGuide.oneSentence`.
3. Confirmed the guide listed the five parts: types, relations, constraints, inference, and evolution.
4. Confirmed suggested next tools appeared before the immutable 1.0.0 contract.

## Evidence boundary

- Collected: actual host UI, DOM snapshots, screenshots, MCP request history, deterministic tests.
- Not collected: human participant observation, physical device, screen reader, independent persona timings.
