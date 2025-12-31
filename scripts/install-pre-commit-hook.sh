#!/bin/bash
# Pre-commit hook installer for OSS security checks
# Usage: bash scripts/install-pre-commit-hook.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-commit"

echo "📦 Installing pre-commit hook for OSS security checks..."

# Create pre-commit hook
cat > "$HOOK_PATH" << 'EOF'
#!/bin/bash
# Pre-commit hook: Run OSS security check before commit

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "🔍 Running OSS security check before commit..."
echo ""

# Run check script
if ! bash scripts/check-secrets.sh; then
    echo ""
    echo "❌ Commit blocked: Security check failed"
    echo ""
    echo "Please fix the security issues above before committing."
    echo "If you need to bypass this check (NOT recommended), use:"
    echo "  git commit --no-verify"
    echo ""
    exit 1
fi

echo ""
echo "✅ Security check passed. Proceeding with commit..."
echo ""
exit 0
EOF

# Make hook executable
chmod +x "$HOOK_PATH"

echo "✅ Pre-commit hook installed successfully!"
echo ""
echo "The hook will run automatically before each commit."
echo "To bypass the hook (NOT recommended), use: git commit --no-verify"
