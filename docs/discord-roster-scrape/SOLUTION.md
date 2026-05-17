# Discord Roster Scrape Solution

This is the repo-backed solution for scraping the Call My Agent Hackathon Discord roster.

## What Worked

Browser Use Cloud API access worked with a `bu_` API key, but a fresh cloud browser was not authenticated to Discord. It redirected to:

```text
https://discord.com/login?redirect_to=%2Fchannels%2F1505343353615552794%2F1505351459150237716
```

Because the user's local Chrome profile was already logged into Discord and could see the server, the working extraction path was:

1. Use local authenticated Chrome through the Codex Chrome extension.
2. Claim the open Discord tab for `Call My Agent Hackathon`.
3. Scroll the virtualized member sidebar from top to bottom.
4. Extract each member row's display name, raw row text, group, and server tag when visible.
5. Save local-only JSON and CSV outputs under `docs/discord-roster-scrape/out/`.

## Local Output

The completed local scrape produced:

- `docs/discord-roster-scrape/out/local-chrome-roster.json`
- `docs/discord-roster-scrape/out/local-chrome-roster.csv`
- `docs/discord-roster-scrape/out/browser-use-cloud-probe.json`

Observed count from the local Chrome scrape:

- `157` member rows
- groups observed: `Online - 93`, `Offline - 68`

The `out/` directory is intentionally git-ignored so raw Discord roster data is not published accidentally.

## Browser Use Cloud Path

Use `browser_use_cloud_probe.mjs` once Browser Use has a Discord-authenticated profile or once a human logs into Discord in the live cloud browser:

```bash
export BROWSER_USE_API_KEY=...
node docs/discord-roster-scrape/browser_use_cloud_probe.mjs
```

The script uses Browser Use API v3 at:

```text
https://api.browser-use.com/api/v3
```

It sends a read-only task: open the Discord channel, do not log in or mutate server state, and return `login_required` if the channel is not visible.

## Privacy Boundary

The committed repo contains the runbook and reusable scrape/probe code. The raw member roster remains local-only unless there is an explicit decision to publish it.

