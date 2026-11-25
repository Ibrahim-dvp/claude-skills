# EEYAAY / IB2B Claude Code skills

A private Claude Code plugin marketplace for the team.

## Install (once per person)

The repo is private. Your machine's git must already be able to read it: run `gh auth login`, then
`gh auth setup-git`.

In Claude Code:

```
/plugin marketplace add eeyaay-dev/claude-skills
/plugin install video-guide@eeyaay-skills
```

Or from a shell: `claude plugin marketplace add eeyaay-dev/claude-skills`, then
`claude plugin install video-guide@eeyaay-skills`.

## Update

```
/plugin marketplace update eeyaay-skills
/reload-plugins
```

Or turn on auto-update for this marketplace under `/plugin` > Marketplaces.

## Plugins

| Plugin | What it does |
|---|---|
| `video-guide` | A Loom-style walkthrough video of a web app, with cursor, numbered circles, captions, chapter cards and optional ElevenLabs voice-over. It also builds an illustrated HTML step-by-step guide from the same run. Ask Claude for "a video guide of <app>". |

## Adding a skill

1. Create `plugins/<name>/.claude-plugin/plugin.json` and `plugins/<name>/skills/<name>/SKILL.md`.
2. Add an entry to `.claude-plugin/marketplace.json`.
3. Bump `version` in `plugin.json` on every change, so teammates get the update.
4. **Never commit client data, passwords, keys or client names.**
