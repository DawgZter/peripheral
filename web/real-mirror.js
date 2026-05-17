const WIDTH = 540;
const HEIGHT = 280;
const PAGE_SIZE = 252;
const TOTAL_BYTES = 75600;

const state = {
  running: false,
  cameraOn: false,
  inFlight: false,
  eventSource: null,
  raw: new Uint8Array(TOTAL_BYTES),
  frameTimes: [],
  frameIndex: 0,
  tickIndex: 0,
  lastTickAt: 0,
  lastHighHash: "",
  cameraStream: null,
  loopTimer: 0,
  tickTimer: 0,
  compositeAnimation: 0,
  clipRecorder: null,
  clipChunks: [],
  clipUrl: "",
  clipRecording: false,
  baselineLoaded: false,
  baselineSha256: "",
  baselineBytes: 0,
  dirtyFallbacks: 0,
  syntheticDirty: false,
  lastCrop: null,
  streamStartedAt: 0,
  streamMode: "",
  cropEvents: 0,
  validCropFrames: 0,
  uniqueCropHashes: new Set(),
  lastDirtyStatus: "",
  lastFallbackReason: "",
  dirtyGoalPass: false,
  adaptivePhase: "",
  adaptivePreviousCrop: null,
  adaptiveBbox: null,
  adaptiveRoi: null,
  adaptiveWideFrames: 0,
  adaptiveWarmupPairs: 0,
  liveTextWriteConfirmed: false,
};

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const opticFrame = $("opticFrame");
const frameCanvas = $("frameCanvas");
const glowCanvas = $("glowCanvas");
const bloomCanvas = $("bloomCanvas");
const fringeCanvas = $("fringeCanvas");
const recordCanvas = $("recordCanvas");
const frameCtx = frameCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
const glowCtx = glowCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
const bloomCtx = bloomCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
const fringeCtx = fringeCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
const recordCtx = recordCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const imageData = frameCtx.createImageData(WIDTH, HEIGHT);
const glowData = glowCtx.createImageData(WIDTH, HEIGHT);
const fringeData = fringeCtx.createImageData(WIDTH, HEIGHT);

function bindEvents() {
  $("recordButton").addEventListener("click", toggleRecord);
  $("cameraButton").addEventListener("click", toggleCamera);
  $("clipButton").addEventListener("click", toggleClip);
  $("fullscreenButton").addEventListener("click", toggleFullscreen);
  $("castButton").addEventListener("click", toggleCastMode);
  viewport.addEventListener("dblclick", toggleCastMode);
  document.addEventListener("keydown", handleKeyDown);
  $("tickButton").addEventListener("click", () => pushTick().catch((error) => log("tick failed: " + error.message)));
  $("autoTickCheck").addEventListener("change", () => {
    if (!$("autoTickCheck").checked) {
      syncTickTimer();
      return;
    }
    confirmLiveTextWrite().then(syncTickTimer).catch((error) => {
      $("autoTickCheck").checked = false;
      log("auto tick blocked: " + error.message);
      syncTickTimer();
    });
  });
  $("presetSelect").addEventListener("change", applyPreset);
  $("effectSelect").addEventListener("change", syncEffect);
  $("decodeSelect").addEventListener("change", () => {
    renderFrame();
    log("decode " + $("decodeSelect").value);
  });
  $("offsetXInput").addEventListener("input", syncOptics);
  $("offsetYInput").addEventListener("input", syncOptics);
  $("scaleInput").addEventListener("input", syncOptics);
  $("baselineCheck").addEventListener("change", handleBaselineToggle);
  $("dirtyCropCheck").addEventListener("change", () => log($("dirtyCropCheck").checked ? "dirty crop on" : "dirty crop off"));
  $("adaptiveCheck").addEventListener("change", () => log($("adaptiveCheck").checked ? "adaptive on" : "adaptive off"));
  applyInitialParams();
  syncEffect();
  syncOptics();
}

function applyInitialParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("simple") === "1") {
    document.body.classList.add("simple-mirror");
  }
  const preset = params.get("preset");
  if (preset && mirrorPresets[preset]) {
    $("presetSelect").value = preset;
    applyPreset({ keepLog: true });
  }
  setInputFromParam(params, "pageStart", "pageStartInput");
  setInputFromParam(params, "pageCount", "pageCountInput");
  setInputFromParam(params, "pipelineWindow", "pipelineWindowInput");
  setInputFromParam(params, "burstWindow", "burstWindowInput");
  const burstParam = params.get("burstRequest") ?? params.get("burst");
  if (burstParam !== null) {
    $("burstCheck").checked = truthyParam(burstParam);
  }
  setInputFromParam(params, "x", "offsetXInput");
  setInputFromParam(params, "y", "offsetYInput");
  setInputFromParam(params, "scale", "scaleInput");
  const baselineParam = params.get("baseline");
  if (baselineParam !== null) {
    $("baselineCheck").checked = truthyParam(baselineParam);
  }
  const textTemplate = params.get("textTemplate");
  if (textTemplate !== null) {
    $("textTemplateInput").value = textTemplate;
  }
  const dirtyParam = params.get("dirty") ?? params.get("dirtyCrop") ?? params.get("delta");
  if (dirtyParam !== null) {
    $("dirtyCropCheck").checked = truthyParam(dirtyParam);
  }
  const adaptiveParam = params.get("adaptive") ?? params.get("adaptiveRoi");
  if (adaptiveParam !== null) {
    $("adaptiveCheck").checked = truthyParam(adaptiveParam);
  }
  const syntheticDirtyParam = params.get("syntheticDirty") ?? params.get("dirtySynthetic") ?? params.get("synthetic");
  if (syntheticDirtyParam !== null) {
    state.syntheticDirty = truthyParam(syntheticDirtyParam);
  }
  const effect = params.get("effect");
  if (effect && ["optical", "pov", "clean"].includes(effect)) {
    $("effectSelect").value = effect;
  }
  const decode = params.get("decode");
  if (decode && ["packed4bpp", "highEven", "highStretch"].includes(decode)) {
    $("decodeSelect").value = decode;
  }
  if (params.get("cast") === "1") {
    document.body.classList.add("cast-clean");
    $("castButton").classList.add("is-live");
  }
  if (params.get("record") === "1" || params.get("autostart") === "1") {
    window.setTimeout(() => {
      if (!state.running) {
        beginStream();
      }
    }, 250);
  }
  if (params.get("autoTick") === "1" || params.get("tick") === "1") {
    $("autoTickCheck").checked = true;
  }
  if (params.get("camera") === "1") {
    window.setTimeout(() => {
      if (!state.cameraOn) {
        toggleCamera();
      }
    }, 350);
  }
  if (params.get("clip") === "1") {
    window.setTimeout(() => {
      if (!state.clipRecording) {
        startClip();
      }
    }, 650);
  }
}

const mirrorPresets = {
  fast4: {
    pageStart: 183,
    pageCount: 4,
    pipelineWindow: 12,
    burstWindow: 2,
    burst: true,
    scale: 105,
    x: 0,
    y: 0,
  },
  fast3: {
    pageStart: 184,
    pageCount: 3,
    pipelineWindow: 8,
    burstWindow: 2,
    burst: true,
    scale: 105,
    x: 0,
    y: 0,
  },
  readable7: {
    pageStart: 180,
    pageCount: 7,
    pipelineWindow: 8,
    burstWindow: 2,
    burst: true,
    scale: 105,
    x: 0,
    y: 0,
  },
  text11: {
    pageStart: 180,
    pageCount: 11,
    pipelineWindow: 8,
    burstWindow: 2,
    burst: true,
    scale: 105,
    x: 0,
    y: 0,
  },
  full300: {
    pageStart: 0,
    pageCount: 300,
    pipelineWindow: 1,
    burstWindow: 1,
    burst: false,
    scale: 82,
    x: 0,
    y: 0,
  },
};

function applyPreset(options = {}) {
  const preset = mirrorPresets[$("presetSelect").value] || mirrorPresets.fast4;
  $("pageStartInput").value = String(preset.pageStart);
  $("pageCountInput").value = String(preset.pageCount);
  $("pipelineWindowInput").value = String(preset.pipelineWindow);
  $("burstWindowInput").value = String(preset.burstWindow);
  $("burstCheck").checked = preset.burst;
  $("scaleInput").value = String(preset.scale);
  $("offsetXInput").value = String(preset.x);
  $("offsetYInput").value = String(preset.y);
  syncOptics();
  if (!options.keepLog) {
    log("preset " + $("presetSelect").value);
  }
}

bindEvents();
refreshStatus();
window.setInterval(refreshStatus, 2200);
renderFrame();

function setInputFromParam(params, name, id) {
  const value = params.get(name);
  if (value !== null) {
    $(id).value = value;
  }
}

function truthyParam(value) {
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

function handleKeyDown(event) {
  const tag = String(event.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") {
    return;
  }
  if (event.key === "Escape" && document.body.classList.contains("cast-clean")) {
    document.body.classList.remove("cast-clean");
    $("castButton").classList.remove("is-live");
  }
  if ((event.key === "c" || event.key === "C") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    toggleCastMode();
  }
}

function parseEventPayload(event, label) {
  try {
    return JSON.parse(event.data || "{}");
  } catch (error) {
    log("bad " + label + " event: " + error.message);
    return null;
  }
}

function toggleRecord() {
  if (state.running) {
    stopStream();
  } else {
    beginStream();
  }
}

function beginStream() {
  startStream().catch((error) => {
    log("stream failed: " + error.message);
    stopStream("Error");
  });
}

async function startStream() {
  if (state.running) {
    return;
  }
  const streamWindow = currentStreamWindow();
  state.running = true;
  state.frameTimes = [];
  state.frameIndex = 0;
  resetStreamTelemetry();
  state.raw.fill(0);
  renderFrame();
  $("recordButton").textContent = "Stop";
  $("recordButton").classList.add("is-live");
  $("recordDot").classList.add("is-live");
  setStatus("Preparing");
  log("stream starting p" + streamWindow.pageStart + " +" + streamWindow.pageCount);
  await prepareDisplaySurfaceForStream(streamWindow);
  if (!state.running) {
    return;
  }
  renderFrame();
  setStatus("Connecting");
  openStream(streamWindow);
  syncTickTimer();
}

function openStream(streamWindow = currentStreamWindow()) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if ($("dirtyCropCheck").checked) {
    if ($("adaptiveCheck").checked && !state.syntheticDirty) {
      openAdaptiveDirtyStream(streamWindow);
      return;
    }
    openDirtyCropStream(streamWindow);
    return;
  }
  const { pageStart, pageCount } = streamWindow;
  const params = new URLSearchParams({
    pageStart: String(pageStart),
    pageCount: String(pageCount),
    pipelineWindow: String(clamp(Number($("pipelineWindowInput").value || 8), 1, 16)),
    frames: "2000",
    fastNoResponse: "1",
  });
  if ($("burstCheck").checked) {
    params.set("burstRequest", "1");
    params.set("burstWindow", String(clamp(Number($("burstWindowInput").value || 2), 1, 16)));
  }
  if ($("autoTickCheck").checked) {
    params.set("textPrefix", "MIRROR");
    params.set("textEveryFrames", "210");
    params.set("textMinIntervalMs", "2600");
    params.set("textRefreshDisplayMode", "0");
    params.set("textFastNoResponse", "0");
    params.set("textAsync", "1");
    params.set("textSuffixMode", "counter");
    const textTemplate = $("textTemplateInput").value.trim();
    if (textTemplate) {
      params.set("textTemplate", textTemplate);
    }
  }
  const source = new EventSource("/api/framebuffer/stream?" + params.toString());
  state.eventSource = source;
  source.addEventListener("hello", (event) => {
    const payload = parseEventPayload(event, "hello");
    setStatus(payload ? "Live p" + payload.pageStart + " +" + payload.pageCount : "Live");
  });
  source.addEventListener("frame", (event) => {
    const payload = parseEventPayload(event, "frame");
    if (!payload) {
      return;
    }
    state.frameIndex = Number(payload.frame || state.frameIndex + 1);
    updateFrame(payload);
  });
  source.addEventListener("text", (event) => {
    const payload = parseEventPayload(event, "text");
    if (!payload) {
      return;
    }
    log("text " + payload.update);
  });
  source.addEventListener("text-error", (event) => {
    const payload = parseEventPayload(event, "text-error");
    if (!payload) {
      return;
    }
    log("text failed: " + (payload.error || "unknown"));
  });
  source.addEventListener("done", () => {
    if (state.running) {
      source.close();
      if (state.eventSource === source) {
        state.eventSource = null;
      }
      log("stream renewing");
      window.setTimeout(() => {
        if (state.running) {
          openStream();
        }
      }, 150);
    }
  });
  source.addEventListener("stream-error", (event) => {
    const payload = parseEventPayload(event, "stream-error");
    const message = payload?.error || "stream error";
    log(message);
    stopStream("Error");
  });
  source.onerror = () => {
    if (state.running) {
      log("stream disconnected");
      stopStream("Disconnected");
    }
  };
}

function openDirtyCropStream(streamWindow = currentStreamWindow(), options = {}) {
  const pageParams = new URLSearchParams(window.location.search);
  const requestedSentinelPage = options.sentinelPage
    ?? pageParams.get("sentinelPage")
    ?? pageParams.get("dirtySentinelPage")
    ?? "65531";
  const nzr1 = isNzr1Sentinel(requestedSentinelPage);
  const params = new URLSearchParams({
    frames: String(options.frames ?? pageParams.get("frames") ?? pageParams.get("dirtyFrames") ?? 2000),
    pageTimeoutMs: String(options.pageTimeoutMs ?? pageParams.get("pageTimeoutMs") ?? pageParams.get("dirtyPageTimeoutMs") ?? (nzr1 ? 8000 : 5000)),
    fastNoResponse: "1",
    chunked: "1",
    maxChunks: String(clamp(Number(options.maxChunks ?? pageParams.get("dirtyMaxChunks") ?? pageParams.get("maxChunks") ?? (nzr1 ? 16 : 256)), 1, 512)),
    chunkWindow: String(clamp(Number(options.chunkWindow ?? pageParams.get("chunkWindow") ?? pageParams.get("dirtyChunkWindow") ?? (nzr1 ? 8 : 16)), 1, 64)),
  });
  params.set("sentinelPage", String(requestedSentinelPage));
  if (nzr1 && options.burst !== false) {
    params.set("burst", "1");
  } else if (options.burst === true || pageParams.get("burst") === "1" || pageParams.get("hnr1Burst") === "1") {
    params.set("burst", "1");
  }
  if (options.roi) {
    for (const key of ["x0", "y0", "x1", "y1"]) {
      params.set(key, String(options.roi[key]));
    }
  }
  for (const [queryKey, streamKey] of [
    ["x0", "x0"],
    ["y0", "y0"],
    ["x1", "x1"],
    ["y1", "y1"],
    ["roiX0", "x0"],
    ["roiY0", "y0"],
    ["roiX1", "x1"],
    ["roiY1", "y1"],
  ]) {
    const value = pageParams.get(queryKey);
    if (value !== null && !params.has(streamKey)) {
      params.set(streamKey, value);
    }
  }
  if (state.syntheticDirty) {
    params.set("synthetic", "1");
    for (const key of ["syntheticFrames", "syntheticIntervalMs", "syntheticX", "syntheticY", "syntheticWidthBytes", "syntheticHeight"]) {
      const value = pageParams.get(key);
      if (value !== null) {
      params.set(key, value);
      }
    }
  }
  applyDirtyStreamTextParams(params, pageParams, options);
  const source = new EventSource("/api/framebuffer/dirty-stream?" + params.toString());
  state.eventSource = source;
  state.streamMode = options.mode || (state.syntheticDirty ? "synthetic-dirty" : (nzr1 ? "nzr1" : "dirty"));
  source.addEventListener("hello", (event) => {
    if (state.eventSource !== source) {
      return;
    }
    const payload = parseEventPayload(event, "hello");
    if (options.onHello) {
      options.onHello(payload);
    }
    setStatus(payload?.synthetic ? "Synthetic delta" : (payload ? "Delta " + (options.label || payload.mode) : "Delta"));
  });
  source.addEventListener("crop", (event) => {
    if (state.eventSource !== source) {
      return;
    }
    const payload = parseEventPayload(event, "crop");
    if (!payload) {
      return;
    }
    state.cropEvents += 1;
    state.lastDirtyStatus = payload.status || "";
    state.frameIndex = Number(payload.frame || state.frameIndex + 1);
    if (payload.ok && payload.dataBase64) {
      if (options.onCrop) {
        options.onCrop(payload);
      }
      updateCrop(payload);
      setStatus((options.statusPrefix || (payload.synthetic ? "Synthetic " : "Delta ")) + "p" + payload.y0 + " +" + payload.height);
    } else {
      log("dirty " + (payload.status || "not ready"));
    }
  });
  source.addEventListener("unsupported", (event) => {
    if (state.eventSource !== source) {
      return;
    }
    const payload = parseEventPayload(event, "unsupported");
    state.lastDirtyStatus = payload?.status || payload?.magic || "unsupported";
    fallbackToRoiStream("dirty unsupported: " + (payload?.status || payload?.magic || "unknown"), streamWindow);
  });
  source.addEventListener("text", (event) => {
    if (state.eventSource !== source) {
      return;
    }
    const payload = parseEventPayload(event, "text");
    if (payload) {
      log("text " + payload.update);
    }
  });
  source.addEventListener("text-error", (event) => {
    if (state.eventSource !== source) {
      return;
    }
    const payload = parseEventPayload(event, "text-error");
    log("text failed: " + (payload?.error || "unknown"));
  });
  source.addEventListener("done", () => {
    if (state.running && state.eventSource === source) {
      source.close();
      state.eventSource = null;
      if (options.onDone) {
        options.onDone();
        return;
      }
      log("dirty stream renewing");
      window.setTimeout(() => {
        if (state.running) {
          openStream(streamWindow);
        }
      }, 150);
    }
  });
  source.addEventListener("stream-error", (event) => {
    if (state.eventSource !== source) {
      return;
    }
    const payload = parseEventPayload(event, "stream-error");
    fallbackToRoiStream("dirty error: " + (payload?.error || "stream error"), streamWindow);
  });
  source.onerror = () => {
    if (state.running && state.eventSource === source) {
      fallbackToRoiStream("dirty disconnected", streamWindow);
    }
  };
}

function openAdaptiveDirtyStream(streamWindow = currentStreamWindow()) {
  const config = adaptiveConfigFromParams();
  resetAdaptiveScan();
  state.adaptivePhase = "wide";
  state.adaptiveWarmupPairs = config.warmupPairs;
  state.streamMode = "adaptive-wide";
  log("adaptive scan " + formatRoi(config.wideRoi));
  setStatus("Adaptive scan");
  const textTemplate = $("textTemplateInput").value.trim() || "lorem ipsum {counter} {time}";
  openDirtyCropStream(streamWindow, {
    mode: "adaptive-wide",
    label: "adaptive scan",
    statusPrefix: "Scan ",
    frames: config.wideFrames,
    sentinelPage: "65531",
    burst: true,
    maxChunks: 16,
    chunkWindow: 8,
    roi: config.wideRoi,
    updateText: $("autoTickCheck").checked,
    textPrefix: "LOREM",
    textEveryFrames: 1,
    textMinIntervalMs: 0,
    textFastNoResponse: 1,
    textAsync: 1,
    textTemplate,
    onCrop: noteAdaptiveWideCrop,
    onDone: () => {
      if (!state.running) {
        return;
      }
      const repairRoi = expandedAdaptiveRoi(config, {
        marginX: config.repairMarginX,
        marginY: config.repairMarginY,
        minWidth: config.repairMinWidth,
        minHeight: config.repairMinHeight,
      });
      const focusRoi = expandedAdaptiveRoi(config, {
        marginX: config.focusMarginX,
        marginY: config.focusMarginY,
        minWidth: config.focusMinWidth,
        minHeight: config.focusMinHeight,
      });
      const startFocus = () => {
        if (!state.running) {
          return;
        }
        state.adaptiveRoi = focusRoi;
        state.adaptivePhase = "focus";
        state.streamMode = "adaptive-focus";
        log("adaptive focus " + formatRoi(focusRoi));
        setStatus("Adaptive focus");
        openDirtyCropStream(streamWindow, {
          mode: "adaptive-focus",
          label: "adaptive focus",
          statusPrefix: "Focus ",
          frames: config.focusFrames,
          sentinelPage: "65531",
          burst: true,
          maxChunks: config.focusMaxChunks,
          chunkWindow: config.chunkWindow,
          roi: focusRoi,
          updateText: $("autoTickCheck").checked,
          textPrefix: "LOREM",
          textEveryFrames: config.focusTextEveryFrames,
          textMinIntervalMs: 0,
          textFastNoResponse: 1,
          textAsync: 1,
          textTemplate,
        });
      };
      if (config.repairFrames <= 0) {
        startFocus();
        return;
      }
      state.adaptiveRoi = repairRoi;
      state.adaptivePhase = "repair";
      state.streamMode = "adaptive-repair";
      log("adaptive repair " + formatRoi(repairRoi));
      setStatus("Adaptive repair");
      openDirtyCropStream(streamWindow, {
        mode: "adaptive-repair",
        label: "adaptive repair",
        statusPrefix: "Repair ",
        frames: config.repairFrames,
        sentinelPage: "65531",
        burst: true,
        maxChunks: config.repairMaxChunks,
        chunkWindow: config.chunkWindow,
        roi: repairRoi,
        updateText: $("autoTickCheck").checked,
        textPrefix: "LOREM",
        textEveryFrames: config.focusTextEveryFrames,
        textMinIntervalMs: 0,
        textFastNoResponse: 1,
        textAsync: 1,
        textTemplate,
        onDone: startFocus,
      });
    },
  });
}

function applyDirtyStreamTextParams(params, pageParams, options = {}) {
  const wantsText = options.updateText ?? $("autoTickCheck").checked;
  if (!wantsText) {
    return;
  }
  params.set("textPrefix", String(options.textPrefix ?? pageParams.get("textPrefix") ?? "MIRROR"));
  params.set("textEveryFrames", String(options.textEveryFrames ?? pageParams.get("textEveryFrames") ?? pageParams.get("dirtyTextEveryFrames") ?? 210));
  params.set("textMinIntervalMs", String(options.textMinIntervalMs ?? pageParams.get("textMinIntervalMs") ?? pageParams.get("dirtyTextMinIntervalMs") ?? 2600));
  params.set("textRefreshDisplayMode", String(options.textRefreshDisplayMode ?? pageParams.get("textRefreshDisplayMode") ?? "0"));
  params.set("textFastNoResponse", String(options.textFastNoResponse ?? pageParams.get("textFastNoResponse") ?? "1"));
  params.set("textAsync", String(options.textAsync ?? pageParams.get("textAsync") ?? "1"));
  params.set("textAssistantPostSequence", String(options.textAssistantPostSequence ?? pageParams.get("textAssistantPostSequence") ?? "1"));
  params.set("textSuffixMode", String(options.textSuffixMode ?? pageParams.get("textSuffixMode") ?? "counter"));
  const textTemplate = options.textTemplate ?? $("textTemplateInput").value.trim();
  if (textTemplate) {
    params.set("textTemplate", textTemplate);
  }
}

function resetAdaptiveScan() {
  state.adaptivePreviousCrop = null;
  state.adaptiveBbox = null;
  state.adaptiveRoi = null;
  state.adaptiveWideFrames = 0;
  state.adaptiveWarmupPairs = 0;
}

function noteAdaptiveWideCrop(payload) {
  const current = rawFromBase64(payload.dataBase64);
  const widthBytes = clamp(Number(payload.widthBytes || 0), 0, WIDTH / 2);
  const height = clamp(Number(payload.height || 0), 0, HEIGHT);
  const xByte0 = clamp(Number(payload.xByte0 ?? Math.floor(Number(payload.x0 || 0) / 2)), 0, (WIDTH / 2) - 1);
  const y0 = clamp(Number(payload.y0 || 0), 0, HEIGHT - 1);
  const previous = state.adaptivePreviousCrop;
  state.adaptiveWideFrames += 1;
  if (previous && previous.data.length === current.length && previous.widthBytes === widthBytes && previous.height === height) {
    const pairIndex = state.adaptiveWideFrames - 1;
    const pairBbox = { x0: WIDTH, y0: HEIGHT, x1: -1, y1: -1 };
    for (let index = 0; index < current.length; index += 1) {
      if ((previous.data[index] ^ current[index]) === 0) {
        continue;
      }
      const row = Math.floor(index / widthBytes);
      const col = index % widthBytes;
      const x = (xByte0 + col) * 2;
      const y = y0 + row;
      pairBbox.x0 = Math.min(pairBbox.x0, x);
      pairBbox.y0 = Math.min(pairBbox.y0, y);
      pairBbox.x1 = Math.max(pairBbox.x1, x + 2);
      pairBbox.y1 = Math.max(pairBbox.y1, y + 1);
    }
    if (pairBbox.x1 >= 0 && pairIndex > state.adaptiveWarmupPairs) {
      mergeAdaptiveBbox(pairBbox);
    }
  }
  state.adaptivePreviousCrop = { data: current, widthBytes, height, xByte0, y0 };
}

function mergeAdaptiveBbox(bbox) {
  if (!state.adaptiveBbox) {
    state.adaptiveBbox = { ...bbox };
    return;
  }
  state.adaptiveBbox.x0 = Math.min(state.adaptiveBbox.x0, bbox.x0);
  state.adaptiveBbox.y0 = Math.min(state.adaptiveBbox.y0, bbox.y0);
  state.adaptiveBbox.x1 = Math.max(state.adaptiveBbox.x1, bbox.x1);
  state.adaptiveBbox.y1 = Math.max(state.adaptiveBbox.y1, bbox.y1);
}

function expandedAdaptiveRoi(config, overrides = {}) {
  const bbox = state.adaptiveBbox || config.fallbackRoi;
  if (!state.adaptiveBbox) {
    log("adaptive fallback " + formatRoi(config.fallbackRoi));
  }
  const marginX = overrides.marginX ?? config.marginX;
  const marginY = overrides.marginY ?? config.marginY;
  const minWidth = overrides.minWidth ?? config.minWidth;
  const minHeight = overrides.minHeight ?? config.minHeight;
  const centerX = Math.round((bbox.x0 + bbox.x1) / 2);
  const centerY = Math.round((bbox.y0 + bbox.y1) / 2);
  const width = Math.max(minWidth, bbox.x1 - bbox.x0 + (2 * marginX));
  const height = Math.max(minHeight, bbox.y1 - bbox.y0 + (2 * marginY));
  let x0 = clamp(centerX - Math.floor(width / 2), 0, WIDTH - width);
  let y0 = clamp(centerY - Math.floor(height / 2), 0, HEIGHT - height);
  let x1 = x0 + width;
  let y1 = y0 + height;
  x0 -= x0 % 2;
  x1 += x1 % 2;
  return {
    x0: clamp(x0, 0, WIDTH - 2),
    y0: clamp(y0, 0, HEIGHT - 1),
    x1: clamp(x1, x0 + 2, WIDTH),
    y1: clamp(y1, y0 + 1, HEIGHT),
  };
}

function adaptiveConfigFromParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    wideFrames: paramNumber(params, ["adaptiveWideFrames", "wideFrames"], 36, 2, 200),
    focusFrames: paramNumber(params, ["adaptiveFocusFrames", "focusFrames"], 2000, 1, 2000),
    repairFrames: paramNumber(params, ["adaptiveRepairFrames", "repairFrames"], 12, 0, 200),
    focusTextEveryFrames: paramNumber(params, ["adaptiveTextEveryFrames", "focusTextEveryFrames"], 3, 1, 500),
    marginX: paramNumber(params, ["adaptiveMarginX", "marginX"], 180, 0, WIDTH),
    marginY: paramNumber(params, ["adaptiveMarginY", "marginY"], 10, 0, 40),
    minWidth: paramNumber(params, ["adaptiveMinWidth", "minWidth"], 420, 2, WIDTH),
    minHeight: paramNumber(params, ["adaptiveMinHeight", "minHeight"], 28, 1, HEIGHT),
    repairMarginX: paramNumber(params, ["adaptiveRepairMarginX", "repairMarginX"], 180, 0, WIDTH),
    repairMarginY: paramNumber(params, ["adaptiveRepairMarginY", "repairMarginY"], 10, 0, 40),
    repairMinWidth: paramNumber(params, ["adaptiveRepairMinWidth", "repairMinWidth"], 420, 2, WIDTH),
    repairMinHeight: paramNumber(params, ["adaptiveRepairMinHeight", "repairMinHeight"], 28, 1, HEIGHT),
    focusMarginX: paramNumber(params, ["adaptiveFocusMarginX", "focusMarginX"], 8, 0, WIDTH),
    focusMarginY: paramNumber(params, ["adaptiveFocusMarginY", "focusMarginY"], 5, 0, 40),
    focusMinWidth: paramNumber(params, ["adaptiveFocusMinWidth", "focusMinWidth"], 40, 2, WIDTH),
    focusMinHeight: paramNumber(params, ["adaptiveFocusMinHeight", "focusMinHeight"], 18, 1, HEIGHT),
    wideMaxChunks: paramNumber(params, ["adaptiveWideMaxChunks", "wideMaxChunks"], 16, 1, 512),
    repairMaxChunks: paramNumber(params, ["adaptiveRepairMaxChunks", "repairMaxChunks"], 16, 1, 512),
    focusMaxChunks: paramNumber(params, ["adaptiveFocusMaxChunks", "focusMaxChunks"], 16, 1, 512),
    chunkWindow: paramNumber(params, ["adaptiveChunkWindow", "chunkWindow"], 8, 1, 64),
    warmupPairs: paramNumber(params, ["adaptiveWarmupPairs", "warmupPairs"], 4, 0, 50),
    wideRoi: roiFromParams(params, "adaptiveWide", { x0: 60, y0: 120, x1: 500, y1: 220 }),
    fallbackRoi: roiFromParams(params, "adaptiveFallback", { x0: 130, y0: 165, x1: 172, y1: 185 }),
  };
}

function roiFromParams(params, prefix, fallback) {
  return normalizeRoi({
    x0: paramNumber(params, [prefix + "X0"], fallback.x0, 0, WIDTH - 2),
    y0: paramNumber(params, [prefix + "Y0"], fallback.y0, 0, HEIGHT - 1),
    x1: paramNumber(params, [prefix + "X1"], fallback.x1, 2, WIDTH),
    y1: paramNumber(params, [prefix + "Y1"], fallback.y1, 1, HEIGHT),
  });
}

function normalizeRoi(roi) {
  const x0 = clamp(Math.min(roi.x0, roi.x1 - 2), 0, WIDTH - 2);
  const y0 = clamp(Math.min(roi.y0, roi.y1 - 1), 0, HEIGHT - 1);
  let x1 = clamp(Math.max(roi.x1, x0 + 2), x0 + 2, WIDTH);
  const y1 = clamp(Math.max(roi.y1, y0 + 1), y0 + 1, HEIGHT);
  x1 += x1 % 2;
  return { x0: x0 - (x0 % 2), y0, x1: clamp(x1, x0 + 2, WIDTH), y1 };
}

function paramNumber(params, names, fallback, min, max) {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null && value !== "") {
      return clamp(Number(value), min, max);
    }
  }
  return clamp(Number(fallback), min, max);
}

function isNzr1Sentinel(value) {
  return Number(value) === 0xfffb;
}

function formatRoi(roi) {
  return roi.x0 + "," + roi.y0 + " " + roi.x1 + "," + roi.y1;
}

function fallbackToRoiStream(reason, streamWindow) {
  state.dirtyFallbacks += 1;
  state.lastFallbackReason = reason;
  updateGoalTelemetry();
  log(reason);
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  $("dirtyCropCheck").checked = false;
  setStatus("Fallback");
  if (state.running) {
    window.setTimeout(() => openStream(streamWindow), 150);
  }
}

function stopStream(status = "Idle") {
  state.running = false;
  window.clearTimeout(state.loopTimer);
  window.clearInterval(state.tickTimer);
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  $("recordButton").textContent = "Record";
  $("recordButton").classList.remove("is-live");
  $("recordDot").classList.remove("is-live");
  setStatus(status);
  log("record stopped");
  stopCompositeLoopIfIdle();
}

function currentStreamWindow() {
  const pageStart = clamp(Number($("pageStartInput").value || 0), 0, 299);
  const pageCount = clamp(Number($("pageCountInput").value || 300), 1, 300 - pageStart);
  $("pageStartInput").value = String(pageStart);
  $("pageCountInput").value = String(pageCount);
  return { pageStart, pageCount };
}

async function prepareDisplaySurfaceForStream(streamWindow) {
  if (state.syntheticDirty && $("dirtyCropCheck").checked) {
    state.raw.fill(0);
    state.baselineLoaded = false;
    state.baselineSha256 = "";
    state.baselineBytes = 0;
    $("baselineStat").textContent = "synthetic";
    return;
  }
  const wantsBaseline = $("baselineCheck").checked && (
    $("dirtyCropCheck").checked
    || !(streamWindow.pageStart === 0 && streamWindow.pageCount >= 300)
  );
  if (!wantsBaseline) {
    state.raw.fill(0);
    state.baselineLoaded = false;
    state.baselineSha256 = "";
    state.baselineBytes = 0;
    $("baselineStat").textContent = $("baselineCheck").checked ? "not needed" : "off";
    return;
  }
  await loadBaselineFrame();
}

async function loadBaselineFrame() {
  if (baselineSource() === "live") {
    await loadLiveKeyframeFrame();
    return;
  }
  await loadStaticBaselineFrame();
}

function baselineSource() {
  const params = new URLSearchParams(window.location.search);
  const explicit = String(params.get("baselineSource") || params.get("keyframe") || "").trim().toLowerCase();
  if (explicit === "static" || explicit === "cached") {
    return "static";
  }
  if (explicit === "live" || explicit === "stream") {
    return "live";
  }
  return $("dirtyCropCheck").checked && !state.syntheticDirty ? "live" : "static";
}

async function loadStaticBaselineFrame() {
  $("baselineStat").textContent = "loading";
  try {
    const response = await fetch("/api/framebuffer/baseline", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(response.statusText || "baseline request failed");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== TOTAL_BYTES) {
      throw new Error("baseline size " + buffer.byteLength + " != " + TOTAL_BYTES);
    }
    state.raw.set(new Uint8Array(buffer));
    state.baselineLoaded = true;
    state.baselineSha256 = response.headers.get("x-peripheral-framebuffer-sha256") || "";
    state.baselineBytes = buffer.byteLength;
    $("baselineStat").textContent = "loaded";
    log("baseline loaded");
  } catch (error) {
    state.raw.fill(0);
    state.baselineLoaded = false;
    state.baselineSha256 = "";
    state.baselineBytes = 0;
    $("baselineStat").textContent = "missing";
    log("baseline failed: " + error.message);
  }
}

async function loadLiveKeyframeFrame() {
  $("baselineStat").textContent = "keyframe";
  const startedAt = performance.now();
  const params = new URLSearchParams({
    pageStart: "0",
    pageCount: "300",
    frames: "1",
    pipelineWindow: "8",
    burstRequest: "1",
    burstWindow: "2",
    fastNoResponse: "1",
    pageTimeoutMs: "15000",
  });
  return await new Promise((resolve, reject) => {
    const source = new EventSource("/api/framebuffer/stream?" + params.toString());
    let settled = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      source.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    source.addEventListener("frame", (event) => {
      const payload = parseEventPayload(event, "keyframe");
      if (!payload || !payload.ok || !payload.rawBase64) {
        finish(new Error("keyframe missing raw"));
        return;
      }
      const raw = rawFromBase64(payload.rawBase64);
      if (raw.length !== TOTAL_BYTES) {
        finish(new Error("keyframe size " + raw.length + " != " + TOTAL_BYTES));
        return;
      }
      state.raw.set(raw);
      state.baselineLoaded = true;
      state.baselineSha256 = payload.highNibbleSha256 || highNibbleSignature(raw);
      state.baselineBytes = raw.length;
      $("baselineStat").textContent = "live";
      log("live keyframe " + ((performance.now() - startedAt) / 1000).toFixed(1) + "s");
      renderFrame();
      finish();
    });
    source.addEventListener("stream-error", (event) => {
      const payload = parseEventPayload(event, "keyframe-error");
      finish(new Error(payload?.error || "keyframe stream error"));
    });
    source.onerror = () => finish(new Error("keyframe disconnected"));
  }).catch((error) => {
    state.raw.fill(0);
    state.baselineLoaded = false;
    state.baselineSha256 = "";
    state.baselineBytes = 0;
    $("baselineStat").textContent = "missing";
    log("live keyframe failed: " + error.message);
    throw error;
  });
}

function handleBaselineToggle() {
  if (!$("baselineCheck").checked) {
    state.raw.fill(0);
    state.baselineLoaded = false;
    state.baselineSha256 = "";
    state.baselineBytes = 0;
    $("baselineStat").textContent = "off";
    renderFrame();
    log("baseline off");
    return;
  }
  if (!state.running) {
    loadBaselineFrame().then(renderFrame);
  }
}

async function toggleCamera() {
  if (state.cameraOn) {
    stopCamera();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    state.cameraStream = stream;
    $("cameraVideo").srcObject = stream;
    state.cameraOn = true;
    viewport.classList.add("camera-on");
    $("cameraButton").classList.add("is-live");
    startCompositeLoop();
    log("camera on");
  } catch (error) {
    log("camera failed: " + error.message);
  }
}

function stopCamera() {
  for (const track of state.cameraStream?.getTracks?.() || []) {
    track.stop();
  }
  state.cameraStream = null;
  state.cameraOn = false;
  viewport.classList.remove("camera-on");
  $("cameraButton").classList.remove("is-live");
  log("camera off");
  stopCompositeLoopIfIdle();
}

function toggleClip() {
  if (state.clipRecording) {
    stopClip();
  } else {
    startClip();
  }
}

function startClip() {
  if (!recordCanvas.captureStream || typeof MediaRecorder === "undefined") {
    log("clip recording is not supported in this browser");
    return;
  }
  if (!state.running) {
    beginStream();
  }
  if (state.clipUrl) {
    URL.revokeObjectURL(state.clipUrl);
    state.clipUrl = "";
  }
  $("clipDownload").hidden = true;
  state.clipChunks = [];
  drawCompositeFrame();
  const stream = recordCanvas.captureStream(30);
  const mimeType = preferredRecorderMimeType();
  const options = mimeType ? { mimeType } : {};
  try {
    const recorder = new MediaRecorder(stream, options);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        state.clipChunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(state.clipChunks, { type: recorder.mimeType || "video/webm" });
      state.clipUrl = URL.createObjectURL(blob);
      $("clipDownload").href = state.clipUrl;
      $("clipDownload").download = "peripheral-real-mirror-" + new Date().toISOString().replace(/[:.]/g, "-") + ".webm";
      $("clipDownload").hidden = false;
      state.clipRecording = false;
      state.clipRecorder = null;
      $("clipButton").textContent = "Clip";
      $("clipButton").classList.remove("is-live");
      log("clip ready");
      stopCompositeLoopIfIdle();
    });
    state.clipRecorder = recorder;
    state.clipRecording = true;
    $("clipButton").textContent = "Stop Clip";
    $("clipButton").classList.add("is-live");
    startCompositeLoop();
    recorder.start(1000);
    log("clip started");
  } catch (error) {
    state.clipRecording = false;
    state.clipRecorder = null;
    $("clipButton").textContent = "Clip";
    $("clipButton").classList.remove("is-live");
    log("clip failed: " + error.message);
    stopCompositeLoopIfIdle();
  }
}

function stopClip() {
  if (state.clipRecorder && state.clipRecorder.state !== "inactive") {
    state.clipRecorder.stop();
    return;
  }
  state.clipRecording = false;
  state.clipRecorder = null;
  $("clipButton").textContent = "Clip";
  $("clipButton").classList.remove("is-live");
  stopCompositeLoopIfIdle();
}

function preferredRecorderMimeType() {
  for (const mimeType of [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]) {
    if (MediaRecorder.isTypeSupported?.(mimeType)) {
      return mimeType;
    }
  }
  return "";
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  await viewport.requestFullscreen?.().catch((error) => log("fullscreen failed: " + error.message));
}

function toggleCastMode() {
  document.body.classList.toggle("cast-clean");
  $("castButton").classList.toggle("is-live", document.body.classList.contains("cast-clean"));
}

async function captureLoop() {
  if (!state.running || state.inFlight) {
    return;
  }
  const startedAt = performance.now();
  state.inFlight = true;
  try {
    if ($("autoTickCheck").checked) {
      maybePushTick();
    }
    const payload = await captureOnce();
    state.frameIndex += 1;
    updateFrame(payload);
    const elapsed = performance.now() - startedAt;
    $("captureStat").textContent = Math.round(payload.durationMs ?? elapsed) + " ms";
    setStatus("Live");
  } catch (error) {
    setStatus("Error");
    log(error.message);
    state.running = false;
    $("recordButton").textContent = "Record";
    $("recordButton").classList.remove("is-live");
    $("recordDot").classList.remove("is-live");
  } finally {
    state.inFlight = false;
  }
  if (state.running) {
    const delayMs = clamp(Number($("delayInput").value || 0), 0, 5000);
    state.loopTimer = window.setTimeout(captureLoop, delayMs);
  }
}

async function captureOnce() {
  const pageStart = clamp(Number($("pageStartInput").value || 0), 0, 299);
  const pageCount = clamp(Number($("pageCountInput").value || 300), 1, 300 - pageStart);
  const pipelineWindow = clamp(Number($("pipelineWindowInput").value || 8), 1, 16);
  return await fetchJson("/api/framebuffer/capture", {
    method: "POST",
    body: JSON.stringify({
      pageStart,
      pageCount,
      includeRaw: true,
      writeWithoutResponse: true,
      fastNoResponse: true,
      pipelineWindow,
      sendDelayMs: 0,
      noInit: true,
    }),
  });
}

function updateFrame(payload) {
  const pageStart = Number(payload.pageStart || 0);
  const raw = rawFromBase64(payload.rawBase64);
  state.raw.set(raw, pageStart * PAGE_SIZE);
  const highHash = payload.highNibbleSha256 || highNibbleSignature(raw);
  state.lastHighHash = highHash;
  rememberCropHash(highHash);
  renderFrame();
  updateStats(payload, highHash);
}

function updateCrop(payload) {
  const data = rawFromBase64(payload.dataBase64);
  const widthBytes = clamp(Number(payload.widthBytes || 0), 0, WIDTH / 2);
  const height = clamp(Number(payload.height || 0), 0, HEIGHT);
  const xByte0 = clamp(Number(payload.xByte0 ?? Math.floor(Number(payload.x0 || 0) / 2)), 0, (WIDTH / 2) - 1);
  const y0 = clamp(Number(payload.y0 || 0), 0, HEIGHT - 1);
  const bytesPerRow = WIDTH / 2;
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * widthBytes;
    const sourceEnd = sourceStart + widthBytes;
    const destStart = (y0 + row) * bytesPerRow + xByte0;
    const destEnd = destStart + widthBytes;
    if (sourceEnd <= data.length && destEnd <= state.raw.length) {
      state.raw.set(data.subarray(sourceStart, sourceEnd), destStart);
    }
  }
  state.lastCrop = {
    synthetic: Boolean(payload.synthetic),
    magic: payload.magic || "",
    protocol: payload.protocol || "",
    x0: Number(payload.x0 || 0),
    x1: Number(payload.x1 || 0),
    y0,
    height,
    widthBytes,
    dataLength: payload.dataLength || data.length,
    chunksReceived: payload.chunksReceived || null,
    chunkCount: payload.chunkCount || null,
    status: payload.status || "",
    label: payload.label || "",
  };
  const highHash = payload.dataSha256 || highNibbleSignature(data);
  state.lastHighHash = highHash;
  state.validCropFrames += 1;
  rememberCropHash(highHash);
  renderFrame();
  updateStats({
    bytes: payload.dataLength || data.length,
    frameIntervalMs: payload.frameIntervalMs,
    fps: payload.fps,
    latencyMs: payload.durationMs,
  }, highHash);
}

function resetStreamTelemetry() {
  state.streamStartedAt = performance.now();
  state.streamMode = $("dirtyCropCheck").checked ? "dirty" : "roi";
  state.cropEvents = 0;
  state.validCropFrames = 0;
  state.uniqueCropHashes = new Set();
  state.lastDirtyStatus = "";
  state.lastFallbackReason = "";
  state.lastCrop = null;
  state.dirtyGoalPass = false;
  resetAdaptiveScan();
  state.adaptivePhase = "";
  $("protocolStat").textContent = state.streamMode;
  $("validStat").textContent = "0/0";
  $("uniqueHashStat").textContent = "0";
  $("goalStat").textContent = "no";
}

function rememberCropHash(hash) {
  if (hash) {
    state.uniqueCropHashes.add(hash);
  }
}

function renderFrame() {
  const data = imageData.data;
  const glow = glowData.data;
  const fringe = fringeData.data;
  const decodeMode = $("decodeSelect").value || "packed4bpp";
  const effect = $("effectSelect").value || "optical";
  const needsOpticalBuffers = effect !== "clean";
  data.fill(0);
  if (needsOpticalBuffers) {
    glow.fill(0);
    fringe.fill(0);
  }

  for (let byteIndex = 0; byteIndex < TOTAL_BYTES; byteIndex += 1) {
    const byte = state.raw[byteIndex];
    const high = byte >> 4;
    const low = byte & 0x0f;
    const pixelIndex = byteIndex * 2;
    writeOpticalPixel(data, needsOpticalBuffers ? glow : null, pixelIndex, high);
    if (needsOpticalBuffers) {
      writeFringePixels(fringe, pixelIndex, high);
    }
    if (decodeMode === "packed4bpp") {
      writeOpticalPixel(data, needsOpticalBuffers ? glow : null, pixelIndex + 1, low);
      if (needsOpticalBuffers) {
        writeFringePixels(fringe, pixelIndex + 1, low);
      }
    } else if (decodeMode === "highStretch") {
      writeOpticalPixel(data, needsOpticalBuffers ? glow : null, pixelIndex + 1, high);
      if (needsOpticalBuffers) {
        writeFringePixels(fringe, pixelIndex + 1, high);
      }
    }
  }

  frameCtx.putImageData(imageData, 0, 0);
  if (needsOpticalBuffers) {
    glowCtx.putImageData(glowData, 0, 0);
    fringeCtx.putImageData(fringeData, 0, 0);
    bloomCtx.clearRect(0, 0, WIDTH, HEIGHT);
    bloomCtx.globalCompositeOperation = "source-over";
    bloomCtx.globalAlpha = 0.9;
    bloomCtx.drawImage(glowCanvas, 0, 0);
    bloomCtx.globalAlpha = 0.48;
    bloomCtx.drawImage(fringeCanvas, 0, 0);
    bloomCtx.globalAlpha = 1;
  }
  drawCompositeFrame();
}

function startCompositeLoop() {
  if (state.compositeAnimation) {
    return;
  }
  let lastCompositeAt = 0;
  const loop = (now) => {
    if (!lastCompositeAt || now - lastCompositeAt >= 33) {
      drawCompositeFrame();
      lastCompositeAt = now;
    }
    if (state.cameraOn || state.clipRecording) {
      state.compositeAnimation = window.requestAnimationFrame(loop);
    } else {
      state.compositeAnimation = 0;
    }
  };
  state.compositeAnimation = window.requestAnimationFrame(loop);
}

function stopCompositeLoopIfIdle() {
  if (state.cameraOn || state.clipRecording || !state.compositeAnimation) {
    return;
  }
  window.cancelAnimationFrame(state.compositeAnimation);
  state.compositeAnimation = 0;
}

function drawCompositeFrame() {
  const width = recordCanvas.width;
  const height = recordCanvas.height;
  recordCtx.save();
  recordCtx.fillStyle = "#080907";
  recordCtx.fillRect(0, 0, width, height);

  const video = $("cameraVideo");
  if (state.cameraOn && video.readyState >= 2) {
    recordCtx.filter = "contrast(1.04) saturate(0.86) brightness(0.86)";
    drawImageCover(recordCtx, video, 0, 0, width, height);
    recordCtx.filter = "none";
  } else {
    const gradient = recordCtx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#15160f");
    gradient.addColorStop(0.55, "#090b09");
    gradient.addColorStop(1, "#171815");
    recordCtx.fillStyle = gradient;
    recordCtx.fillRect(0, 0, width, height);
  }

  drawCompositeOptics(width, height);
  drawCompositeLens(width, height);
  recordCtx.restore();
}

function drawCompositeOptics(width, height) {
  const scale = clamp(Number($("scaleInput").value || 100), 70, 135) / 100;
  const offsetX = clamp(Number($("offsetXInput").value || 0), -240, 240) * (width / Math.max(1, viewport.clientWidth || width));
  const offsetY = clamp(Number($("offsetYInput").value || 0), -180, 180) * (height / Math.max(1, viewport.clientHeight || height));
  const frameWidth = Math.min(width * 0.84, 900) * scale;
  const frameHeight = frameWidth * (HEIGHT / WIDTH);
  const left = (width - frameWidth) / 2 + offsetX;
  const top = (height - frameHeight) / 2 + offsetY;
  const effect = $("effectSelect").value || "optical";

  if (effect !== "clean") {
    recordCtx.globalCompositeOperation = "screen";
    recordCtx.globalAlpha = effect === "pov" ? 0.32 : 0.2;
    recordCtx.filter = effect === "pov" ? "blur(18px)" : "blur(12px)";
    recordCtx.drawImage(bloomCanvas, left, top, frameWidth, frameHeight);

    recordCtx.globalAlpha = effect === "pov" ? 0.44 : 0.32;
    recordCtx.filter = "blur(2px)";
    recordCtx.drawImage(fringeCanvas, left, top, frameWidth, frameHeight);

    recordCtx.globalAlpha = effect === "pov" ? 0.76 : 0.58;
    recordCtx.filter = effect === "pov" ? "blur(4px)" : "blur(3px)";
    recordCtx.drawImage(glowCanvas, left, top, frameWidth, frameHeight);
  }

  recordCtx.globalCompositeOperation = effect === "clean" ? "source-over" : "screen";
  recordCtx.globalAlpha = effect === "clean" ? 1 : 0.86;
  recordCtx.filter = effect === "pov" ? "contrast(1.14) saturate(1.08)" : "none";
  recordCtx.drawImage(frameCanvas, left, top, frameWidth, frameHeight);
  recordCtx.globalAlpha = 1;
  recordCtx.filter = "none";
  recordCtx.globalCompositeOperation = "source-over";
}

function drawCompositeLens(width, height) {
  recordCtx.globalCompositeOperation = "screen";
  const sheen = recordCtx.createRadialGradient(width * 0.38, height * 0.34, 0, width * 0.38, height * 0.34, width * 0.2);
  sheen.addColorStop(0, "rgba(255,255,255,0.14)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  recordCtx.fillStyle = sheen;
  recordCtx.fillRect(0, 0, width, height);

  const tint = recordCtx.createLinearGradient(0, 0, width, 0);
  tint.addColorStop(0, "rgba(255,214,160,0.06)");
  tint.addColorStop(0.5, "rgba(255,255,255,0)");
  tint.addColorStop(1, "rgba(136,225,255,0.05)");
  recordCtx.fillStyle = tint;
  recordCtx.fillRect(0, 0, width, height);

  recordCtx.globalCompositeOperation = "source-over";
  const vignette = recordCtx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, width * 0.68);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.46)");
  recordCtx.fillStyle = vignette;
  recordCtx.fillRect(0, 0, width, height);
}

function drawImageCover(ctx, source, x, y, width, height) {
  const sourceWidth = source.videoWidth || source.width || width;
  const sourceHeight = source.videoHeight || source.height || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function writeOpticalPixel(data, glow, pixelIndex, level) {
  const offset = pixelIndex * 4;
  if (level <= 0) {
    data[offset + 3] = 0;
    if (glow) {
      glow[offset + 3] = 0;
    }
    return;
  }
  const normalized = level / 15;
  const alpha = Math.min(235, Math.round(42 + normalized * 190));
  data[offset] = Math.round(204 + normalized * 48);
  data[offset + 1] = Math.round(245 + normalized * 10);
  data[offset + 2] = Math.round(226 + normalized * 24);
  data[offset + 3] = alpha;

  if (glow) {
    glow[offset] = Math.round(120 + normalized * 100);
    glow[offset + 1] = Math.round(238 + normalized * 17);
    glow[offset + 2] = Math.round(224 + normalized * 28);
    glow[offset + 3] = Math.round(26 + normalized * 168);
  }
}

function writeFringePixels(data, pixelIndex, level) {
  if (level <= 0) {
    return;
  }
  const x = pixelIndex % WIDTH;
  const normalized = level / 15;
  const alpha = Math.round(18 + normalized * 82);
  if (x > 1) {
    writeTintPixel(data, pixelIndex - 2, 255, 202, 156, alpha);
  }
  if (x < WIDTH - 2) {
    writeTintPixel(data, pixelIndex + 2, 115, 226, 255, alpha);
  }
}

function writeTintPixel(data, pixelIndex, red, green, blue, alpha) {
  const offset = pixelIndex * 4;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = alpha;
}

function updateStats(payload, highHash) {
  const now = performance.now();
  state.frameTimes.push(now);
  state.frameTimes = state.frameTimes.filter((time) => now - time < 4000);
  const fps = state.frameTimes.length > 1
    ? (state.frameTimes.length - 1) / ((state.frameTimes.at(-1) - state.frameTimes[0]) / 1000)
    : 0;
  const fpsText = fps.toFixed(2);
  $("fpsReadout").textContent = fpsText + " FPS";
  $("fpsStat").textContent = payload.fps ? Number(payload.fps).toFixed(2) : fpsText;
  $("frameStat").textContent = String(state.frameIndex);
  $("hashStat").textContent = highHash.slice(0, 12);
  $("bytesStat").textContent = String(payload.bytes || 0);
  $("captureStat").textContent = payload.frameIntervalMs
    ? String(Math.round(payload.frameIntervalMs)) + " ms"
    : (payload.latencyMs ? String(Math.round(payload.latencyMs)) + " ms" : "-");
  updateGoalTelemetry(payload, fps);
}

function updateGoalTelemetry(payload = {}, measuredFps = 0) {
  const dirtyEnabled = $("dirtyCropCheck").checked || state.streamMode.includes("dirty");
  const uniqueHashes = state.uniqueCropHashes.size;
  const valid = dirtyEnabled ? state.validCropFrames : state.frameIndex;
  const total = dirtyEnabled ? Math.max(state.cropEvents, state.validCropFrames) : state.frameIndex;
  const fps = Number(payload.fps || measuredFps || 0);
  const goalPass = dirtyEnabled
    && state.dirtyFallbacks === 0
    && valid >= 3
    && uniqueHashes > 1
    && fps >= 15;
  state.dirtyGoalPass = goalPass;
  $("protocolStat").textContent = dirtyEnabled
    ? (state.lastCrop?.protocol || state.lastCrop?.magic || (state.syntheticDirty ? "synthetic" : "dirty"))
    : "ROI";
  $("validStat").textContent = String(valid) + "/" + String(total);
  $("uniqueHashStat").textContent = String(uniqueHashes);
  $("goalStat").textContent = goalPass ? "pass" : "no";
}

function maybePushTick() {
  const now = performance.now();
  if (now - state.lastTickAt < 1200 || state.tickIndex && state.frameIndex % 20 !== 0) {
    return;
  }
  state.lastTickAt = now;
  pushTick().catch((error) => log("auto tick failed: " + error.message));
}

async function pushTick() {
  if (!(await confirmLiveTextWrite())) {
    return false;
  }
  state.tickIndex += 1;
  const text = "MIRROR " + String(state.tickIndex).padStart(3, "0") + " " + Date.now().toString(36).slice(-5);
  await fetchJson("/api/send-caption", {
    method: "POST",
    body: JSON.stringify({
      text,
      displayMode: 7,
      assistantSlot: 0,
      refreshDisplayMode: state.tickIndex === 1,
      assistantPostSequence: true,
      noInit: state.tickIndex !== 1,
      writeWithoutResponse: true,
      fastNoResponse: false,
    }),
  });
  log("tick " + state.tickIndex);
  return true;
}

async function confirmLiveTextWrite() {
  if (state.liveTextWriteConfirmed) {
    return true;
  }
  const ok = window.confirm("Send live text to the Peripheral display? This changes what the wearer sees.");
  if (!ok) {
    $("autoTickCheck").checked = false;
    log("live text write blocked");
    return false;
  }
  state.liveTextWriteConfirmed = true;
  log("live text write confirmed");
  return true;
}

function syncTickTimer() {
  window.clearInterval(state.tickTimer);
  if (state.running && $("autoTickCheck").checked) {
    log("auto text embedded in stream");
  }
}

async function refreshStatus() {
  try {
    const status = await fetchJson("/api/framebuffer/status");
    $("bridgeStat").textContent = status.macBridge?.running ? "running" : "idle";
    if (!state.baselineLoaded && $("baselineCheck").checked) {
      $("baselineStat").textContent = status.baseline?.available ? "ready" : "missing";
    }
  } catch (error) {
    $("bridgeStat").textContent = "error";
  }
}

function syncEffect() {
  viewport.classList.remove("clean", "optical", "pov");
  viewport.classList.add($("effectSelect").value || "optical");
}

function syncOptics() {
  const x = clamp(Number($("offsetXInput").value || 0), -240, 240);
  const y = clamp(Number($("offsetYInput").value || 0), -180, 180);
  const scale = clamp(Number($("scaleInput").value || 100), 70, 135) / 100;
  opticFrame.style.setProperty("--shift-x", x + "px");
  opticFrame.style.setProperty("--shift-y", y + "px");
  opticFrame.style.setProperty("--optic-scale", String(scale));
}

function canvasStats(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  let alphaPixels = 0;
  let lumaSum = 0;
  let maxAlpha = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha <= 0) {
      continue;
    }
    const pixel = offset / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    alphaPixels += 1;
    maxAlpha = Math.max(maxAlpha, alpha);
    lumaSum += 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    width,
    height,
    alphaPixels,
    maxAlpha,
    avgLuma: alphaPixels ? Number((lumaSum / alphaPixels).toFixed(2)) : 0,
    bbox: alphaPixels ? [minX, minY, maxX, maxY] : null,
  };
}

function rawHighNibbleStats() {
  let nonzero = 0;
  let max = 0;
  let highSum = 0;
  for (const byte of state.raw) {
    const high = byte >> 4;
    if (high > 0) {
      nonzero += 1;
      highSum += high;
      max = Math.max(max, high);
    }
  }
  return { nonzero, max, avg: nonzero ? Number((highSum / nonzero).toFixed(3)) : 0 };
}

function debugSnapshot() {
  const video = $("cameraVideo");
  return {
    running: state.running,
    cameraOn: state.cameraOn,
    clipRecording: state.clipRecording,
    clipChunks: state.clipChunks.length,
    clipUrlReady: Boolean(state.clipUrl),
    frameIndex: state.frameIndex,
    tickIndex: state.tickIndex,
    lastHighHash: state.lastHighHash,
    status: $("statusLine").textContent,
    fpsReadout: $("fpsReadout").textContent,
    fpsStat: $("fpsStat").textContent,
    bytesStat: $("bytesStat").textContent,
    bridgeStat: $("bridgeStat").textContent,
    effect: $("effectSelect").value,
    decode: $("decodeSelect").value,
    preset: $("presetSelect").value,
    pageStart: $("pageStartInput").value,
    pageCount: $("pageCountInput").value,
    pipelineWindow: $("pipelineWindowInput").value,
    burstWindow: $("burstWindowInput").value,
    autoTick: $("autoTickCheck").checked,
    textTemplate: $("textTemplateInput").value,
    dirtyCropEnabled: $("dirtyCropCheck").checked,
    adaptiveEnabled: $("adaptiveCheck").checked,
    adaptivePhase: state.adaptivePhase,
    adaptiveBbox: state.adaptiveBbox,
    adaptiveRoi: state.adaptiveRoi,
    adaptiveWideFrames: state.adaptiveWideFrames,
    syntheticDirty: state.syntheticDirty,
    dirtyFallbacks: state.dirtyFallbacks,
    lastCrop: state.lastCrop,
    streamMode: state.streamMode,
    cropEvents: state.cropEvents,
    validCropFrames: state.validCropFrames,
    uniqueCropHashes: state.uniqueCropHashes.size,
    lastDirtyStatus: state.lastDirtyStatus,
    lastFallbackReason: state.lastFallbackReason,
    dirtyGoalPass: state.dirtyGoalPass,
    protocolStat: $("protocolStat").textContent,
    validStat: $("validStat").textContent,
    uniqueHashStat: $("uniqueHashStat").textContent,
    goalStat: $("goalStat").textContent,
    baselineEnabled: $("baselineCheck").checked,
    baselineLoaded: state.baselineLoaded,
    baselineSha256: state.baselineSha256,
    baselineBytes: state.baselineBytes,
    baselineStat: $("baselineStat").textContent,
    eventSourceReadyState: state.eventSource ? state.eventSource.readyState : null,
    cameraReadyState: video.readyState,
    cameraVideoWidth: video.videoWidth || 0,
    cameraVideoHeight: video.videoHeight || 0,
    rawHighNibble: rawHighNibbleStats(),
    frameCanvas: canvasStats(frameCanvas),
    glowCanvas: canvasStats(glowCanvas),
    bloomCanvas: canvasStats(bloomCanvas),
    fringeCanvas: canvasStats(fringeCanvas),
    recordCanvas: canvasStats(recordCanvas),
    clipDownloadVisible: !$("clipDownload").hidden,
    clipDownloadHrefReady: String($("clipDownload").href || "").startsWith("blob:"),
  };
}

window.__peripheralRealMirrorDebug = {
  snapshot: debugSnapshot,
  startStream,
  stopStream,
  startClip,
  stopClip,
  toggleCamera,
  loadBaselineFrame,
};

function rawFromBase64(value) {
  const binary = atob(value || "");
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

function highNibbleSignature(bytes) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] & 0xf0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + "-" + String(bytes.length);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || response.statusText || "request failed");
  }
  return payload;
}

function setStatus(value) {
  $("statusLine").textContent = value;
}

function log(message) {
  const row = document.createElement("div");
  row.textContent = new Date().toLocaleTimeString() + "  " + message;
  $("log").prepend(row);
  while ($("log").children.length > 24) {
    $("log").lastElementChild.remove();
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}
