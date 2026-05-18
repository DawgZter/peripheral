import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const targets = ["tx-extract", "ports", "run-waveform"];
const outputRoot = mkdtempSync(join(tmpdir(), "peripheral-sponsor-tools-"));

try {
  for (const target of targets) {
    const outputDir = join(outputRoot, target);
    const run = spawnSync("make", [
      target,
      "SPONSOR_PROFILE=check",
      "SPONSOR_INPUT_PATH=fixtures/input",
      "SPONSOR_OUTPUT_DIR=" + outputDir,
      "SPONSOR_ARGS=check=true",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (run.status !== 0) {
      throw new Error(target + " failed: " + (run.stderr || run.stdout));
    }
    const artifact = JSON.parse(readFileSync(join(outputDir, target + ".json"), "utf8"));
    assertEqual(artifact.schema, "peripheral-sponsor-manual-tool-v1", target + " schema");
    assertEqual(artifact.target, target, target + " target");
    assertEqual(artifact.profile, "check", target + " profile");
    assertEqual(artifact.status, "ready", target + " status");
    if (!Array.isArray(artifact.surfaces) || artifact.surfaces.length === 0) {
      throw new Error(target + " did not report review surfaces.");
    }
  }
  console.log("sponsor-manual-tools ok (" + targets.length + " targets)");
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + " expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
  }
}
