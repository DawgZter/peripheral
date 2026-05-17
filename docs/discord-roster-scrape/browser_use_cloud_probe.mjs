#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.BROWSER_USE_API_KEY;
const targetUrl =
  process.env.DISCORD_CHANNEL_URL ||
  "https://discord.com/channels/1505343353615552794/1505351459150237716";
const outDir =
  process.env.DISCORD_ROSTER_OUT_DIR ||
  path.resolve("docs/discord-roster-scrape/out");
const baseUrl = "https://api.browser-use.com/api/v3";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function browserUse(pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    ...options,
    headers: {
      "content-type": "application/json",
      "X-Browser-Use-API-Key": apiKey,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {raw: text};
  }

  if (!response.ok) {
    throw new Error("Browser Use request failed: HTTP " + response.status + " " + JSON.stringify(payload));
  }

  return payload;
}

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {type: "string", enum: ["scraped", "login_required", "blocked", "error"]},
      page_title: {type: ["string", "null"]},
      current_url: {type: ["string", "null"]},
      channel_name: {type: ["string", "null"]},
      visible_member_count: {type: ["integer", "null"]},
      members: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            display_name: {type: "string"},
            raw_text: {type: "string"},
            group: {type: ["string", "null"]},
            server_tag: {type: ["string", "null"]},
          },
          required: ["display_name", "raw_text", "group", "server_tag"],
        },
      },
      notes: {type: "string"},
    },
    required: [
      "status",
      "page_title",
      "current_url",
      "channel_name",
      "visible_member_count",
      "members",
      "notes",
    ],
  };
}

async function main() {
  if (!apiKey) {
    fail("Missing BROWSER_USE_API_KEY.");
    return;
  }

  const task = [
    "Open this Discord channel URL: " + targetUrl + ".",
    "Do not attempt to log in, do not send messages, do not click call/message/reaction controls, and do not change server state.",
    "If Discord asks for login or cannot access the server/channel, return status login_required or blocked with the observed page title/url and a short note.",
    "If the channel is visible, scrape the visible member sidebar by scrolling it from top to bottom and collect display names, raw row text, group labels if visible, and server tags if visible.",
    "Return only structured data matching the schema.",
  ].join("\n");

  await fs.mkdir(outDir, {recursive: true});

  const session = await browserUse("/sessions", {
    method: "POST",
    body: JSON.stringify({
      task,
      model: process.env.BROWSER_USE_MODEL || "bu-mini",
      keepAlive: true,
      maxCostUsd: Number(process.env.BROWSER_USE_MAX_COST_USD || 0.35),
      enableRecording: false,
      outputSchema: outputSchema(),
      skills: false,
      agentmail: false,
      proxyCountryCode: process.env.BROWSER_USE_PROXY_COUNTRY || "us",
    }),
  });

  let latest = session;
  const timeoutMs = Number(process.env.BROWSER_USE_WAIT_MS || 240000);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    latest = await browserUse("/sessions/" + session.id, {method: "GET"});
    if (["stopped", "idle", "timed_out", "error"].includes(latest.status) && latest.output != null) break;
    if (["timed_out", "error"].includes(latest.status)) break;
  }

  const redacted = {
    scrapedAt: new Date().toISOString(),
    targetUrl,
    browserUseSessionId: latest.id,
    status: latest.status,
    title: latest.title,
    stepCount: latest.stepCount,
    lastStepSummary: latest.lastStepSummary,
    isTaskSuccessful: latest.isTaskSuccessful,
    hasLiveUrl: Boolean(latest.liveUrl),
    hasScreenshotUrl: Boolean(latest.screenshotUrl),
    output: latest.output,
  };

  const artifactPath = path.join(outDir, "browser-use-cloud-probe.json");
  await fs.writeFile(artifactPath, JSON.stringify(redacted, null, 2));
  console.log(JSON.stringify({artifactPath, ...redacted, liveUrl: undefined, screenshotUrl: undefined}, null, 2));
}

main().catch((error) => {
  fail(error.stack || error.message);
});

