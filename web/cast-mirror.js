const WIDTH = 540;
const HEIGHT = 280;
const ROW_BYTES = WIDTH / 2;
const TOTAL_BYTES = ROW_BYTES * HEIGHT;
const WIDE_SCAN_ROI = { x0: 12, y0: 88, x1: WIDTH, y1: 252 };
const FALLBACK_TEXT_ROI = { x0: 12, y0: 96, x1: WIDTH, y1: 246 };

const state = {
  running: false,
  stopping: false,
  source: null,
  cameraStream: null,
  animationFrame: 0,
  raw: new Uint8Array(TOTAL_BYTES),
  frameTimes: [],
  activeRoi: null,
  latestBbox: null,
  latestFrameAt: 0,
  streamEpoch: 0,
  streamPhase: "idle",
  blankFrames: 0,
  edgeFrames: 0,
  lastWideScanAt: 0,
};

const $ = (id) => document.getElementById(id);
const canvas = $("stageCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const video = $("cameraVideo");
const frameCanvas = document.createElement("canvas");
const frameCtx = frameCanvas.getContext("2d");
const frameImage = frameCtx.createImageData(WIDTH, HEIGHT);

frameCanvas.width = WIDTH;
frameCanvas.height = HEIGHT;

bindEvents();
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
refreshCameraList().catch(() => {});
draw();

function bindEvents() {
  $("startButton").addEventListener("click", start);
  $("stopButton").addEventListener("click", stop);
  $("cameraSelect").addEventListener("change", () => {
    if (state.running) {
      startCamera().catch((error) => setStatus("Camera error", error.message, true));
    }
  });
  for (const id of ["scaleInput", "offsetXInput", "offsetYInput"]) {
    $(id).addEventListener("input", draw);
  }
}

async function start() {
  if (state.running) {
    return;
  }
  state.running = true;
  state.stopping = false;
  state.streamEpoch += 1;
  state.raw.fill(0);
  state.frameTimes = [];
  state.blankFrames = 0;
  state.edgeFrames = 0;
  state.latestBbox = null;
  state.activeRoi = null;
  state.lastWideScanAt = 0;
  $("startButton").disabled = true;
  $("stopButton").disabled = false;
  $("cameraSelect").disabled = true;
  $("liveDot").classList.add("is-live");
  setStatus("Starting", "camera");

  try {
    const config = await fetchJson("/api/config");
    if (config.displayTransport !== "mac") {
      throw new Error("display transport is " + (config.displayTransport || "unknown"));
    }
    await ensureGlassesConnected();
    await startCamera();
    $("cameraSelect").disabled = false;
    startRenderLoop();
    runAdaptiveMirror(state.streamEpoch).catch((error) => {
      if (state.running) {
        setStatus("Stream error", error.message, true);
        stop();
      }
    });
  } catch (error) {
    setStatus("Start failed", error.message, true);
    stop();
  }
}

async function ensureGlassesConnected() {
  setStatus("Connecting", "glasses");
  const status = await fetchJson("/api/glasses/status");
  if (Array.isArray(status.connected) && status.connected.length > 0) {
    setStatus("Connected", status.connected[0].name || "glasses");
    return status;
  }

  setStatus("Pairing", "glasses");
  const payload = await fetchJson("/api/glasses/pair-connect", {
    method: "POST",
    body: JSON.stringify({ timeoutSeconds: 45 }),
  });
  if (Array.isArray(payload.connected) && payload.connected.length > 0) {
    setStatus("Connected", payload.connected[0].name || "glasses");
    return payload;
  }

  const failedStep = Array.isArray(payload.steps) ? payload.steps.find((step) => !step.ok) : null;
  throw new Error(failedStep?.name ? "glasses not connected: " + failedStep.name : "glasses not connected");
}

function stop() {
  state.stopping = true;
  state.running = false;
  state.streamEpoch += 1;
  if (state.source) {
    state.source.close();
    state.source = null;
  }
  if (state.animationFrame) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }
  stopCamera();
  $("startButton").disabled = false;
  $("stopButton").disabled = true;
  $("cameraSelect").disabled = false;
  $("liveDot").classList.remove("is-live");
  state.streamPhase = "idle";
  updateTelemetry();
  if (!state.stopping) {
    setStatus("Idle", "");
  } else {
    setStatus("Idle", "");
    state.stopping = false;
  }
  draw();
}

function startRenderLoop() {
  if (state.animationFrame) {
    return;
  }
  const loop = () => {
    draw();
    state.animationFrame = state.running ? window.requestAnimationFrame(loop) : 0;
  };
  state.animationFrame = window.requestAnimationFrame(loop);
}

async function startCamera() {
  stopCamera();
  setStatus("Starting", "camera");
  const selectedDeviceId = $("cameraSelect").value;
  const constraints = {
    audio: false,
    video: selectedDeviceId
      ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
  };
  state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = state.cameraStream;
  await video.play().catch(() => {});
  await refreshCameraList();
}

function stopCamera() {
  if (!state.cameraStream) {
    return;
  }
  for (const track of state.cameraStream.getTracks()) {
    track.stop();
  }
  state.cameraStream = null;
  video.srcObject = null;
}

async function refreshCameraList() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return;
  }
  const selected = $("cameraSelect").value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  $("cameraSelect").innerHTML = '<option value="">Default camera</option>';
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || "Camera " + (index + 1);
    $("cameraSelect").appendChild(option);
  });
  if (selected && cameras.some((camera) => camera.deviceId === selected)) {
    $("cameraSelect").value = selected;
  }
}

async function runAdaptiveMirror(epoch) {
  while (state.running && state.streamEpoch === epoch) {
    state.streamPhase = "scan";
    state.activeRoi = WIDE_SCAN_ROI;
    state.latestBbox = null;
    state.blankFrames = 0;
    state.edgeFrames = 0;
    setStatus("Scanning", "wide");
    try {
      await streamDirty({
        epoch,
        phase: "scan",
        roi: state.activeRoi,
        frames: 4,
        maxChunks: 64,
        onCrop: (payload, data) => {
          const bbox = bboxFromCrop(payload, data);
          if (bbox) {
            state.latestBbox = mergeBbox(state.latestBbox, bbox);
          }
        },
      });
    } catch (error) {
      setStatus("Retrying", error.message, true);
      await delay(450);
      continue;
    }

    if (!state.running || state.streamEpoch !== epoch) {
      break;
    }

    const focusRoi = expandBbox(state.latestBbox, {
      fallback: FALLBACK_TEXT_ROI,
      floor: FALLBACK_TEXT_ROI,
      marginX: 56,
      marginTop: 58,
      marginBottom: 32,
      minWidth: 360,
      minHeight: 124,
    });
    state.activeRoi = focusRoi;
    state.streamPhase = "focus";
    state.blankFrames = 0;
    state.edgeFrames = 0;
    state.lastWideScanAt = performance.now();
    setStatus("Streaming", formatRoi(focusRoi));

    try {
      await streamDirty({
        epoch,
        phase: "focus",
        roi: focusRoi,
        frames: 2000,
        maxChunks: 64,
        onCrop: (payload, data) => {
          const bbox = bboxFromCrop(payload, data);
          const shouldRescan = noteFocusHealth(focusRoi, bbox);
          if (bbox) {
            state.latestBbox = bbox;
          }
          if (shouldRescan) {
            return "rescan";
          }
          return "continue";
        },
      });
    } catch (error) {
      setStatus("Rescanning", error.message, true);
      await delay(350);
    }
  }
}

function streamDirty({ epoch, phase, roi, frames, maxChunks, onCrop }) {
  return new Promise((resolve, reject) => {
    if (!state.running || state.streamEpoch !== epoch) {
      resolve({ reason: "stopped" });
      return;
    }
    const params = new URLSearchParams({
      frames: String(frames),
      sentinelPage: "65531",
      burst: "1",
      maxChunks: String(maxChunks),
      chunkWindow: "8",
      fastNoResponse: "1",
      pageTimeoutMs: "6000",
      x0: String(roi.x0),
      y0: String(roi.y0),
      x1: String(roi.x1),
      y1: String(roi.y1),
    });
    const source = new EventSource("/api/framebuffer/dirty-stream?" + params.toString());
    state.source = source;
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      source.close();
      if (state.source === source) {
        state.source = null;
      }
      resolve(result);
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      source.close();
      if (state.source === source) {
        state.source = null;
      }
      reject(error);
    };

    source.addEventListener("hello", () => {
      state.streamPhase = phase;
      updateTelemetry();
    });
    source.addEventListener("crop", (event) => {
      if (!state.running || state.streamEpoch !== epoch) {
        finish({ reason: "stopped" });
        return;
      }
      const payload = parsePayload(event);
      if (!payload?.ok || !payload.dataBase64) {
        state.blankFrames += 1;
        if (state.blankFrames >= 3) {
          finish({ reason: "blank" });
        }
        return;
      }
      const data = rawFromBase64(payload.dataBase64);
      applyCrop(payload, data);
      renderDisplaySurface();
      noteFrame(payload);
      const action = onCrop ? onCrop(payload, data) : "continue";
      updateTelemetry();
      if (action === "rescan") {
        finish({ reason: "rescan" });
      }
    });
    source.addEventListener("unsupported", (event) => {
      const payload = parsePayload(event);
      fail(new Error(payload?.status || payload?.magic || "unsupported display stream"));
    });
    source.addEventListener("stream-error", (event) => {
      const payload = parsePayload(event);
      fail(new Error(payload?.error || "display stream failed"));
    });
    source.addEventListener("done", () => finish({ reason: "done" }));
    source.onerror = () => {
      if (!state.running || state.streamEpoch !== epoch) {
        finish({ reason: "stopped" });
      } else {
        fail(new Error("display stream disconnected"));
      }
    };
  });
}

function applyCrop(payload, data) {
  const widthBytes = clamp(Number(payload.widthBytes || 0), 0, ROW_BYTES);
  const height = clamp(Number(payload.height || 0), 0, HEIGHT);
  const xByte0 = clamp(Number(payload.xByte0 ?? Math.floor(Number(payload.x0 || 0) / 2)), 0, ROW_BYTES - 1);
  const y0 = clamp(Number(payload.y0 || 0), 0, HEIGHT - 1);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * widthBytes;
    const destStart = (y0 + row) * ROW_BYTES + xByte0;
    if (sourceStart + widthBytes <= data.length && destStart + widthBytes <= state.raw.length) {
      state.raw.set(data.subarray(sourceStart, sourceStart + widthBytes), destStart);
    }
  }
}

function bboxFromCrop(payload, data) {
  const widthBytes = clamp(Number(payload.widthBytes || 0), 0, ROW_BYTES);
  const height = clamp(Number(payload.height || 0), 0, HEIGHT);
  const xByte0 = clamp(Number(payload.xByte0 ?? Math.floor(Number(payload.x0 || 0) / 2)), 0, ROW_BYTES - 1);
  const y0 = clamp(Number(payload.y0 || 0), 0, HEIGHT - 1);
  let x0 = WIDTH;
  let yMin = HEIGHT;
  let x1 = -1;
  let yMax = -1;
  for (let row = 0; row < height; row += 1) {
    for (let colByte = 0; colByte < widthBytes; colByte += 1) {
      const index = row * widthBytes + colByte;
      if (index >= data.length) {
        break;
      }
      const byte = data[index];
      if (byte === 0) {
        continue;
      }
      const y = y0 + row;
      const baseX = (xByte0 + colByte) * 2;
      const high = byte >> 4;
      const low = byte & 0x0f;
      if (high > 0) {
        x0 = Math.min(x0, baseX);
        x1 = Math.max(x1, baseX);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
      if (low > 0) {
        x0 = Math.min(x0, baseX + 1);
        x1 = Math.max(x1, baseX + 1);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
  }
  if (x1 < 0) {
    return null;
  }
  return { x0, y0: yMin, x1: x1 + 1, y1: yMax + 1 };
}

function noteFocusHealth(roi, bbox) {
  const now = performance.now();
  if (!bbox) {
    state.blankFrames += 1;
  } else {
    state.blankFrames = 0;
  }

  const nearEdge = bbox
    && (bbox.x0 <= roi.x0 + 4
      || bbox.x1 >= roi.x1 - 4
      || bbox.y0 <= roi.y0 + 3
      || bbox.y1 >= roi.y1 - 3);
  state.edgeFrames = nearEdge ? state.edgeFrames + 1 : 0;

  return state.blankFrames >= 3
    || state.edgeFrames >= 2
    || now - state.lastWideScanAt > 8000;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function expandBbox(bbox, options) {
  const source = bbox || options.fallback;
  const marginX = options.marginX ?? 0;
  const marginTop = options.marginTop ?? options.marginY ?? 0;
  const marginBottom = options.marginBottom ?? options.marginY ?? 0;
  const width = Math.max(options.minWidth, source.x1 - source.x0 + (marginX * 2));
  const height = Math.max(options.minHeight, source.y1 - source.y0 + marginTop + marginBottom);
  const centerX = (source.x0 + source.x1) / 2;
  const centerY = ((source.y0 - marginTop) + (source.y1 + marginBottom)) / 2;
  let x0 = Math.round(centerX - width / 2);
  let y0 = Math.round(centerY - height / 2);
  let x1 = Math.round(centerX + width / 2);
  let y1 = Math.round(centerY + height / 2);

  if (options.floor) {
    x0 = Math.min(x0, options.floor.x0);
    y0 = Math.min(y0, options.floor.y0);
    x1 = Math.max(x1, options.floor.x1);
    y1 = Math.max(y1, options.floor.y1);
  }

  x0 = clamp(x0, 0, WIDTH - 2);
  y0 = clamp(y0, 0, HEIGHT - 1);
  x1 = clamp(x1, x0 + 2, WIDTH);
  y1 = clamp(y1, y0 + 1, HEIGHT);
  x0 -= x0 % 2;
  x1 += x1 % 2;
  x1 = clamp(x1, x0 + 2, WIDTH);
  return { x0, y0, x1, y1 };
}

function mergeBbox(a, b) {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function renderDisplaySurface() {
  const pixels = frameImage.data;
  pixels.fill(0);
  for (let byteIndex = 0; byteIndex < state.raw.length; byteIndex += 1) {
    const byte = state.raw[byteIndex];
    if (byte === 0) {
      continue;
    }
    const pixelIndex = byteIndex * 2;
    writePixel(pixels, pixelIndex, byte >> 4);
    writePixel(pixels, pixelIndex + 1, byte & 0x0f);
  }
  frameCtx.putImageData(frameImage, 0, 0);
  draw();
}

function writePixel(pixels, pixelIndex, level) {
  if (level <= 0 || pixelIndex >= WIDTH * HEIGHT) {
    return;
  }
  const offset = pixelIndex * 4;
  const normalized = level / 15;
  pixels[offset] = Math.round(36 + normalized * 62);
  pixels[offset + 1] = Math.round(210 + normalized * 45);
  pixels[offset + 2] = Math.round(104 + normalized * 86);
  pixels[offset + 3] = Math.min(255, Math.round(82 + normalized * 173));
}

function draw() {
  resizeCanvas();
  ctx.save();
  ctx.fillStyle = "#050605";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (video.readyState >= 2) {
    ctx.filter = "contrast(1.08) saturate(0.78) brightness(0.72)";
    drawCover(ctx, video, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";
  } else {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#12140f");
    gradient.addColorStop(1, "#050605");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const scale = Number($("scaleInput").value || 105) / 100;
  const offsetX = Number($("offsetXInput").value || 0) * (canvas.width / Math.max(1, window.innerWidth));
  const offsetY = Number($("offsetYInput").value || 0) * (canvas.height / Math.max(1, window.innerHeight));
  const frameWidth = Math.min(canvas.width * 0.84, canvas.height * 1.7) * scale;
  const frameHeight = frameWidth * (HEIGHT / WIDTH);
  const left = (canvas.width - frameWidth) / 2 + offsetX;
  const top = (canvas.height - frameHeight) / 2 + offsetY;

  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.34;
  ctx.filter = "blur(34px) saturate(2)";
  ctx.drawImage(frameCanvas, left, top, frameWidth, frameHeight);
  ctx.globalAlpha = 0.52;
  ctx.filter = "blur(16px) saturate(1.85)";
  ctx.drawImage(frameCanvas, left, top, frameWidth, frameHeight);
  ctx.globalAlpha = 0.82;
  ctx.filter = "blur(3.5px) contrast(1.24) saturate(1.42)";
  ctx.drawImage(frameCanvas, left, top, frameWidth, frameHeight);
  ctx.globalAlpha = 1;
  ctx.filter = "contrast(1.4) saturate(1.34) brightness(1.18)";
  ctx.drawImage(frameCanvas, left, top, frameWidth, frameHeight);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";

  ctx.globalCompositeOperation = "screen";
  const glassTint = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  glassTint.addColorStop(0, "rgba(86,255,140,0.13)");
  glassTint.addColorStop(0.42, "rgba(64,255,152,0.04)");
  glassTint.addColorStop(1, "rgba(186,255,214,0.09)");
  ctx.fillStyle = glassTint;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";

  const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.2, canvas.width / 2, canvas.height / 2, canvas.width * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

}

function drawCover(target, source, x, y, width, height) {
  const sourceWidth = source.videoWidth || source.width || width;
  const sourceHeight = source.videoHeight || source.height || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  target.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function resizeCanvas() {
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(window.innerWidth * ratio));
  const height = Math.max(1, Math.round(window.innerHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function noteFrame(payload) {
  const now = performance.now();
  state.latestFrameAt = now;
  state.frameTimes.push(now);
  state.frameTimes = state.frameTimes.filter((time) => now - time < 5000);
  state.activeRoi = {
    x0: Number(payload.x0 || 0),
    y0: Number(payload.y0 || 0),
    x1: Number(payload.x1 || 0),
    y1: Number(payload.y0 || 0) + Number(payload.height || 0),
  };
}

function updateTelemetry() {
  const fps = state.frameTimes.length > 1
    ? (1000 * (state.frameTimes.length - 1)) / (state.frameTimes[state.frameTimes.length - 1] - state.frameTimes[0])
    : 0;
  $("fpsText").textContent = fps.toFixed(1) + " fps";
  $("cropText").textContent = "crop " + (state.activeRoi ? formatRoi(state.activeRoi) : "-");
}

function setStatus(title, detail, isError = false) {
  $("stateText").textContent = title;
  const status = $("status");
  status.classList.toggle("is-error", Boolean(isError));
  if (detail) {
    $("cropText").textContent = String(detail);
  }
}

function parsePayload(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function rawFromBase64(value) {
  const binary = window.atob(String(value || ""));
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  return data;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || response.statusText);
  }
  return payload;
}

function formatRoi(roi) {
  return [roi.x0, roi.y0, roi.x1, roi.y1].map((value) => Math.round(value)).join(",");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
