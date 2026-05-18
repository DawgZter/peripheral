import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (pack.status !== 0) {
  console.error(pack.stderr || pack.stdout);
  process.exit(pack.status || 1);
}

let entries;
try {
  entries = JSON.parse(pack.stdout);
} catch (error) {
  console.error("Could not parse npm pack --dry-run output as JSON.");
  console.error(pack.stdout);
  throw error;
}

const archive = entries[0];
if (!archive || !Array.isArray(archive.files)) {
  throw new Error("npm pack did not return a file list.");
}

const forbidden = [
  { label: "dependency tree", regex: /(^|\/)node_modules\// },
  { label: "compiled TypeScript output", regex: /(^|\/)dist\// },
  { label: "runtime output", regex: /(^|\/)out\// },
  { label: "HUD local state", regex: /(^|\/)\.peripheral-hud\// },
  { label: "Swift build output", regex: /(^|\/)\.build\// },
  { label: "local environment file", regex: /(^|\/)\.env(\.|$)/ },
  { label: "log file", regex: /\.log$/ },
  { label: "pid file", regex: /\.pid$/ },
  { label: "package archive", regex: /\.tgz$/ },
];

const violations = [];
for (const file of archive.files) {
  for (const rule of forbidden) {
    if (rule.regex.test(file.path)) {
      violations.push({ path: file.path, label: rule.label });
    }
  }
}

if (violations.length > 0) {
  console.error("package-pack failed:");
  for (const item of violations.slice(0, 40)) {
    console.error("- " + item.path + " includes " + item.label);
  }
  if (violations.length > 40) {
    console.error("...and " + (violations.length - 40) + " more");
  }
  process.exit(1);
}

console.log("package-pack ok (" + archive.files.length + " files, " + archive.unpackedSize + " bytes unpacked)");
