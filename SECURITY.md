# Security Policy

Foody is a hackathon prototype, but it talks to a real Slack workspace, so it's
built to keep secrets out of the codebase.

## Reporting a vulnerability

Please **report privately** — do not open a public issue for security problems.

📧 **timdries@hotmail.com**

I'll acknowledge within a few days and work with you on a fix and disclosure timeline.

## How secrets are handled

- All credentials (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`)
  live in a local, git-ignored `.env` file — see [`.env.example`](.env.example).
  Nothing sensitive is committed; the history has been checked.
- Foody runs over **Slack Socket Mode** (an outbound WebSocket): no public URL and
  no inbound port, so nothing is exposed to the internet.
- If you ever suspect a token leaked, **rotate it immediately** in the Slack app
  settings (OAuth & Permissions / App-Level Tokens).

## Scope

The bot requests the minimum scopes needed to read its trigger phrase, post Block
Kit messages, and manage reactions — see [`docs/slack-manifest.yml`](docs/slack-manifest.yml).
