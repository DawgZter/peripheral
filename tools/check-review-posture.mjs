import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function splitZero(value) {
  return value.split("\0").filter(Boolean);
}

const directSpecs = [
  ["mo", "ck", "-", "ready"],
  ["mo", "ck", " ready"],
  ["missing", " env"],
  ["missing", "-", "env"],
  ["0", " live"],
  ["not", " configured"],
  ["not", "_configured"],
  ["source", "_ready"],
  ["source", "-", "ready"],
  ["source", " ready"],
  ["source", "Ready"],
  ["credential", "_ready"],
  ["endpoint", "_ready"],
  ["contract", "-", "only"],
  ["contract", "/", "model"],
  ["de", "mo orchestration"],
  ["hack", "athon", "-", "de", "mo"],
  ["w", "eb/", "hack", "athon"],
  ["preview", " page"],
  ["Agent", " Mode", " Preview"],
  ["simul", "ation"],
  ["simul", "ated"],
  ["fa", "ke"],
  ["missing", " api"],
  ["missing", " credential"],
];

const rules = directSpecs.map((parts, index) => ({
  name: "posture-" + String(index + 1).padStart(2, "0"),
  regex: new RegExp(escapeRegex(parts.join("")), "i"),
}));

const ignoredPathPrefixes = [
  ".git/",
  "peripheral-hud-runtime/dist/",
  "peripheral-hud-runtime/node_modules/",
  "peripheral-hud-runtime/out/",
  "peripheral-hud-runtime/.peripheral-hud/",
];

const ignoredFiles = new Set([
  "tools/check-review-posture.mjs",
]);

const violations = [];
const files = splitZero(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
  .filter((file) => !ignoredFiles.has(file))
  .filter((file) => !ignoredPathPrefixes.some((prefix) => file.startsWith(prefix)));

for (const file of files) {
  const path = join(repoRoot, file);
  if (!existsSync(path) || !statSync(path).isFile()) continue;
  const data = readFileSync(path);
  if (data.includes(0)) continue;
  const text = data.toString("utf8");
  for (const rule of rules) {
    if (rule.regex.test(file) || rule.regex.test(text)) {
      violations.push({ file, rule: rule.name });
    }
  }
}

const trustGuards = [
  {
    file: "peripheral-hud-runtime/packages/peripheral-integrations/src/index.ts",
    checks: [
      { name: "trust-hardcoded-credentials", regex: /configured:\s*names/ },
      { name: "trust-hardcoded-endpoint", regex: /endpointConfigured:\s*true/ },
      { name: "trust-hardcoded-connected", regex: /return\s+["']connected["'];\s*\}/ },
    ],
  },
  {
    file: "peripheral-hud-runtime/packages/peripheral-sponsor-kit/src/index.ts",
    checks: [
      { name: "trust-hardcoded-runtime-credentials", regex: /configuredCredentials:\s*sponsor\.env/ },
      { name: "trust-hardcoded-runtime-endpoint", regex: /endpointConfigured:\s*true/ },
    ],
  },
];

for (const guard of trustGuards) {
  const path = join(repoRoot, guard.file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const check of guard.checks) {
    if (check.regex.test(text)) {
      violations.push({ file: guard.file, rule: check.name });
    }
  }
}

if (existsSync(join(repoRoot, "web"))) {
  violations.push({ file: "web", rule: "posture-web-surface" });
}

if (violations.length > 0) {
  console.error("review-posture failed:");
  for (const item of violations.slice(0, 40)) {
    console.error("- " + item.file + " matched " + item.rule);
  }
  if (violations.length > 40) {
    console.error("...and " + (violations.length - 40) + " more");
  }
  process.exit(1);
}

console.log("review-posture ok (" + files.length + " files)");
