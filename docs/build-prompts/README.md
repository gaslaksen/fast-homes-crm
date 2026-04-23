# Build Prompts

This directory archives the detailed implementation prompts we use to build major features in Dealcore via Claude Code. Each file is the full brief — scope, decisions, phased build order, acceptance criteria — handed to Claude at the start of a feature build.

Keeping these around gives us:

- a searchable record of what a feature was *meant* to do, independent of how the code ended up
- a reference point when something shipped differs from intent (regression? intentional change? forgotten subtlety?)
- templates to remix when a new feature has the same shape as an earlier one

## Shipped

- [001 — Sidebar Navigation](./001-sidebar-navigation.md)
- [002 — Dashboard Action Queue + Empty State Audit](./002-dashboard-action-queue.md)

## Upcoming

- 003 — Kanban v2
- 004 — Lead Detail redesign
- 005 — Unified Inbox

## Conventions

- Filename: `NNN-kebab-case-title.md` — three-digit sequence keeps them ordered.
- Each prompt is self-contained: a new Claude Code session should be able to execute it without additional context from the conversation that produced it.
- Open questions the prompt author doesn't want Claude to guess should be listed explicitly at the bottom so Claude surfaces them during planning rather than silently picking defaults.
