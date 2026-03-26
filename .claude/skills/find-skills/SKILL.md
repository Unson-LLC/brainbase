---
name: find-skills
description: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain

## How to Help Users Find Skills

1. Understand the domain and task the user needs.
2. Check whether an existing local/project skill already solves it.
3. If not, search the broader ecosystem with `npx skills find [query]`.
4. Verify quality before recommending anything.
5. Present the best option with install guidance.

## Install

```bash
npx skills add <owner/repo@skill> -g -y
```
