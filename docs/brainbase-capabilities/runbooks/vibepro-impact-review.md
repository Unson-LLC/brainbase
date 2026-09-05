# VibePro Impact Review

Use this runbook only when dependency information from VibePro or Graphify can change the implementation or affected-test decision.

1. Start from the accepted behavior and the changed code path.
2. Read the directly affected code and tests.
3. If the dependency boundary remains unclear, run the smallest useful VibePro or Graphify command.
4. Use the result to adjust the implementation or affected-test scope.
5. Stop when the accepted behavior is implemented and the affected tests pass.

Do not create a Graphify section in the PR body merely to prove the tool ran. Generated graphs, command transcripts, scores, and Gate artifacts are optional diagnostics and never merge authority.
