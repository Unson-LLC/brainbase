#!/bin/bash
# Brainbase Initial Setup Script
# This script sets up the necessary files for first-time users

set -e

echo "🧠 Brainbase Initial Setup"
echo "=========================="
echo ""

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${BRAINBASE_ROOT:-$REPO_ROOT/data}"
VAR_DIR="${BRAINBASE_VAR_DIR:-$REPO_ROOT/var}"
STATE_FILE="$VAR_DIR/state.json"

# Check if already initialized
if [ -f "$STATE_FILE" ]; then
    echo "⚠️  state.json already exists. Skipping initialization."
    echo "   If you want to reset, run: rm \"$STATE_FILE\" && ./setup.sh"
    exit 0
fi

# Ensure local data/runtime dirs exist
mkdir -p "$DATA_DIR" "$VAR_DIR"

# Create state.json from sample
echo "📝 Creating state.json from state.sample.json..."
cp "$REPO_ROOT/state.sample.json" "$STATE_FILE"
echo "   ✅ state.json created"

# Create _tasks directory if it doesn't exist
if [ ! -d "$DATA_DIR/_tasks" ]; then
    echo "📂 Creating _tasks directory..."
    cp -r "$REPO_ROOT/_tasks-sample" "$DATA_DIR/_tasks"
    echo "   ✅ _tasks created with sample data"
fi

# Create _schedules directory if it doesn't exist
if [ ! -d "$DATA_DIR/_schedules" ]; then
    echo "📅 Creating _schedules directory..."
    cp -r "$REPO_ROOT/_schedules-sample" "$DATA_DIR/_schedules"
    echo "   ✅ _schedules created with sample data"
fi

# Create _inbox directory if it doesn't exist
if [ ! -d "$DATA_DIR/_inbox" ]; then
    echo "📥 Creating _inbox directory..."
    cp -r "$REPO_ROOT/_inbox-sample" "$DATA_DIR/_inbox"
    echo "   ✅ _inbox created with sample data"
fi

# Create config.yml in data dir if missing
if [ ! -f "$DATA_DIR/config.yml" ]; then
    echo "⚙️  Creating config.yml..."
    if [ -f "$REPO_ROOT/config.yml" ]; then
        cp "$REPO_ROOT/config.yml" "$DATA_DIR/config.yml"
    elif [ -f "$REPO_ROOT/config.sample.yml" ]; then
        cp "$REPO_ROOT/config.sample.yml" "$DATA_DIR/config.yml"
    else
        cat > "$DATA_DIR/config.yml" <<'EOF'
projects_root: ${PROJECTS_ROOT:-/path/to/projects}
projects: []
plugins:
  enabled:
    - bb-inbox
  disabled: []
EOF
    fi
    echo "   ✅ config.yml created"
fi

# Create empty _codex if it doesn't exist (use sample as fallback)
if [ ! -d "$DATA_DIR/_codex" ]; then
    echo "📚 Using _codex-sample as knowledge base..."
    echo "   (You can create your own _codex later)"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the server: npm start"
echo "2. Open http://localhost:31013 in your browser"
echo "3. Explore the sample tasks and sessions"
echo ""
echo "Optional: Set BRAINBASE_ROOT to use a different workspace"
echo "  export BRAINBASE_ROOT=/path/to/your/workspace"
echo "Optional: Set BRAINBASE_VAR_DIR to store runtime files elsewhere"
echo "  export BRAINBASE_VAR_DIR=/path/to/your/var"
echo ""
