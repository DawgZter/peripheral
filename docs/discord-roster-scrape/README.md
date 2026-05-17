# Discord Roster Scrape Runbook

This folder tracks the attempt to scrape the Call My Agent Hackathon Discord roster into repo-backed artifacts.

## Target

- Server URL supplied by user: https://discord.com/channels/1505343353615552794
- Active local Chrome tab resolved to: https://discord.com/channels/1505343353615552794/1505351459150237716
- Channel observed locally: `#general`

## Current Status

- Browser Use Cloud v3 was tested with the user-provided key. The API worked, but a fresh cloud browser redirected Discord to login:
  - status: `login_required`
  - page title: `Discord`
  - redirected URL: `https://discord.com/login?redirect_to=%2Fchannels%2F1505343353615552794%2F1505351459150237716`
- Browser Use Cloud needs a Discord-authenticated Browser Use profile, or a human login in the live browser, before it can see this private Discord channel.
- Local Chrome did have an authenticated Discord tab. A Chrome UI pass saw the member sidebar and collected 157 unique visible member rows across the virtualized sidebar scan.
  - groups observed: `Online - 93` and `Offline - 68`
  - output files: `docs/discord-roster-scrape/out/local-chrome-roster.json` and `docs/discord-roster-scrape/out/local-chrome-roster.csv`
- Profile-card sampling worked through Chrome UI: clicking a member opened a profile sidebar with fields like display name, Discord username, member-since date, mutual server count, and buttons. Connected social links were not observed in the sampled profile.
- `DiscordChatExporter.Cli` exists in another local checkout, but there was no Discord token in the checked `.env` files. Avoid passing tokens on command lines because they can be exposed in process listings.

## Browser Use Cloud Probe

Run this from the repository root after exporting the Browser Use key:

```bash
export BROWSER_USE_API_KEY=...
node docs/discord-roster-scrape/browser_use_cloud_probe.mjs
```

Optional environment variables:

- `DISCORD_CHANNEL_URL`: overrides the target URL.
- `BROWSER_USE_MODEL`: defaults to `bu-mini`.
- `BROWSER_USE_MAX_COST_USD`: defaults to `0.35`.
- `BROWSER_USE_PROXY_COUNTRY`: defaults to `us`.
- `BROWSER_USE_WAIT_MS`: defaults to `240000`.
- `DISCORD_ROSTER_OUT_DIR`: output directory for probe JSON artifacts.

Expected outcomes:

- If the Browser Use session is not logged into Discord, the probe will report `login_required`.
- If the session is logged in and can see the channel, the probe asks the Browser Use agent to scroll the visible Discord member sidebar and return structured rows.

Generated output goes under `docs/discord-roster-scrape/out/`, which is git-ignored so raw roster data and session metadata do not get committed accidentally.

## Local Authenticated Chrome Result

The working scrape used the already-authenticated local Chrome Discord tab. It produced local-only artifacts:

- `docs/discord-roster-scrape/out/local-chrome-roster.json`
- `docs/discord-roster-scrape/out/local-chrome-roster.csv`
- `docs/discord-roster-scrape/out/browser-use-cloud-probe.json`

The raw roster files are intentionally ignored by git. They can be promoted into version control later if this repo is intended to hold public Discord roster data.

## Data Caveats

Discord sidebars are virtualized and permission-dependent. A UI scrape captures what the signed-in account can see in the rendered channel at that moment; it is not equivalent to a full guild member API export.
