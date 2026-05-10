# VibePro Skills Usage

Use this runbook when Brainbase itself is the agent workspace and the user asks for VibePro work.

1. Verify Brainbase has the VibePro Skills installed:

```bash
vibepro skills verify /Users/ksato/workspace/code/brainbase
```

2. Choose the smallest required Skill set.

- General VibePro workflow: `.claude/skills/vibepro-workflow/SKILL.md`
- Story-driven refactoring, latent bugs, security, DRY, responsibility separation: `.claude/skills/vibepro-story-refactor/SKILL.md`
- Human review cockpit, HTML review artifacts, approve/block/waive decisions: `.claude/skills/vibepro-human-review/SKILL.md`

3. If the active agent is Codex, verify the VibePro managed block is available through `AGENTS.md`:

```bash
vibepro codex verify /Users/ksato/workspace/code/brainbase
```

4. For target repositories such as Aitle, install target-local Skills only when agents will run from that target repo. If the agent runs from Brainbase and merely operates on Aitle, Brainbase-side Skills are the required installation.
5. Continue the VibePro workflow in the order required by the loaded Skills: Story -> Architecture -> Spec -> Task -> Code -> Gate -> PR.

Minimum evidence:

```md
## VibePro Skills Usage
- skills verify: `vibepro skills verify /Users/ksato/workspace/code/brainbase`
- loaded skills: `vibepro-workflow`, plus task-specific VibePro Skills
- codex verify when relevant: `vibepro codex verify /Users/ksato/workspace/code/brainbase`
```
