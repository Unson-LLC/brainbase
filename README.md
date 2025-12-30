# 🧠 Brainbase

> AI-first project management console for developers

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)

## 🚀 What is Brainbase?

Brainbase is a local-first project management tool designed for developers who value:
- **Event-Driven Architecture** - Loosely coupled, testable modules
- **AI-Native Workflows** - Claude Code integration, automated task management
- **Multi-Session Support** - Manage multiple projects simultaneously
- **Terminal-First UI** - Keyboard-driven, tmux-friendly interface

## ⚡ Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open http://localhost:3000 in your browser.

## ✨ Key Features

- **Event-Driven Architecture**: EventBus, Reactive Store, DI Container
- **Test-Driven Development**: 80%+ coverage, Red-Green-Refactor cycle
- **Multi-Session Management**: Switch between projects seamlessly
- **Task Management**: YAML-based, Claude Code compatible
- **Schedule Viewer**: Daily/Weekly/Custom timeframes
- **Inbox Integration**: Slack, Gmail, Calendar (via MCP)
- **Terminal Integration**: ttyd console for direct CLI access

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           UI Components (View)           │
├─────────────────────────────────────────┤
│        Services (Business Logic)         │
├─────────────────────────────────────────┤
│      Repositories (Data Access)          │
├─────────────────────────────────────────┤
│      EventBus (Cross-Cutting)            │
└─────────────────────────────────────────┘
```

See [DESIGN.md](./DESIGN.md) for detailed architecture.

## 📚 Documentation

- [Getting Started](./docs/README.md)
- [Development Standards](./CLAUDE.md)
- [Architecture](./DESIGN.md)
- [Contributing](./CONTRIBUTING.md)

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

🤖 Built with [Claude Code](https://claude.com/claude-code)
