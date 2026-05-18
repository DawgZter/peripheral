import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertWidget } from "../packages/peripheral-protocol/src/index.js";
import { buildDisplayImageFrames, fullPanelSetupPolicy, invertPacked2Bpp } from "../packages/peripheral-driver/src/index.js";
import { renderWidgetFile } from "../packages/peripheral-renderer/src/index.js";
import { clearHud, compactHermesTerminalLines, mergeVoiceDraft, normalizeTmuxSessionName, runtimePaths, sanitizeTerminalLine, showHudCard } from "../packages/peripheral-runtime/src/index.js";

const root = resolve(process.cwd());
const fixtureDir = join(root, "fixtures", "ui");
const outDir = join(root, "out", "test-frames");

for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith(".json") && !name.startsWith("invalid"))) {
  const input = join(fixtureDir, file);
  const artifact = renderWidgetFile(input, join(outDir, file.replace(/\.json$/, ".png")), {
    assetRoot: join(root, "fixtures", "images"),
  });
  assert.equal(artifact.width, 540);
  assert.equal(artifact.height, 280);
  assert.equal(artifact.stats.rawBytes, 37800);
  assert.ok(artifact.stats.litPixels > 1000, `${file} should render nonblank`);
  assert.ok(existsSync(artifact.pngPath));
  assert.ok(existsSync(artifact.sidecarPath));
  const built = buildDisplayImageFrames(Buffer.from(artifact.pixelsBase64, "base64"));
  assert.ok(built.compressed.length > 0);
  assert.ok(built.frames.length >= 1);
}

assert.throws(() => {
  assertWidget(JSON.parse(readFileSync(join(fixtureDir, "invalid_unknown_type.json"), "utf8")) as unknown);
}, /Unknown widget type/);

assert.deepEqual([...invertPacked2Bpp(Buffer.from([0x00, 0x55, 0xaa, 0xff]))], [0xff, 0xaa, 0x55, 0x00]);
const defaultFullPanelSetupPolicy = {
  setupEnabled: true,
  waitForSurfaceReady: true,
  setupStrategy: "factory_hidden_wait_fe01",
  fullPanelPrimedBeforePush: false,
  markPrimedAfterSuccess: false,
};
assert.deepEqual(fullPanelSetupPolicy("", false), defaultFullPanelSetupPolicy);
assert.deepEqual(fullPanelSetupPolicy("0", false), defaultFullPanelSetupPolicy);
assert.deepEqual(fullPanelSetupPolicy("1", false), {
  setupEnabled: true,
  waitForSurfaceReady: false,
  setupStrategy: "factory_hidden_initial_resync_no_wait",
  fullPanelPrimedBeforePush: false,
  markPrimedAfterSuccess: true,
});
assert.deepEqual(fullPanelSetupPolicy("1", true), {
  setupEnabled: false,
  waitForSurfaceReady: false,
  setupStrategy: "skipped_by_env_after_initial_resync",
  fullPanelPrimedBeforePush: true,
  markPrimedAfterSuccess: false,
});
assert.deepEqual(fullPanelSetupPolicy("always", false), {
  setupEnabled: false,
  waitForSurfaceReady: false,
  setupStrategy: "skipped_by_env_forced",
  fullPanelPrimedBeforePush: false,
  markPrimedAfterSuccess: false,
});
assert.equal(sanitizeTerminalLine("╭──────────── Hermes Agent v0.12.0 · upstream ────────────╮"), "Hermes Agent v0.12.0 - upstream");
assert.equal(sanitizeTerminalLine("⚕ gpt-5.5 │ ctx -- │ [░░░░] -- │ 8s │ ⏲ 0s"), "Hermes gpt-5.5 ctx -- [] -- 8s time 0s");
assert.equal(sanitizeTerminalLine("│ ⠀⠀⠀⠀⠀ browser: browser_back, browser_click │"), "browser: browser_back, browser_click");
assert.equal(sanitizeTerminalLine("────────────────────────"), "");
assert.deepEqual(
  compactHermesTerminalLines([
    "╭──────────── Hermes Agent v0.12.0 · upstream ────────────╮",
    "│ Available Tools │",
    "│ ⠀⠀⠀⠀⠀ browser: browser_back, browser_click │",
    "│ code_execution: python, shell │",
    "│ MCP Servers │",
    "│ moss (stdio) — 10 tool(s) │",
    "│ agentmail — failed │",
    "gpt-5.5 - Nous Research sponge (http) - failed",
    "Session: 20260517_155650_397b3d Available Skills",
    "│ Available Skills │",
    "│ apple: app_control, shortcuts │",
    "data-science: jupyter-live-kernel",
    "software-development: code-review, debugging-hermes-tui-commands",
    "│ /Users/karimyahia/Documents/peripheral-framebuffer-mirror │",
    "77 tools · 138 skills · 3 MCP servers · /help for commands",
    "Welcome to Hermes Agent! Type your message or /help for commands.",
    "Tip: Type /help for commands.",
    "⚙️  /reasoning low",
    "  ✓ Reasoning effort set to 'low' (saved to config)",
    "⚙️  /fast fast",
    "  ✓ Priority Processing set to FAST (saved to config)",
    "🔄 MCP server config changed — reloading connections...",
    "🔄 Reloading MCP servers...",
    "  ♻️  Reconnected: agentphone, crustdata, moss",
    "  🔧 46 tool(s) available from 3 server(s)",
    "  ✅ Agent updated — 0 tool(s) available",
    "⚕ gpt-5.5 │ ctx -- │ [░░░░] -- │ 8s │ ⏲ 0s",
    "❯",
  ]),
  ["Hermes Agent v0.12.0 - upstream"],
);
assert.equal(mergeVoiceDraft("Hey", "Hey Hermes", "Hey"), "Hey Hermes");
assert.equal(mergeVoiceDraft("Hey Hermes", "I want you", "Hey Hermes"), "Hey Hermes I want you");
assert.equal(mergeVoiceDraft("One plus", "One plus one", "One plus"), "One plus one");
assert.equal(normalizeTmuxSessionName(" peripheral hud/hermes "), "peripheral_hud_hermes");
assert.equal(normalizeTmuxSessionName(".hud"), "peripheral_.hud");
assert.equal(normalizeTmuxSessionName("!!!"), null);
assert.ok((normalizeTmuxSessionName("x".repeat(120)) || "").length <= 80);

for (const invalidWidget of [
  { id: "bad-checklist", type: "checklist", title: "Bad", items: ["not an item"] },
  { id: "bad-approval", type: "approval_card", title: "Bad", choices: [{}] },
  { id: "bad-transcript", type: "live_call", title: "Bad", transcript: [{}] },
  { id: "bad-people", type: "people_list", title: "Bad", people: [{}] },
  { id: "bad-table", type: "table", title: "Bad", columns: ["A"], rows: [42] },
  { id: "bad-terminal", type: "terminal", title: "Bad", terminal: [42] },
]) {
  assert.throws(() => assertWidget(invalidWidget), /required|must be/);
}

const runtimeRoot = mkdtempSync(join(tmpdir(), "peripheral-hud-runtime-"));
try {
  const options = { projectRoot: runtimeRoot, displayMode: "mock" as const, inputMode: "text" as const };
  const paths = runtimePaths(runtimeRoot);
  await showHudCard("Hermes", "Visual result ready", options);
  assert.ok(existsSync(paths.currentWidgetPath), "showHudCard should write current-widget.json");
  const clear = await clearHud(options);
  assert.equal(clear.state, "blank");
  assert.ok(!existsSync(paths.currentWidgetPath), "clearHud should remove stale current-widget.json");
  assert.equal(JSON.parse(readFileSync(paths.statePath, "utf8")).state, "blank");
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true });
}

const hudArgs = [
  "dist/apps/peripheralctl/src/index.js",
  "hud",
  "--mock-display",
  "--text",
  "--mock-hermes",
  "--json",
  "--cadence-ms",
  "700",
];

const hudProjectRoot = makeTempProjectRoot("hud");
try {
  const hudRun = await runHudWithTimedInput([...hudArgs, ...projectRootArgs(hudProjectRoot)], [
    { input: "look_up\n", waitMs: 250 },
    { input: "Hermes test task\n", waitMs: 900 },
    { input: "status\n", waitMs: 1300 },
    { input: "make it shorter\n", waitMs: 350 },
    { input: "exit\n", waitMs: 0 },
  ]);
  assert.equal(hudRun.status, 0, hudRun.stderr);
  const hudResult = JSON.parse(hudRun.stdout.slice(hudRun.stdout.indexOf("{"))) as { state: string; logPath: string; paths: { currentWidgetPath: string } };
  assert.equal(hudResult.state, "blank");
  const hudLog = readFileSync(hudResult.logPath, "utf8");
  assert.match(hudLog, /"event":"display.clear","reason":"runtime.start"/);
  assert.match(hudLog, /"event":"agents.reset"/);
  assert.match(hudLog, /"state":"agent_hud"/);
  assert.match(hudLog, /"state":"active_agent"/);
  assert.match(hudLog, /"state":"dynamic_result"/);
  assert.match(hudLog, /"text":"status"/);
  assert.match(hudLog, /"reason":"make_it_shorter"/);
  assert.match(hudLog, /"event":"runtime.exit","reason":"exit"/);
  assert.ok(!existsSync(hudResult.paths.currentWidgetPath), "runtime exit should clear current-widget.json after a result");
} finally {
  rmSync(hudProjectRoot, { recursive: true, force: true });
}

const hermesCliProjectRoot = makeTempProjectRoot("hermes-cli");
try {
  const hermesCliRun = await runHudWithTimedInput([...hudArgs, ...projectRootArgs(hermesCliProjectRoot)], [
    { input: "open Hermes\n", waitMs: 350 },
    { input: "summarize this mock session\n", waitMs: 950 },
    { input: "close Hermes\n", waitMs: 250 },
    { input: "exit\n", waitMs: 0 },
  ]);
  assert.equal(hermesCliRun.status, 0, hermesCliRun.stderr);
  const hermesCliResult = JSON.parse(hermesCliRun.stdout.slice(hermesCliRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(hermesCliResult.state, "blank");
  const hermesCliLog = readFileSync(hermesCliResult.logPath, "utf8");
  assert.match(hermesCliLog, /"state":"terminal"/);
  assert.match(hermesCliLog, /"widgetId":"hermes-cli"/);
  assert.match(hermesCliLog, /"event":"hermes_cli.input"/);
  assert.match(hermesCliLog, /interactive CLI display path is wired/);
} finally {
  rmSync(hermesCliProjectRoot, { recursive: true, force: true });
}

const asrDemoProjectRoot = makeTempProjectRoot("asr-demo");
try {
  const asrDemoRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "asr-demo",
    "--mock-display",
    "--mock-hermes",
    "--script",
    join(root, "fixtures", "mock_asr_demo.txt"),
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(asrDemoProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(asrDemoRun.status, 0, asrDemoRun.stderr);
  const asrDemoResult = JSON.parse(asrDemoRun.stdout.slice(asrDemoRun.stdout.indexOf("{"))) as { state: string; logPath: string; script: { stepCount: number } };
  assert.equal(asrDemoResult.state, "terminal");
  assert.equal(asrDemoResult.script.stepCount, 5);
  const asrDemoLog = readFileSync(asrDemoResult.logPath, "utf8");
  assert.match(asrDemoLog, /"inputMode":"mock_asr"/);
  assert.match(asrDemoLog, /"event":"asr.mock.transcript"/);
  assert.match(asrDemoLog, /"event":"asr.voice_draft.update"/);
  assert.match(asrDemoLog, /"event":"asr.voice_command.send"/);
  assert.match(asrDemoLog, /"event":"hermes_cli.input"/);
  assert.doesNotMatch(asrDemoLog, /"event":"hermes_cli.input","mode":"mock","text":"send"/);
  assert.match(asrDemoLog, /"event":"hermes_cli.mock_response"/);
  assert.match(asrDemoLog, /asr_demo.awaiting_transcript/);
  assert.match(asrDemoLog, /"event":"asr_demo.complete"/);
} finally {
  rmSync(asrDemoProjectRoot, { recursive: true, force: true });
}

const fakeSttScript = [
  "setTimeout(() => console.log('Open'), 10)",
  "setTimeout(() => console.log('Hear me'), 90)",
  "setTimeout(() => console.log('ambient should be ignored'), 220)",
  "setTimeout(() => console.log('Hermes voice test prompt'), 350)",
  "setTimeout(() => console.log('send'), 480)",
  "setTimeout(() => console.log('close hermings'), 1200)",
].join(";");
const fakeSttCommand = JSON.stringify(process.execPath) + " -e " + JSON.stringify(fakeSttScript);
const voiceHudProjectRoot = makeTempProjectRoot("voice-hud");
try {
  const voiceHudRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--mock-display",
    "--mic",
    "mac",
    "--mock-hermes",
    "--stt-cmd",
    fakeSttCommand,
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(voiceHudProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(voiceHudRun.status, 0, voiceHudRun.stderr);
  const voiceHudResult = JSON.parse(voiceHudRun.stdout.slice(voiceHudRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(voiceHudResult.state, "blank");
  const voiceHudLog = readFileSync(voiceHudResult.logPath, "utf8");
  assert.match(voiceHudLog, /"event":"input.mic.start"/);
  assert.match(voiceHudLog, /"event":"input.mic.transcript"/);
  assert.match(voiceHudLog, /"event":"input.voice_command.pending","command":"open"/);
  assert.match(voiceHudLog, /"event":"input.voice_command.alias","text":"Hear me","command":"hermes"/);
  assert.match(voiceHudLog, /"event":"asr.voice_gate.ignored","text":"ambient should be ignored","reason":"waiting_for_hermes"/);
  assert.doesNotMatch(voiceHudLog, /"event":"hermes_cli.input","mode":"mock","text":"ambient should be ignored"/);
  assert.match(voiceHudLog, /"event":"asr.voice_gate.open","text":"Hermes voice test prompt","prompt":"voice test prompt"/);
  assert.match(voiceHudLog, /voice test prompt/);
  assert.match(voiceHudLog, /"event":"asr.voice_draft.update"/);
  assert.match(voiceHudLog, /"event":"asr.voice_command.send"/);
  assert.match(voiceHudLog, /"event":"hermes_cli.input"/);
  assert.match(voiceHudLog, /"event":"hermes_cli.input","mode":"mock","text":"voice test prompt"/);
  assert.doesNotMatch(voiceHudLog, /"event":"hermes_cli.input","mode":"mock","text":"send"/);
  assert.match(voiceHudLog, /"text":"close hermings"/);
  assert.match(voiceHudLog, /"event":"hermes_cli.close","reason":"input.dismiss"/);
} finally {
  rmSync(voiceHudProjectRoot, { recursive: true, force: true });
}

const fakeAliasSttScript = [
  "setTimeout(() => console.log('Pinot noir'), 10)",
  "setTimeout(() => console.log('close Hermes'), 140)",
  "setTimeout(() => console.log('Finn Hermes'), 280)",
  "setTimeout(() => console.log('close Hermes'), 410)",
  "setTimeout(() => console.log('Open for me'), 540)",
  "setTimeout(() => console.log('Close her'), 670)",
  "setTimeout(() => console.log('Okay well I will do this open'), 800)",
  "setTimeout(() => console.log('Hermes'), 930)",
  "setTimeout(() => console.log('Hear me say hello'), 1060)",
  "setTimeout(() => console.log('send'), 1190)",
  "setTimeout(() => console.log('Close her'), 1320)",
].join(";");
const fakeAliasSttCommand = JSON.stringify(process.execPath) + " -e " + JSON.stringify(fakeAliasSttScript);
const voiceAliasProjectRoot = makeTempProjectRoot("voice-alias");
try {
  const voiceAliasRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--mock-display",
    "--mic",
    "mac",
    "--mock-hermes",
    "--stt-cmd",
    fakeAliasSttCommand,
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(voiceAliasProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(voiceAliasRun.status, 0, voiceAliasRun.stderr);
  const voiceAliasResult = JSON.parse(voiceAliasRun.stdout.slice(voiceAliasRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(voiceAliasResult.state, "blank");
  const voiceAliasLog = readFileSync(voiceAliasResult.logPath, "utf8");
  assert.match(voiceAliasLog, /"event":"input.voice_command.alias","text":"Pinot noir","command":"open hermes"/);
  assert.match(voiceAliasLog, /"event":"input.voice_command.alias","text":"Finn Hermes","command":"open hermes"/);
  assert.match(voiceAliasLog, /"event":"input.voice_command.alias","text":"Open for me","command":"open hermes"/);
  assert.match(voiceAliasLog, /"text":"Close her"/);
  assert.match(voiceAliasLog, /"event":"input.voice_command.pending","command":"open"/);
  assert.match(voiceAliasLog, /"event":"asr.voice_gate.open","text":"Hear me say hello","prompt":"say hello"/);
  assert.match(voiceAliasLog, /"event":"hermes_cli.input","mode":"mock","text":"say hello"/);
  assert.match(voiceAliasLog, /"event":"hermes_cli.close","reason":"input.dismiss"/);
  assert.doesNotMatch(voiceAliasLog, /Unknown HUD command/);
} finally {
  rmSync(voiceAliasProjectRoot, { recursive: true, force: true });
}

const fakeOpenOnlySttScript = [
  "setTimeout(() => console.log('Open'), 10)",
  "setTimeout(() => console.log('close Hermes'), 1500)",
].join(";");
const fakeOpenOnlySttCommand = JSON.stringify(process.execPath) + " -e " + JSON.stringify(fakeOpenOnlySttScript);
const voiceOpenOnlyProjectRoot = makeTempProjectRoot("voice-open-only");
try {
  const voiceOpenOnlyRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--mock-display",
    "--mic",
    "mac",
    "--mock-hermes",
    "--stt-cmd",
    fakeOpenOnlySttCommand,
    "--json",
    "--cadence-ms",
    "700",
    ...projectRootArgs(voiceOpenOnlyProjectRoot),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(voiceOpenOnlyRun.status, 0, voiceOpenOnlyRun.stderr);
  const voiceOpenOnlyResult = JSON.parse(voiceOpenOnlyRun.stdout.slice(voiceOpenOnlyRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(voiceOpenOnlyResult.state, "blank");
  const voiceOpenOnlyLog = readFileSync(voiceOpenOnlyResult.logPath, "utf8");
  assert.match(voiceOpenOnlyLog, /"event":"input.voice_command.pending","command":"open"/);
  assert.match(voiceOpenOnlyLog, /"event":"input.voice_command.pending_timeout","command":"open","fallback":"open"/);
  assert.match(voiceOpenOnlyLog, /"state":"terminal"/);
  assert.match(voiceOpenOnlyLog, /"event":"hermes_cli.close","reason":"input.dismiss"/);
} finally {
  rmSync(voiceOpenOnlyProjectRoot, { recursive: true, force: true });
}

const openAiAsrSelfTest = spawnSync(process.execPath, [
  "tools/openai-realtime-asr.mjs",
  "--self-test",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 5_000,
});
assert.equal(openAiAsrSelfTest.status, 0, openAiAsrSelfTest.stderr);
assert.match(openAiAsrSelfTest.stdout, /openai realtime asr self-test ok/);

const exitProjectRoot = makeTempProjectRoot("exit");
try {
  const exitRun = spawnSync(process.execPath, [
    "dist/apps/peripheralctl/src/index.js",
    "hud",
    "--mock-display",
    "--text",
    "--json",
    ...projectRootArgs(exitProjectRoot),
  ], {
    cwd: root,
    input: "exit\n",
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(exitRun.status, 0, exitRun.stderr);
  const exitResult = JSON.parse(exitRun.stdout.slice(exitRun.stdout.indexOf("{"))) as { state: string; logPath: string };
  assert.equal(exitResult.state, "blank");
  assert.match(readFileSync(exitResult.logPath, "utf8"), /"event":"runtime.exit","reason":"exit"/);
} finally {
  rmSync(exitProjectRoot, { recursive: true, force: true });
}

console.log("renderer-smoke ok");

function runHudWithTimedInput(args: string[], script: { input: string; waitMs: number }[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectRun(new Error("Timed out waiting for HUD runtime"));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on("exit", (status) => {
      clearTimeout(timeout);
      resolveRun({ status, stdout, stderr });
    });
    void (async () => {
      for (const step of script) {
        child.stdin.write(step.input, "utf8");
        if (step.waitMs > 0) await delay(step.waitMs);
      }
      child.stdin.end();
    })().catch((error: unknown) => {
      child.kill("SIGTERM");
      rejectRun(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function makeTempProjectRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), "peripheral-hud-" + label + "-"));
}

function projectRootArgs(projectRoot: string): string[] {
  return ["--project-root", projectRoot, "--repo-root", resolve(root, "..")];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
