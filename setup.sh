#!/bin/bash
# Brainbase Initial Setup Script
# This script sets up the necessary files for first-time users

set -e

echo "🧠 Brainbase Initial Setup"
echo "=========================="
echo ""

# Check if already initialized
if [ -f "state.json" ]; then
    echo "⚠️  state.json already exists. Skipping initialization."
    echo "   If you want to reset, run: rm state.json && ./setup.sh"
    exit 0
fi

# Create state.json from sample
echo "📝 Creating state.json from state.sample.json..."
cp state.sample.json state.json
echo "   ✅ state.json created"

# Create .env from example if it doesn't exist
if [ ! -f ".env" ]; then
    echo "⚙️  Creating .env from .env.example..."
    cp .env.example .env
    # Comment out the paths to use auto-detection
    sed -i.bak 's/^BRAINBASE_ROOT=/#BRAINBASE_ROOT=/' .env 2>/dev/null || true
    sed -i.bak 's/^PROJECTS_ROOT=/#PROJECTS_ROOT=/' .env 2>/dev/null || true
    rm -f .env.bak 2>/dev/null || true
    echo "   ✅ .env created (Kiro task format enabled by default)"
fi

# Create _tasks directory with sample data if it doesn't exist
if [ ! -d "_tasks" ]; then
    echo "📂 Creating _tasks directory (Kiro format)..."
    mkdir -p _tasks/inbox
    cat > _tasks/inbox/tasks.md << 'TASKS_EOF'
- [ ] Brainbaseへようこそ！
  - _ID: sample-task-1_
  - _Priority: high_
  - _Description: このサンプルタスクを編集してみましょう_
- [ ] UIを探索する
  - _ID: sample-task-2_
  - _Priority: medium_
  - _Description: タスク管理、タイムライン、セッション切り替えを試してみましょう_
TASKS_EOF
    touch _tasks/inbox/done.md
    echo "   ✅ _tasks/inbox created with sample tasks"
else
    echo "📂 _tasks directory found (Kiro format)"
fi

# Create _schedules directory if it doesn't exist
if [ ! -d "_schedules" ]; then
    echo "📅 Creating _schedules directory..."
    cp -r _schedules-sample _schedules
    echo "   ✅ _schedules created with sample data"
fi

# Create empty _codex if it doesn't exist (use sample as fallback)
if [ ! -d "_codex" ]; then
    echo "📚 Using _codex-sample as knowledge base..."
    echo "   (You can create your own _codex later)"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Task format: Kiro (directory-based)"
echo "   Tasks are stored in _tasks/{project}/tasks.md"
echo "   Completed tasks go to _tasks/{project}/done.md"
echo ""
echo "Next steps:"
echo "1. Start the server: npm start"
echo "2. Open http://localhost:3000 in your browser"
echo "3. Explore the sample tasks and sessions"
echo ""
echo "Optional: Set BRAINBASE_ROOT to use a different workspace"
echo "  export BRAINBASE_ROOT=/path/to/your/workspace"
echo ""
