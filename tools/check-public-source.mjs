import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scanCommits = process.argv.includes("--commits") || process.env.PERIPHERAL_PUBLIC_SOURCE_SCAN_COMMITS === "1";

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

const directSpecs = [
  ["ni", "mo"],
  ["aig", "lasses"],
  ["ghi", "dra"],
  ["dec", "ompil"],
  ["source", "-", "like"],
  ["source", " ", "like"],
  ["source", " recovery"],
  ["reverse", " engineering"],
  ["bit", "fantasy"],
  ["wq", "7033"],
  ["zt", "210"],
  ["firmware", " source"],
  ["recovered", "_symbols"],
  ["recovered", "_types"],
  ["source", "_reference"],
  ["source", "-", "reference"],
  ["hack", "athon", "-", "de", "mo"],
  ["w", "eb/", "hack", "athon"],
  ["Agent", " Mode", " De", "mo"],
  ["simul", "ation"],
  ["simul", "ated"],
  ["fixture", "-", "only"],
  ["contract", "-", "only"],
];

const wordSpecs = [["tu", "ring"]];

const rules = [
  ...directSpecs.map((parts, index) => ({
    name: "direct-" + (index + 1),
    regex: new RegExp(escapeRegex(parts.join("")), "i"),
  })),
  ...wordSpecs.map((parts, index) => ({
    name: "word-" + (index + 1),
    regex: new RegExp("\\b" + escapeRegex(parts.join("")) + "\\b", "i"),
  })),
];

const violations = [];

function scanText(scope, subject, text) {
  for (const rule of rules) {
    if (rule.regex.test(text)) {
      violations.push({ scope, subject, rule: rule.name });
    }
  }
}

function scanBuffer(scope, subject, buffer) {
  if (buffer.includes(0)) {
    return;
  }
  scanText(scope, subject, buffer.toString("utf8"));
}

function splitZero(value) {
  return value.split("\0").filter(Boolean);
}

const worktreeFiles = [
  ...new Set(splitZero(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))),
];

for (const file of worktreeFiles) {
  scanText("worktree path", file, file);
  const path = join(repoRoot, file);
  if (existsSync(path)) {
    scanBuffer("worktree file", file, readFileSync(path));
  }
}

let commitCount = 0;

if (scanCommits) {
  const commits = git(["rev-list", "HEAD"]).trim().split("\n").filter(Boolean);
  commitCount = commits.length;
  for (const commit of commits) {
    scanText("commit message", commit, git(["log", "-1", "--format=%B", commit]));

    const names = splitZero(git(["ls-tree", "-r", "--name-only", "-z", commit]));
    for (const name of names) {
      scanText("commit path", commit + ":" + name, name);
      const blob = git(["show", commit + ":" + name], { encoding: "buffer" });
      scanBuffer("commit file", commit + ":" + name, blob);
    }
  }
}

if (violations.length > 0) {
  console.error("Public source check failed:");
  for (const item of violations.slice(0, 40)) {
    console.error("- " + item.scope + ": " + item.subject + " matched " + item.rule);
  }
  if (violations.length > 40) {
    console.error("...and " + (violations.length - 40) + " more");
  }
  process.exit(1);
}

console.log("public-source ok (" + worktreeFiles.length + " worktree files" + (scanCommits ? ", " + commitCount + " commits" : ", commit scan opt-in") + ")");
