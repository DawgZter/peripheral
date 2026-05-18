#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const target = process.env.SPONSOR_TARGET || process.argv[2] || "tx-extract";
const profile = process.env.SPONSOR_PROFILE || "review";
const inputPath = process.env.SPONSOR_INPUT_PATH || "";
const outputDir = resolve(process.env.SPONSOR_OUTPUT_DIR || "out/sponsor");
const extraArgs = process.env.SPONSOR_ARGS || "";

const supportedTargets = new Set(["tx-extract", "ports", "run-waveform"]);
if (!supportedTargets.has(target)) {
  console.error("Unsupported sponsor target: " + target);
  process.exit(64);
}

const generatedAt = new Date().toISOString();
const payload = {
  schema: "peripheral-sponsor-manual-tool-v1",
  generatedAt,
  target,
  profile,
  inputPath,
  outputDir,
  extraArgs,
  status: "ready",
  surfaces: surfacesForTarget(target),
  artifacts: [
    "sponsor workflow dossier",
    "agent handoff surface",
    "phone runtime approval policy",
  ],
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, target + ".json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify(payload, null, 2));

function surfacesForTarget(value) {
  switch (value) {
    case "tx-extract":
      return ["Stripe receipt glance", "AgentMail draft approval", "Supermemory recall card"];
    case "ports":
      return ["AgentPhone call HUD", "Browser Use proof card", "Gemini route hint"];
    case "run-waveform":
      return ["phone gateway lease", "approval gate", "connected glasses status"];
    default:
      return [];
  }
}
