# Security Policy

## OSS Security Automation

This repository implements automated security checks to prevent accidental exposure of sensitive information before OSS release.

### Automated Checks

The following security checks are automated:

1. **Pre-commit Hook** - Runs locally before each commit
2. **GitHub Actions CI** - Runs on every push and pull request

### What is Checked

The `scripts/check-secrets.sh` script scans for:

#### Critical Checks (MUST FIX)
- Personal names (Japanese: 佐藤, さとう, サトウ)
- Personal names (English: Keigo, Sato)
- Personal email addresses (@unson.co.jp, @gmail.com, @yahoo.co.jp)
- Hardcoded absolute paths (/Users/ksato, /Users/*/)
- AWS credentials (aws_access_key, AWS_ACCESS_KEY, AKIA[0-9A-Z]{16})
- API keys (OpenAI: sk-*, GitHub PAT: ghp_*)

#### Warning Checks (Review Recommended)
- Real company names in samples
- Slack channel IDs (C[0-9A-Z]{10})
- Slack user IDs (U[0-9A-Z]{10})
- Workspace paths (/Users/*/workspace)

### Setup

#### Install Pre-commit Hook

Run this command once after cloning the repository:

```bash
bash scripts/install-pre-commit-hook.sh
```

The hook will automatically run before each `git commit`.

#### Manual Check

You can manually run the security check at any time:

```bash
bash scripts/check-secrets.sh
```

Exit codes:
- `0` - Success (warnings may exist)
- `1` - Critical errors found (commit blocked)

#### Bypass Hook (NOT Recommended)

If you absolutely need to bypass the pre-commit hook:

```bash
git commit --no-verify
```

**Warning**: This bypasses all security checks. Only use this if you're certain the changes are safe.

### GitHub Actions

The security check runs automatically on:
- Every push to `main` branch
- Every push to `session/**` branches
- Every pull request to `main`

If the check fails:
1. The workflow will fail
2. An artifact with detailed results will be uploaded
3. (For PRs) A comment will be added to the PR

### Exclusions

The following files and directories are automatically excluded from checks:

- `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `test-results/`, `.worktrees/`, `.claude/`
- `state.json`, `*.log`, `*.tmp`
- Internal documentation files (see `.gitignore`)

### Reporting Security Issues

If you discover a security vulnerability in this project, please report it by:

1. Creating a new issue at https://github.com/Unson-LLC/brainbase/issues
2. Marking it as a security issue
3. Providing detailed steps to reproduce

Do NOT include sensitive credentials or personal information in the issue.

### Security Best Practices

When contributing to this project:

1. Never hardcode credentials, API keys, or tokens
2. Use environment variables for sensitive configuration
3. Use generic placeholders in documentation (e.g., `/path/to/workspace` instead of `/Users/yourname/workspace`)
4. Anonymize sample data (use "Developer A" instead of real names)
5. Run `bash scripts/check-secrets.sh` before committing
6. Review the script output carefully

### False Positives

If the security check flags a false positive:

1. Verify it's truly a false positive (not actually sensitive data)
2. Add the file to the exclusion list in `scripts/check-secrets.sh`
3. Document the reason in a PR comment

### Updates to Security Checks

To add new security patterns:

1. Edit `scripts/check-secrets.sh`
2. Add new `check_pattern` calls with appropriate severity ("error" or "warning")
3. Test the changes locally: `bash scripts/check-secrets.sh`
4. Submit a PR with the changes

---

**Last Updated**: 2025-12-31
**Maintainer**: Unson LLC
