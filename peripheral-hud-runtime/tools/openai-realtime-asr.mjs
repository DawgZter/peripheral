#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const repoRoot = resolve(projectRoot, "..");

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

loadDefaultEnvFiles();

if (args["self-test"]) {
  runSelfTest();
  process.exit(0);
}

queueMicrotask(() => {
  const options = normalizeOptions(args);
  run(options).catch((error) => {
    stderr("openai realtime asr failed: " + (error?.message || String(error)));
    process.exitCode = 1;
  });
});

async function run(options) {
  if (options.listDevices) {
    await listAvfoundationDevices(options.ffmpeg);
    return;
  }
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set. Export it or pass --env-file <path>.");
  }

  const live = createLiveState(options);
  const socket = new MinimalWebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    { authorization: "Bearer " + key },
  );
  live.realtime = socket;
  socket.onText = (message) => handleRealtimeMessage(live, message);
  socket.onClose = (detail) => {
    if (!live.stopping) {
      stderr("realtime socket closed: " + JSON.stringify(detail));
    }
  };
  await socket.connect();
  socket.sendJson(buildSessionUpdate(options));
  stderr("streaming Mac mic to " + options.model + " (" + options.protocol + " session)");

  const audio = startAudioSource(options, (pcm) => sendAudio(live, pcm));
  live.audio = audio;

  const stopTimer = options.durationSeconds
    ? setTimeout(() => stopLive(live, "duration"), Math.max(100, options.durationSeconds * 1000))
    : null;

  await live.done;
  if (stopTimer) clearTimeout(stopTimer);
}

function normalizeOptions(source) {
  const model = String(
    source.model ||
      process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
      process.env.OPENAI_PERIPHERAL_ASR_MODEL ||
      "gpt-realtime-whisper",
  );
  const requestedProtocol = String(source.protocol || process.env.OPENAI_REALTIME_ASR_PROTOCOL || "auto");
  const protocol = requestedProtocol === "auto"
    ? model.startsWith("gpt-realtime-") ? "legacy" : "current"
    : requestedProtocol;
  if (!["current", "legacy"].includes(protocol)) {
    throw new Error("--protocol must be current, legacy, or auto.");
  }
  const sampleRate = clampNumber(source["sample-rate"] || process.env.OPENAI_REALTIME_ASR_PCM_RATE || 24000, 8000, 48000, 24000);
  const chunkMs = clampNumber(source["chunk-ms"] || process.env.OPENAI_REALTIME_ASR_CHUNK_MS || 120, 100, 250, 120);
  const commitMs = clampNumber(source["commit-ms"] || process.env.OPENAI_REALTIME_ASR_COMMIT_MS || 1200, 300, 5000, 1200);
  const language = normalizeLanguage(source.language || source.locale || process.env.OPENAI_REALTIME_ASR_LANGUAGE || "");
  return {
    model,
    protocol,
    language,
    prompt: String(source.prompt || process.env.OPENAI_REALTIME_ASR_PROMPT || ""),
    sampleRate,
    chunkMs,
    commitMs,
    threshold: clampNumber(source["vad-threshold"] || process.env.OPENAI_REALTIME_ASR_VAD_THRESHOLD || 0.5, 0, 1, 0.5),
    silenceMs: clampNumber(source["vad-silence-ms"] || process.env.OPENAI_REALTIME_ASR_VAD_SILENCE_MS || 500, 100, 3000, 500),
    prefixPaddingMs: clampNumber(source["vad-prefix-padding-ms"] || process.env.OPENAI_REALTIME_ASR_VAD_PREFIX_MS || 300, 0, 2000, 300),
    noiseReduction: normalizeNoiseReduction(source["noise-reduction"] || process.env.OPENAI_REALTIME_ASR_NOISE_REDUCTION || "near_field"),
    ffmpeg: String(source.ffmpeg || process.env.FFMPEG || "ffmpeg"),
    ffmpegInput: String(source["ffmpeg-input"] || process.env.OPENAI_REALTIME_ASR_FFMPEG_INPUT || "auto"),
    ffmpegFilter: String(source["ffmpeg-filter"] || process.env.OPENAI_REALTIME_ASR_FFMPEG_FILTER || ""),
    durationSeconds: source["duration-seconds"] === undefined ? 0 : clampNumber(source["duration-seconds"], 0.1, 3600, 0),
    partials: Boolean(source.partials),
    lineMode: source["line-mode"] !== false,
    listDevices: Boolean(source["list-devices"]),
  };
}

function buildSessionUpdate(options) {
  if (options.protocol === "legacy") {
    return {
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: options.sampleRate,
            },
            transcription: {
              model: options.model,
              ...(options.prompt ? { prompt: options.prompt } : {}),
              ...(options.language ? { language: options.language } : {}),
            },
            ...(options.noiseReduction ? { noise_reduction: { type: options.noiseReduction } } : {}),
          },
        },
      },
    };
  }

  return {
    type: "transcription_session.update",
    input_audio_format: "pcm16",
    input_audio_transcription: {
      model: options.model,
      prompt: options.prompt,
      language: options.language,
    },
    turn_detection: {
      type: "server_vad",
      threshold: options.threshold,
      prefix_padding_ms: options.prefixPaddingMs,
      silence_duration_ms: options.silenceMs,
    },
    ...(options.noiseReduction ? { input_audio_noise_reduction: { type: options.noiseReduction } } : {}),
  };
}

function createLiveState(options) {
  let resolveDone;
  const done = new Promise((resolveDonePromise) => {
    resolveDone = resolveDonePromise;
  });
  return {
    options,
    realtime: null,
    audio: null,
    pcmBuffer: Buffer.alloc(0),
    audioSinceCommitBytes: 0,
    lastCommitAt: Date.now(),
    activeSegments: new Map(),
    segments: [],
    stopping: false,
    resolveDone,
    done,
  };
}

function startAudioSource(options, onPcm) {
  const ffmpegInput = options.ffmpegInput === "auto" ? detectAvfoundationAudioInput(options.ffmpeg) : options.ffmpegInput;
  stderr("ffmpeg avfoundation input: " + ffmpegInput);
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "avfoundation",
    "-i",
    ffmpegInput,
  ];
  if (options.ffmpegFilter) args.push("-af", options.ffmpegFilter);
  args.push("-vn", "-ac", "1", "-ar", String(options.sampleRate), "-f", "s16le", "pipe:1");

  const child = spawn(options.ffmpeg, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", onPcm);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const clean = String(chunk).trim();
    if (clean) stderr("ffmpeg: " + clean);
  });
  child.on("error", (error) => {
    stderr("ffmpeg error: " + error.message);
  });
  child.on("exit", (code, signal) => {
    stderr("ffmpeg exited: " + JSON.stringify({ code, signal }));
  });
  return child;
}

function sendAudio(live, chunk) {
  if (!chunk.length || !live.realtime?.isOpen() || live.stopping) return;
  const options = live.options;
  live.pcmBuffer = Buffer.concat([live.pcmBuffer, chunk]);
  const chunkBytes = Math.max(960, Math.round(options.sampleRate * 2 * (options.chunkMs / 1000)));
  while (live.pcmBuffer.length >= chunkBytes) {
    const pcm = live.pcmBuffer.subarray(0, chunkBytes);
    live.pcmBuffer = live.pcmBuffer.subarray(chunkBytes);
    live.audioSinceCommitBytes += pcm.length;
    live.realtime.sendJson({
      type: "input_audio_buffer.append",
      audio: pcm.toString("base64"),
    });
    const commitBytes = Math.round(options.sampleRate * 2 * (options.commitMs / 1000));
    const staleCommitMs = Math.max(800, options.commitMs + 400);
    const commitReady = live.audioSinceCommitBytes >= Math.max(commitBytes, minCommitBytes(live));
    const staleCommitReady = live.audioSinceCommitBytes >= minCommitBytes(live) && Date.now() - live.lastCommitAt >= staleCommitMs;
    if (commitReady || staleCommitReady) {
      commitAudio(live);
    }
  }
}

function commitAudio(live) {
  if (!live.realtime?.isOpen() || !live.audioSinceCommitBytes || live.stopping) return;
  if (live.audioSinceCommitBytes < minCommitBytes(live)) return;
  live.audioSinceCommitBytes = 0;
  live.lastCommitAt = Date.now();
  live.realtime.sendJson({ type: "input_audio_buffer.commit" });
}

function minCommitBytes(live) {
  return Math.ceil(live.options.sampleRate * 2 * 0.11);
}

function handleRealtimeMessage(live, message) {
  let event;
  try {
    event = JSON.parse(message);
  } catch {
    return;
  }
  const eventType = String(event.type || "");
  if (eventType === "error") {
    const message = event.error?.message || "Realtime error";
    stderr("realtime error: " + message);
    return;
  }
  if (eventType === "session.created" || eventType === "session.updated" || eventType === "transcription_session.updated") {
    stderr(eventType);
    return;
  }

  const text = realtimeEventText(event);
  const isTranscriptEvent = eventType.includes("transcription") || eventType.includes("transcript");
  if (!isTranscriptEvent || !text) return;

  const key = event.item_id || event.item?.id || event.response_id || event.content_index || "default";
  if (eventType.endsWith(".delta")) {
    if (live.options.partials) {
      const next = (live.activeSegments.get(key) || "") + text;
      live.activeSegments.set(key, next);
      stderr("partial: " + cleanLine(next, 240));
    }
    return;
  }

  if (eventType.endsWith(".completed") || eventType.endsWith(".done") || event.transcript || event.text) {
    const finalText = cleanLine(text || live.activeSegments.get(key) || "", 1000);
    live.activeSegments.delete(key);
    if (finalText) {
      live.segments.push(finalText);
      if (live.options.lineMode) {
        process.stdout.write(finalText + "\n");
      } else {
        process.stdout.write(JSON.stringify({ text: finalText, eventType }) + "\n");
      }
    }
  }
}

function realtimeEventText(event) {
  if (typeof event.transcript === "string") return event.transcript;
  if (typeof event.text === "string") return event.text;
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.audio_transcript === "string") return event.audio_transcript;
  const content = Array.isArray(event.item?.content) ? event.item.content : [];
  return content.map((part) => part?.transcript || part?.text || "").join("");
}

function stopLive(live, reason) {
  if (live.stopping) return;
  live.stopping = true;
  stderr("stopping: " + reason);
  if (live.pcmBuffer.length) {
    live.audioSinceCommitBytes += live.pcmBuffer.length;
    live.realtime?.sendJson({
      type: "input_audio_buffer.append",
      audio: live.pcmBuffer.toString("base64"),
    });
    live.pcmBuffer = Buffer.alloc(0);
  }
  commitAudio(live);
  live.audio?.kill("SIGTERM");
  setTimeout(() => {
    live.realtime?.close();
    live.resolveDone();
  }, 300);
}

function runSelfTest() {
  const legacy = buildSessionUpdate({
    model: "gpt-realtime-whisper",
    protocol: "legacy",
    sampleRate: 24000,
    prompt: "",
    language: "en",
    noiseReduction: "near_field",
  });
  const current = buildSessionUpdate({
    model: "gpt-4o-transcribe",
    protocol: "current",
    sampleRate: 24000,
    prompt: "",
    language: "en",
    threshold: 0.5,
    prefixPaddingMs: 300,
    silenceMs: 500,
    noiseReduction: "near_field",
  });
  if (legacy.type !== "session.update") throw new Error("legacy session payload mismatch");
  if (current.type !== "transcription_session.update") throw new Error("current session payload mismatch");
  const live = createLiveState({ partials: false, lineMode: false });
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    handleRealtimeMessage(live, JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "voice test prompt",
      item_id: "item_1",
    }));
  } finally {
    process.stdout.write = originalWrite;
  }
  if (!writes.join("").includes("voice test prompt")) {
    throw new Error("transcript parser did not emit final line");
  }
  process.stdout.write("openai realtime asr self-test ok\n");
}

async function listAvfoundationDevices(ffmpeg) {
  await new Promise((resolveList) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", () => resolveList());
    child.on("error", (error) => {
      stderr(error.message);
      resolveList();
    });
  });
}

function detectAvfoundationAudioInput(ffmpeg) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
    encoding: "utf8",
    timeout: 8000,
  });
  const output = String(result.stderr || result.stdout || "");
  const devices = [];
  let inAudio = false;
  for (const line of output.split(/\r?\n/)) {
    if (line.includes("AVFoundation audio devices:")) {
      inAudio = true;
      continue;
    }
    if (line.includes("AVFoundation video devices:")) {
      inAudio = false;
      continue;
    }
    if (!inAudio) continue;
    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match) devices.push({ index: match[1], name: match[2].trim() });
  }
  const excluded = /(aggregate|blackhole|teams|zoom|screen|capture)/i;
  const preferred =
    devices.find((device) => /macbook.*microphone/i.test(device.name)) ||
    devices.find((device) => /microphone/i.test(device.name) && !excluded.test(device.name)) ||
    devices.find((device) => !excluded.test(device.name)) ||
    devices[0];
  if (!preferred) return ":0";
  return ":" + preferred.index;
}

class MinimalWebSocket {
  constructor(url, headers = {}) {
    this.url = new URL(url);
    this.headers = headers;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.closed = false;
    this.onText = null;
    this.onClose = null;
  }

  connect() {
    return new Promise((resolveConnect, rejectConnect) => {
      const key = randomBytes(16).toString("base64");
      const requestHeaders = [
        "GET " + this.url.pathname + this.url.search + " HTTP/1.1",
        "Host: " + this.url.host,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: " + key,
        "Sec-WebSocket-Version: 13",
      ];
      for (const [name, value] of Object.entries(this.headers)) {
        requestHeaders.push(name + ": " + value);
      }
      requestHeaders.push("\r\n");

      const socket = tlsConnect({ host: this.url.hostname, port: Number(this.url.port || 443), servername: this.url.hostname });
      this.socket = socket;
      let handshake = Buffer.alloc(0);
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          rejectConnect(error);
        } else {
          this.onClose?.({ error: error.message });
        }
      };
      socket.once("secureConnect", () => socket.write(requestHeaders.join("\r\n")));
      socket.on("data", (chunk) => {
        if (!this.connected) {
          handshake = Buffer.concat([handshake, chunk]);
          const end = handshake.indexOf("\r\n\r\n");
          if (end < 0) return;
          const head = handshake.subarray(0, end).toString("utf8");
          const status = head.split(/\r?\n/, 1)[0] || "";
          if (!/ 101 /.test(status)) {
            fail(new Error("WebSocket handshake failed: " + status));
            socket.end();
            return;
          }
          this.connected = true;
          settled = true;
          resolveConnect();
          const rest = handshake.subarray(end + 4);
          if (rest.length) this.readFrames(rest);
          return;
        }
        this.readFrames(chunk);
      });
      socket.on("error", fail);
      socket.on("close", () => {
        this.closed = true;
        this.connected = false;
        this.onClose?.({ closed: true });
      });
    });
  }

  isOpen() {
    return this.connected && !this.closed && this.socket && !this.socket.destroyed;
  }

  sendJson(payload) {
    this.sendText(JSON.stringify(payload));
  }

  sendText(message) {
    if (this.isOpen()) this.socket.write(this.frame(Buffer.from(message, "utf8"), 0x1));
  }

  sendPong(payload) {
    if (this.isOpen()) this.socket.write(this.frame(payload, 0x0a));
  }

  close() {
    if (this.isOpen()) {
      this.socket.write(this.frame(Buffer.alloc(0), 0x8));
      this.socket.end();
    }
  }

  frame(payload, opcode) {
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    const mask = randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4];
    }
    return Buffer.concat([header, mask, masked]);
  }

  readFrames(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let mask;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
          unmasked[index] = payload[index] ^ mask[index % 4];
        }
        payload = unmasked;
      }
      if (opcode === 0x1) this.onText?.(payload.toString("utf8"));
      else if (opcode === 0x8) this.close();
      else if (opcode === 0x9) this.sendPong(payload);
    }
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const name = rawName.trim();
    if (!name) continue;
    if (inlineValue !== undefined) {
      parsed[name] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--") && valueFlag(name)) {
      parsed[name] = next;
      index += 1;
    } else {
      parsed[name] = true;
    }
  }
  return parsed;
}

function valueFlag(name) {
  return new Set([
    "model",
    "protocol",
    "language",
    "locale",
    "prompt",
    "sample-rate",
    "chunk-ms",
    "commit-ms",
    "duration-seconds",
    "vad-threshold",
    "vad-silence-ms",
    "vad-prefix-padding-ms",
    "noise-reduction",
    "ffmpeg",
    "ffmpeg-input",
    "ffmpeg-filter",
    "env-file",
  ]).has(name);
}

function loadDefaultEnvFiles() {
  const candidates = [
    args["env-file"],
    process.env.OPENAI_ENV_FILE,
    join(projectRoot, ".env"),
    join(repoRoot, ".env"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    loadDotEnv(resolve(String(candidate)));
  }
}

function loadDotEnv(path) {
  if (!path || !existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const match = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeLanguage(value) {
  const language = String(value || "").trim();
  if (!language) return "";
  return language.split(/[-_]/, 1)[0].toLowerCase();
}

function normalizeNoiseReduction(value) {
  const clean = String(value || "").trim();
  if (!clean || clean === "none" || clean === "off" || clean === "false") return "";
  if (clean === "near_field" || clean === "far_field") return clean;
  return "near_field";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanLine(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stderr(message) {
  process.stderr.write(String(message) + "\n");
}

function printHelp() {
  process.stdout.write([
    "openai-realtime-asr - line-based Mac mic ASR via OpenAI Realtime",
    "",
    "Usage:",
    "  node tools/openai-realtime-asr.mjs --line-mode",
    "  node tools/openai-realtime-asr.mjs --line-mode --model gpt-realtime-whisper --duration-seconds 30",
    "  node tools/openai-realtime-asr.mjs --self-test",
    "",
    "Options:",
    "  --model <id>              Default: gpt-realtime-whisper.",
    "  --protocol <mode>         auto, legacy, or current. auto uses legacy for gpt-realtime-*.",
    "  --language <code>         Optional language hint. en-US is normalized to en.",
    "  --env-file <path>         Load OPENAI_API_KEY from a dotenv file.",
    "  --ffmpeg-input <input>    avfoundation input. Default auto, preferring the MacBook microphone.",
    "  --sample-rate <hz>        PCM16 sample rate. Default 24000.",
    "  --commit-ms <ms>          Manual audio commit cadence. Default 1200.",
    "  --partials                Log partial transcripts to stderr.",
    "  --duration-seconds <n>    Stop after n seconds.",
    "  --list-devices            Print avfoundation devices to stderr.",
    "",
  ].join("\n"));
}
