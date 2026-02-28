# Contributing to Brainbase

Thank you for your interest in contributing to Brainbase!

## 🚀 Development Workflow

Brainbase follows a **7-Phase Development Workflow**:

1. **Explore** - Understand existing code
2. **Plan** - Design implementation approach
3. **Branch** - Create feature branch (`session/YYYY-MM-DD-<type>-<name>`)
4. **Edit** - Implement with TDD (Red-Green-Refactor)
5. **Test** - Ensure 80%+ coverage
6. **Commit** - Use Conventional Commits format
7. **PR** - Submit pull request for review

## 🧪 Test-Driven Development (TDD)

Brainbase is built with TDD at its core. Follow the **Red-Green-Refactor** cycle:

1. **RED**: Write a failing test
2. **GREEN**: Write minimal code to pass
3. **REFACTOR**: Clean up code

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

**Coverage Requirement**: 80%+ for all PRs

## 🏗️ Architecture Principles

Brainbase follows these core principles:

- **Event-Driven Architecture**: All state changes emit events via EventBus
- **Reactive Store Pattern**: UI syncs with state via Reactive Store
- **Dependency Injection**: Services resolved via DI Container
- **Service Layer Pattern**: Business logic in Service layer

See [CLAUDE.md](./CLAUDE.md) for detailed development standards.

## 📝 Commit Message Format

Use **Conventional Commits**:

```
<type>(<scope>): <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**Types**: feat, fix, docs, style, refactor, test, chore

## 🔍 Code Review Process

1. Create a feature branch
2. Implement with TDD
3. Ensure tests pass and coverage is 80%+
4. Create a pull request
5. Respond to review feedback
6. Merge after approval

## 💬 Communication

- **Issues**: Bug reports, feature requests
- **Discussions**: Questions, ideas, general discussions
- **Pull Requests**: Code contributions

---

Thank you for contributing to Brainbase! 🎉
