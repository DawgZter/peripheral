import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { PERIPHERAL_DISPLAY } from "../../peripheral-protocol/src/index.js";
import type { RenderArtifact } from "../../peripheral-renderer/src/index.js";

export type DriverOptions = {
  projectRoot: string;
  repoRoot?: string;
  mock?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
  logPath?: string;
  imagePrefixHex?: string;
  writeWithoutResponse?: boolean;
  timeoutSeconds?: number;
};

export type ImageFrameBuild = {
  compressed: Buffer;
  payload: Buffer;
  frames: Buffer[];
  compressionMode: "auto" | "store";
  imagePrefixHex: string;
};

export type FullPanelSetupPolicy = {
  setupEnabled: boolean;
  waitForSurfaceReady: boolean;
  setupStrategy: string;
  fullPanelPrimedBeforePush: boolean;
  markPrimedAfterSuccess: boolean;
};

const FIRST_CHUNK_BYTES = 497;
const CHUNK_BYTES = 501;
const MAC_RAW_WRITE = "__PERIPHERAL_RAW_WRITE__:";
const MAC_RAW_WRITE_NR = "__PERIPHERAL_RAW_WRITE_NR__:";
const MAC_WAIT_APP_STATUS = "__PERIPHERAL_WAIT_APP_STATUS__:";
const FULL_PANEL_SURFACE = 0xfe;
let fullPanelPrimedForSkippedSetup = false;

export function defaultLogPath(projectRoot: string, name = "peripheralctl"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(projectRoot, "out", "logs", `${stamp}-${name}.jsonl`);
}

export async function appendJsonl(logPath: string, event: Record<string, unknown>): Promise<void> {
  mkdirSync(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf8");
}

export function loadFrameArtifact(pngPath: string): RenderArtifact {
  const sidecar = resolve(pngPath).replace(/\.png$/i, "") + ".frame.json";
  if (!existsSync(sidecar)) {
    throw new Error(`Missing frame sidecar ${sidecar}. Render with peripheralctl render-json first.`);
  }
  return JSON.parse(readFileSync(sidecar, "utf8")) as RenderArtifact;
}

export async function mockPush(imagePath: string, options: DriverOptions, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const logPath = options.logPath || defaultLogPath(options.projectRoot);
  const event = {
    event: "push.mock",
    imagePath: resolve(imagePath),
    mode: options.dryRun ? "dry-run" : "mock",
    ...extra,
  };
  await appendJsonl(logPath, event);
  return { ok: true, mock: true, logPath, imagePath: resolve(imagePath) };
}

export async function showImage(imagePath: string, options: DriverOptions): Promise<Record<string, unknown>> {
  const hasSidecar = existsSync(resolve(imagePath).replace(/\.png$/i, "") + ".frame.json");
  const artifact = hasSidecar ? loadFrameArtifact(imagePath) : null;
  if (options.mock || options.dryRun || !artifact) {
    return mockPush(imagePath, options, {
      hasFrameSidecar: Boolean(artifact),
      note: artifact ? "Rendered frame is pushable." : "Local review accepted an arbitrary image path; live push requires a .frame.json sidecar.",
    });
  }
  return pushArtifact(artifact, options);
}

export async function pushArtifact(artifact: RenderArtifact, options: DriverOptions): Promise<Record<string, unknown>> {
  const sourcePixels = Buffer.from(artifact.pixelsBase64, "base64");
  const devicePixels = invertPacked2Bpp(sourcePixels);
  const built = buildDisplayImageFrames(devicePixels, {
    width: artifact.width,
    height: artifact.height,
    imagePrefixHex: options.imagePrefixHex || PERIPHERAL_DISPLAY.imagePrefixHex,
    compressionMode: "auto",
  });
  const summary = {
    widgetId: artifact.widgetId,
    widgetType: artifact.widgetType,
    width: artifact.width,
    height: artifact.height,
    rawBytes: sourcePixels.length,
    compressedBytes: built.compressed.length,
    payloadBytes: built.payload.length,
    frames: built.frames.length,
    imagePrefixHex: built.imagePrefixHex,
    pixelPolarity: "device_inverted_2bpp",
    sha256: sha256(sourcePixels),
    deviceSha256: sha256(devicePixels),
  };
  if (options.mock || options.dryRun) {
    return mockPush(artifact.pngPath, options, { event: "push.mock_artifact", ...summary });
  }
  const result = await pushFramesToMac(built.frames, options);
  const logPath = options.logPath || defaultLogPath(options.projectRoot);
  await appendJsonl(logPath, { event: "push.real_artifact", ...summary, result });
  return { ok: true, ...summary, result, logPath };
}

export async function clearDisplay(options: DriverOptions): Promise<Record<string, unknown>> {
  const logPath = options.logPath || defaultLogPath(options.projectRoot);
  if (options.mock || options.dryRun) {
    await appendJsonl(logPath, { event: "clear.mock" });
    return { ok: true, mock: true, logPath };
  }
  const blankPixels = Buffer.alloc(PERIPHERAL_DISPLAY.rawBytes, 0);
  const devicePixels = invertPacked2Bpp(blankPixels);
  const built = buildDisplayImageFrames(devicePixels, {
    width: PERIPHERAL_DISPLAY.width,
    height: PERIPHERAL_DISPLAY.height,
    imagePrefixHex: options.imagePrefixHex || PERIPHERAL_DISPLAY.imagePrefixHex,
    compressionMode: "auto",
  });
  const result = await pushFramesToMac(built.frames, options);
  await appendJsonl(logPath, {
    event: "clear.real",
    route: "full_panel_blank",
    imagePrefixHex: built.imagePrefixHex,
    pixelPolarity: "device_inverted_2bpp",
    deviceSha256: sha256(devicePixels),
    compressedBytes: built.compressed.length,
    frames: built.frames.length,
    result,
  });
  return { ok: true, result, logPath };
}

export async function status(options: DriverOptions): Promise<Record<string, unknown>> {
  const repoRoot = options.repoRoot || resolve(options.projectRoot, "..");
  const helperPath = helperBinaryPath(repoRoot);
  const result = {
    ok: true,
    mock: Boolean(options.mock),
    helperPath,
    helperExists: existsSync(helperPath),
    display: PERIPHERAL_DISPLAY,
    note: options.mock
      ? "Local review status reports helper configuration without touching live display transport."
      : "Real connection status is intentionally left to system tools before live pushes.",
  };
  const logPath = options.logPath || defaultLogPath(options.projectRoot);
  await appendJsonl(logPath, { event: "status", ...result });
  return { ...result, logPath };
}

export function buildDisplayImageFrames(pixels: Buffer, options: {
  width?: number;
  height?: number;
  imagePrefixHex?: string;
  compressionMode?: "auto" | "store";
} = {}): ImageFrameBuild {
  const width = options.width || PERIPHERAL_DISPLAY.width;
  const height = options.height || PERIPHERAL_DISPLAY.height;
  const expected = Math.ceil((width * height * PERIPHERAL_DISPLAY.bitsPerPixel) / 8);
  if (pixels.length !== expected) {
    throw new Error(`invalid packed image length: expected ${expected}, got ${pixels.length}`);
  }
  const compressionMode = options.compressionMode || "auto";
  const compressed = deflateSync(pixels, compressionMode === "store" ? { level: 0 } : undefined);
  const prefix = Buffer.from((options.imagePrefixHex || PERIPHERAL_DISPLAY.imagePrefixHex).replace(/[^0-9a-f]/gi, ""), "hex");
  if (prefix.length !== 4) {
    throw new Error("imagePrefixHex must be exactly four bytes / eight hex chars");
  }
  const header = Buffer.alloc(19);
  prefix.copy(header, 0);
  header[4] = 0x16;
  header.writeUInt16LE(width, 5);
  header.writeUInt16LE(height, 7);
  header[9] = PERIPHERAL_DISPLAY.bitsPerPixel;
  header[10] = 0x07;
  header.writeUInt32LE(expected, 11);
  header.writeUInt32LE(compressed.length, 15);
  const payload = Buffer.concat([header, compressed]);
  return {
    compressed,
    payload,
    frames: imagePayloadFrames(payload),
    compressionMode,
    imagePrefixHex: prefix.toString("hex"),
  };
}

export function invertPacked2Bpp(pixels: Buffer): Buffer {
  const inverted = Buffer.allocUnsafe(pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    inverted[index] = pixels[index]! ^ 0xff;
  }
  return inverted;
}

function imagePayloadFrames(payload: Buffer): Buffer[] {
  if (payload.length <= FIRST_CHUNK_BYTES) {
    return [commandFrame(0x07, 0x04, payload)];
  }
  const frames: Buffer[] = [];
  let offset = 0;
  const firstChunk = payload.subarray(0, FIRST_CHUNK_BYTES);
  frames.push(outerFrame(Buffer.concat([
    Buffer.from([0x07, 0x04, payload.length & 0xff, (payload.length >> 8) & 0xff]),
    firstChunk,
  ]), 1));
  offset += firstChunk.length;
  let fragmentIndex = 2;
  while (offset < payload.length) {
    const chunk = payload.subarray(offset, Math.min(offset + CHUNK_BYTES, payload.length));
    offset += chunk.length;
    const isLast = offset >= payload.length;
    frames.push(outerFrame(chunk, isLast ? 0 : fragmentIndex));
    if (!isLast) fragmentIndex += 1;
  }
  return frames;
}

async function pushFramesToMac(frames: Buffer[], options: DriverOptions): Promise<Record<string, unknown>> {
  const start = performance.now();
  const writePrefix = options.writeWithoutResponse ? MAC_RAW_WRITE_NR : MAC_RAW_WRITE;
  const setupPolicy = fullPanelSetupPolicy();
  const result = await withMacBridge(options, { includeInit: false }, async (bridge) => {
    if (setupPolicy.setupEnabled) {
      await bridge.writeLine(MAC_RAW_WRITE + commandFrame(0x07, 0x01, [FULL_PANEL_SURFACE, 0x00]).toString("hex"));
      if (setupPolicy.waitForSurfaceReady) {
        await bridge.writeLine(MAC_WAIT_APP_STATUS + "fe:01:8");
      }
    }
    for (const frame of frames) {
      await bridge.writeLine(writePrefix + frame.toString("hex"));
    }
    if (setupPolicy.setupEnabled) {
      await bridge.writeLine(MAC_RAW_WRITE + commandFrame(0x07, 0x07, [FULL_PANEL_SURFACE]).toString("hex"));
    }
    return {
      queued: true,
      setupFrames: setupPolicy.setupEnabled ? 1 : 0,
      setupWaits: setupPolicy.setupEnabled && setupPolicy.waitForSurfaceReady ? 1 : 0,
      refreshFrames: setupPolicy.setupEnabled ? 1 : 0,
      setupStrategy: setupPolicy.setupStrategy,
      fullPanelPrimedBeforePush: setupPolicy.fullPanelPrimedBeforePush,
      imageFrames: frames.length,
      writeWithoutResponse: Boolean(options.writeWithoutResponse),
    };
  });
  if (setupPolicy.markPrimedAfterSuccess) fullPanelPrimedForSkippedSetup = true;
  return { ...result, elapsedMs: Math.round(performance.now() - start) };
}

export function fullPanelSetupPolicy(skipSurfaceSetup = process.env.PERIPHERAL_HUD_SKIP_SURFACE_SETUP, alreadyPrimed = fullPanelPrimedForSkippedSetup): FullPanelSetupPolicy {
  const skip = String(skipSurfaceSetup || "").toLowerCase();
  if (skip === "always" || skip === "force") {
    return {
      setupEnabled: false,
      waitForSurfaceReady: false,
      setupStrategy: "skipped_by_env_forced",
      fullPanelPrimedBeforePush: false,
      markPrimedAfterSuccess: false,
    };
  }
  if (skip === "1" || skip === "true" || skip === "yes") {
    if (alreadyPrimed) {
      return {
        setupEnabled: false,
        waitForSurfaceReady: false,
        setupStrategy: "skipped_by_env_after_initial_resync",
        fullPanelPrimedBeforePush: true,
        markPrimedAfterSuccess: false,
      };
    }
    return {
      setupEnabled: true,
      waitForSurfaceReady: false,
      setupStrategy: "factory_hidden_initial_resync_no_wait",
      fullPanelPrimedBeforePush: false,
      markPrimedAfterSuccess: true,
    };
  }
  return {
    setupEnabled: true,
    waitForSurfaceReady: true,
    setupStrategy: "factory_hidden_wait_fe01",
    fullPanelPrimedBeforePush: false,
    markPrimedAfterSuccess: false,
  };
}

type Bridge = {
  writeLine: (line: string) => Promise<void>;
  stdout: () => string;
  stderr: () => string;
};

type BridgeOptions = {
  includeInit?: boolean;
};

async function withMacBridge<T extends Record<string, unknown>>(options: DriverOptions, bridgeOptions: BridgeOptions, callback: (bridge: Bridge) => Promise<T>): Promise<T & { bridgeStdout: string; bridgeStderr: string }> {
  const repoRoot = options.repoRoot || resolve(options.projectRoot, "..");
  const helperPath = helperBinaryPath(repoRoot);
  if (!existsSync(helperPath)) {
    throw new Error(`Missing peripheral-mac-pusher helper at ${helperPath}. Build it with macos_corebluetooth/peripheral-mac-pusher/build.sh.`);
  }
  const args = [
    "--stdin",
    "--with-response",
    "--name-prefix",
    process.env.PERIPHERAL_MAC_NAME_PREFIX || "Peripheral",
    "--timeout",
    String(options.timeoutSeconds || 120),
  ];
  if (bridgeOptions.includeInit === false) {
    args.push("--no-init");
  }
  const child = spawn(helperPath, args, {
    cwd: dirname(helperPath),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    if (options.verbose) process.stderr.write(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    if (options.verbose) process.stderr.write(chunk);
  });

  await waitFor(() => stdout.includes("Stream stdin ready"), 30_000, () => {
    if (child.exitCode !== null) {
      throw new Error(`Mac bridge exited early with code ${child.exitCode}: ${stderr || stdout}`);
    }
  });

  const bridge: Bridge = {
    writeLine(line: string) {
      return new Promise((resolveWrite, rejectWrite) => {
        child.stdin.write(String(line).replace(/\r?\n/g, " ") + "\n", "utf8", (error) => {
          if (error) rejectWrite(error);
          else resolveWrite();
        });
      });
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };

  try {
    const result = await callback(bridge);
    child.stdin.end();
    const exitTimeoutMs = Math.min(Math.max((options.timeoutSeconds || 120) * 1000, 15_000), 180_000);
    const exited = await waitForExit(child, exitTimeoutMs);
    if (!exited) {
      throw new Error(`Mac bridge did not finish draining queued writes within ${exitTimeoutMs}ms`);
    }
    if (child.exitCode !== 0) {
      throw new Error(`Mac bridge exited with code ${child.exitCode}: ${bridge.stderr() || bridge.stdout()}`);
    }
    return { ...result, bridgeStdout: bridge.stdout(), bridgeStderr: bridge.stderr() };
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

function helperBinaryPath(repoRoot: string): string {
  return join(repoRoot, "macos_corebluetooth", "peripheral-mac-pusher", ".build", "manual", "peripheral-mac-pusher");
}

function commandFrame(group: number, command: number, payload: Buffer | number[] = []): Buffer {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const body = Buffer.alloc(4 + payloadBuffer.length);
  body[0] = group & 0xff;
  body[1] = command & 0xff;
  body.writeUInt16LE(payloadBuffer.length, 2);
  payloadBuffer.copy(body, 4);
  return outerFrame(body, 0);
}

function outerFrame(body: Buffer, fragmentIndex = 0): Buffer {
  const frame = Buffer.alloc(8 + body.length);
  frame[0] = 0xbf;
  frame[1] = 0x02;
  frame.writeUInt16LE(body.length, 2);
  frame.writeUInt16LE(crc16Ccitt(body), 4);
  frame.writeUInt16LE(fragmentIndex & 0xffff, 6);
  body.copy(frame, 8);
  return frame;
}

function crc16Ccitt(bytes: Buffer): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function waitFor(check: () => boolean, timeoutMs: number, tick?: () => void): Promise<void> {
  const start = performance.now();
  while (!check()) {
    tick?.();
    if (performance.now() - start > timeoutMs) throw new Error("Timed out waiting for Mac display bridge readiness");
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return await new Promise<boolean>((resolveExit) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

export async function writeLatencyMarkdown(path: string, rows: Record<string, unknown>[], interpretation: string): Promise<void> {
  const mode = rows.some((row) => row.pushMode === "real") ? "real transport" : "runtime display";
  const lines = [
    "# Latency Measurement",
    "",
    "Generated by `peripheralctl measure-latency`. This file is regenerated by the CLI.",
    "",
    `Latest run mode: ${mode}.`,
    "",
    "| case | route | render+png ms | encode ms | compressed bytes | payload bytes | frames | push/log ms | mode |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.case} | ${row.route} | ${row.renderMs} | ${row.encodeMs} | ${row.compressedBytes} | ${row.payloadBytes} | ${row.frames} | ${row.pushMs} | ${row.pushMode || mode} |`),
    "",
    "## Interpretation",
    "",
    interpretation,
    "",
    "## What This Measures",
    "",
    "- Renderer time includes deterministic semantic widget validation, raster drawing, PNG writing, and `.frame.json` sidecar creation.",
    "- Encode time builds the 2 bpp zlib `0704` image envelope and transport-fragment list in process.",
    "- Runtime push time measures JSONL logging and driver overhead only.",
    "- Real push time, when explicitly permitted, includes the existing Mac display helper, setup wait, writes, and ACK-gated bridge completion.",
    "",
    "## Live Transport Gate",
    "",
    "Runtime display mode measures the semantic renderer, encoded payload shape, and driver overhead while live transport airtime, `2022` ACK latency, `0602:fe01` wait duration, and wearer-visible refresh stay behind the explicit live-glasses permission gate.",
    "",
    "## Route Notes",
    "",
    "- Default v0 route: full-panel image surface, `540x280`, 2 bpp, raw 37,800 bytes, prefix `fe000000`.",
    "- Alternate route to test if full panel is too slow: captured map/widget image surface, `304x179`, 2 bpp, raw 13,604 bytes, prefix `00000080`.",
    "- Native/text UI remains the next backend if full-frame bitmap swaps are not visually live enough.",
    "",
    "## Real Hardware Gate",
    "",
    "Real transport latency tests require explicit operator permission. Legacy latency and direct image-push commands require omitting `--local` and adding `--real-hardware-ok` so this cannot happen accidentally; the HUD runtime uses the explicit `--real` switch for live display.",
    "",
  ];
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, lines.join("\n"), "utf8");
}
