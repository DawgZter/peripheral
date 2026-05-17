import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { GLASS_DISPLAY, assertWidget, cleanText, type GlassWidget } from "../../peripheral-protocol/src/index.js";
import { FONT_5X7, UNKNOWN_GLYPH } from "./bitmap-font.js";
import { encodeGrayscalePng } from "./png.js";

export type RenderOptions = {
  assetRoot?: string;
  width?: number;
  height?: number;
};

export type RenderArtifact = {
  schema: "peripheral-hud-frame-v1";
  createdAt: string;
  widgetId: string;
  widgetType: string;
  pngPath: string;
  sidecarPath: string;
  width: number;
  height: number;
  bitsPerPixel: number;
  pixelsBase64: string;
  stats: {
    litPixels: number;
    rawBytes: number;
  };
};

const BLACK = 0;
const DIM = 85;
const MID = 150;
const WHITE = 255;

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number = GLASS_DISPLAY.width, height: number = GLASS_DISPLAY.height, fill = BLACK) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.pixels.fill(fill);
  }

  rect(x: number, y: number, w: number, h: number, value = WHITE): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      this.pixels.fill(value, yy * this.width + x0, yy * this.width + x1);
    }
  }

  outline(x: number, y: number, w: number, h: number, value = WHITE, t = 2): void {
    this.rect(x, y, w, t, value);
    this.rect(x, y + h - t, w, t, value);
    this.rect(x, y, t, h, value);
    this.rect(x + w - t, y, t, h, value);
  }

  line(x0: number, y0: number, x1: number, y1: number, value = WHITE, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = Math.round(x0);
    let y = Math.round(y0);
    while (true) {
      this.rect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, value);
      if (x === Math.round(x1) && y === Math.round(y1)) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

export function renderWidget(input: unknown, options: RenderOptions = {}): { widget: GlassWidget; raster: Raster; pixels2bpp: Buffer } {
  const widget = assertWidget(input);
  const raster = new Raster(options.width ?? GLASS_DISPLAY.width, options.height ?? GLASS_DISPLAY.height);
  drawWidget(raster, widget, options);
  return { widget, raster, pixels2bpp: pack2bpp(raster.pixels) };
}

export function renderWidgetFile(inputPath: string, outPath: string, options: RenderOptions = {}): RenderArtifact {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  return renderWidgetToFile(input, outPath, options);
}

export function renderWidgetToFile(input: unknown, outPath: string, options: RenderOptions = {}): RenderArtifact {
  const { widget, raster, pixels2bpp } = renderWidget(input, options);
  const pngPath = resolve(outPath);
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath, encodeGrayscalePng(raster.width, raster.height, raster.pixels));
  const sidecarPath = pngPath.replace(/\.png$/i, "") + ".frame.json";
  const artifact: RenderArtifact = {
    schema: "peripheral-hud-frame-v1",
    createdAt: new Date().toISOString(),
    widgetId: widget.id,
    widgetType: widget.type,
    pngPath,
    sidecarPath,
    width: raster.width,
    height: raster.height,
    bitsPerPixel: GLASS_DISPLAY.bitsPerPixel,
    pixelsBase64: pixels2bpp.toString("base64"),
    stats: {
      litPixels: raster.pixels.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
      rawBytes: pixels2bpp.length,
    },
  };
  writeFileSync(sidecarPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  return artifact;
}

export function pack2bpp(grayscale: Uint8Array): Buffer {
  const packed = Buffer.alloc(Math.ceil((grayscale.length * 2) / 8));
  for (let i = 0; i < grayscale.length; i += 1) {
    const level = Math.max(0, Math.min(3, Math.round(grayscale[i]! / 85)));
    packed[Math.floor(i / 4)]! |= level << (6 - (i % 4) * 2);
  }
  return packed;
}

function drawWidget(r: Raster, widget: GlassWidget, options: RenderOptions): void {
  r.outline(4, 4, r.width - 8, r.height - 8, DIM, 2);
  r.rect(18, 18, 46, 4, WHITE);
  r.rect(r.width - 74, 18, 46, 4, WHITE);
  switch (widget.type) {
    case "live_call":
      drawLiveCall(r, widget);
      break;
    case "strategy_card":
      drawStrategyCard(r, widget);
      break;
    case "people_list":
      drawPeopleList(r, widget);
      break;
    case "person_detail":
      drawPersonDetail(r, widget, options);
      break;
    case "approval_card":
      drawApprovalCard(r, widget);
      break;
    case "status_icon":
      drawStatusIcon(r, widget);
      break;
    case "generic_card":
      drawGenericCard(r, widget);
      break;
    case "table":
      drawTable(r, widget);
      break;
    case "checklist":
      drawChecklist(r, widget);
      break;
    case "terminal":
      drawTerminal(r, widget);
      break;
  }
}

function drawGenericCard(r: Raster, widget: GlassWidget): void {
  drawIcon(r, widget.icon || "card", 28, 38, 38);
  drawText(r, widget.title, 82, 38, 4, WHITE, 420);
  if (widget.status) drawPill(r, widget.status, 82, 78, 2);
  drawWrapped(r, widget.body || "", 34, 118, 470, 2, 4, WHITE);
  drawBullets(r, widget.bullets || [], 44, 178, 440, 2, 3);
  drawFooter(r, widget.footer || widget.source);
}

function drawLiveCall(r: Raster, widget: GlassWidget): void {
  drawIcon(r, "phone", 24, 34, 38);
  drawText(r, widget.title, 76, 36, 3, WHITE, 330);
  drawPill(r, widget.status || "CALLING", 390, 35, 2);
  const transcript = widget.transcript || [];
  const first = transcript[transcript.length - 2] || transcript[0];
  const second = transcript[transcript.length - 1];
  drawBubble(r, first?.speaker || "agent", first?.text || "Agent is preparing...", 28, 88, 484, 58);
  drawBubble(r, second?.speaker || "other", second?.text || "Waiting for response...", 28, 156, 484, 58);
  drawChips(r, widget.facts || widget.bullets || [], 28, 228);
}

function drawStrategyCard(r: Raster, widget: GlassWidget): void {
  drawText(r, widget.title, 30, 32, 3, WHITE, 410);
  drawIcon(r, "cards", 456, 28, 44);
  drawText(r, "HAND", 38, 78, 2, MID, 110);
  drawText(r, widget.player_hand || "", 38, 104, 4, WHITE, 180);
  drawText(r, "DEALER", 326, 78, 2, MID, 120);
  drawText(r, widget.dealer_card || "", 326, 104, 4, WHITE, 170);
  r.rect(28, 152, 484, 2, DIM);
  drawText(r, widget.action || widget.primary || "HOLD", 38, 166, 6, WHITE, 430);
  drawWrapped(r, widget.body || "", 38, 226, 450, 2, 2, MID);
}

function drawPeopleList(r: Raster, widget: GlassWidget): void {
  drawText(r, widget.title, 30, 32, 3, WHITE, 420);
  (widget.people || []).slice(0, 3).forEach((person, index) => {
    const y = 76 + index * 62;
    r.outline(28, y, 484, 52, index === 2 ? WHITE : DIM, 2);
    drawText(r, String(index + 1), 42, y + 14, 3, WHITE, 32);
    drawText(r, person.name, 82, y + 9, 3, WHITE, 260);
    drawText(r, [person.role, person.company].filter(Boolean).join(" / "), 84, y + 34, 1, MID, 310);
    if (person.score !== undefined) drawPill(r, String(person.score), 438, y + 13, 2);
  });
  drawFooter(r, widget.footer || "SELECT PERSON");
}

function drawPersonDetail(r: Raster, widget: GlassWidget, options: RenderOptions): void {
  drawAvatar(r, widget, 28, 54, 148, 148, options.assetRoot);
  drawText(r, widget.name || widget.title, 196, 50, 3, WHITE, 300);
  drawText(r, [widget.role, widget.company].filter(Boolean).join(" / "), 198, 82, 1, MID, 300);
  drawWrapped(r, widget.body || "", 198, 108, 300, 2, 3, WHITE);
  drawBullets(r, widget.facts || widget.bullets || [], 206, 174, 286, 1, 4);
  drawFooter(r, widget.footer || widget.source || "DETAIL");
}

function drawApprovalCard(r: Raster, widget: GlassWidget): void {
  drawIcon(r, widget.icon || "warning", 28, 34, 42);
  drawText(r, widget.title, 84, 36, 3, WHITE, 390);
  drawPill(r, widget.status || "NEEDS INPUT", 84, 70, 2);
  drawWrapped(r, widget.body || "", 34, 116, 460, 2, 4, WHITE);
  (widget.choices || []).slice(0, 3).forEach((choice, index) => {
    const x = 34 + index * 160;
    const primary = choice.tone === "primary" || index === 0;
    if (primary) {
      r.rect(x, 220, 142, 34, WHITE);
      drawText(r, choice.label, x + 12, 229, 2, BLACK, 118);
    } else {
      r.outline(x, 220, 142, 34, DIM, 2);
      drawText(r, choice.label, x + 12, 229, 2, WHITE, 118);
    }
  });
}

function drawStatusIcon(r: Raster, widget: GlassWidget): void {
  drawIcon(r, widget.icon || "warning", 214, 56, 112);
  drawCentered(r, widget.status || widget.title, 34, 182, 472, 4, WHITE);
  drawWrapped(r, widget.body || "", 78, 222, 380, 2, 2, MID);
}

function drawTable(r: Raster, widget: GlassWidget): void {
  drawText(r, widget.title, 30, 32, 3, WHITE, 420);
  if (widget.status) drawPill(r, widget.status, 390, 31, 2);
  const columns = (widget.columns || []).slice(0, 4);
  const rows = (widget.rows || []).slice(0, 5);
  const x = 28;
  const y = 78;
  const w = 484;
  const colW = Math.floor(w / Math.max(1, columns.length || 1));
  r.rect(x, y, w, 2, WHITE);
  columns.forEach((column, index) => {
    drawText(r, column, x + index * colW + 8, y + 12, 1, MID, colW - 12);
  });
  r.rect(x, y + 34, w, 2, DIM);
  rows.forEach((row, rowIndex) => {
    const values = tableRowValues(row, columns);
    const yy = y + 48 + rowIndex * 31;
    values.slice(0, columns.length || 1).forEach((value, index) => {
      drawText(r, value, x + index * colW + 8, yy, 1, WHITE, colW - 12);
    });
    r.rect(x, yy + 22, w, 1, DIM);
  });
  drawFooter(r, widget.footer || widget.source);
}

function drawChecklist(r: Raster, widget: GlassWidget): void {
  drawText(r, widget.title, 30, 32, 3, WHITE, 420);
  if (widget.status) drawPill(r, widget.status, 390, 31, 2);
  const items = (widget.items || []).slice(0, 6);
  items.forEach((item, index) => {
    const y = 78 + index * 29;
    r.outline(32, y, 18, 18, item.checked ? WHITE : DIM, 2);
    if (item.checked) {
      r.line(36, y + 9, 41, y + 14, WHITE, 2);
      r.line(41, y + 14, 49, y + 4, WHITE, 2);
    }
    drawText(r, item.label, 64, y + 2, 2, WHITE, 350);
    if (item.status) drawText(r, String(item.status), 430, y + 4, 1, MID, 70);
  });
  if (!items.length) drawWrapped(r, widget.body || "No checklist items.", 42, 100, 430, 2, 4, WHITE);
  drawFooter(r, widget.footer || widget.source);
}

function drawTerminal(r: Raster, widget: GlassWidget): void {
  drawText(r, widget.title, 24, 18, 2, WHITE, 320);
  if (widget.status) drawPill(r, widget.status, 382, 15, 1);
  r.rect(22, 44, 496, 2, DIM);

  const lines = terminalVisibleLines(widget.terminal || (widget.body ? [widget.body] : []), 82, 13);
  lines.forEach((line, index) => {
    const value = line.startsWith(">") ? WHITE : index === lines.length - 1 ? WHITE : MID;
    drawText(r, line, 26, 58 + index * 14, 1, value, 490);
  });

  const prompt = widget.prompt || widget.footer || "TYPE TO HERMES / EXIT CLI";
  r.rect(22, 246, 496, 2, DIM);
  drawText(r, prompt, 26, 258, 1, WHITE, 490);
}

function drawBubble(r: Raster, speaker: string, text: string, x: number, y: number, w: number, h: number): void {
  r.outline(x, y, w, h, DIM, 2);
  drawText(r, speaker.toUpperCase().slice(0, 10), x + 12, y + 8, 1, MID, 90);
  drawWrapped(r, text, x + 108, y + 9, w - 124, 2, 2, WHITE);
}

function tableRowValues(row: unknown, columns: string[]): string[] {
  if (Array.isArray(row)) return row.map((value) => cleanText(value, 36));
  if (row && typeof row === "object") {
    const record = row as Record<string, unknown>;
    return columns.map((column) => cleanText(record[column] ?? record[column.toLowerCase()] ?? "", 36));
  }
  return [cleanText(row, 36)];
}

function drawBullets(r: Raster, bullets: string[], x: number, y: number, maxWidth: number, scale: number, maxItems: number): void {
  bullets.slice(0, maxItems).forEach((bullet, index) => {
    const yy = y + index * (scale * 14 + 4);
    r.rect(x, yy + scale * 3, scale * 4, scale * 4, WHITE);
    drawText(r, bullet, x + scale * 8, yy, scale, WHITE, maxWidth);
  });
}

function drawChips(r: Raster, values: string[], x: number, y: number): void {
  let cursor = x;
  for (const value of values.slice(0, 3)) {
    const label = cleanText(value, 18).toUpperCase();
    const w = Math.min(154, measureText(label, 1) + 18);
    r.outline(cursor, y, w, 30, DIM, 2);
    drawText(r, label, cursor + 8, y + 9, 1, WHITE, w - 16);
    cursor += w + 10;
  }
}

function drawPill(r: Raster, text: string, x: number, y: number, scale: number): void {
  const label = cleanText(text, 18).toUpperCase();
  const w = Math.min(150, measureText(label, scale) + 18);
  r.rect(x, y, w, scale * 12 + 10, WHITE);
  drawText(r, label, x + 8, y + 5, scale, BLACK, w - 12);
}

function drawFooter(r: Raster, text?: string): void {
  if (!text) return;
  r.rect(24, 256, 492, 2, DIM);
  drawText(r, text, 30, 264, 1, MID, 450);
}

function terminalVisibleLines(lines: string[], maxChars: number, maxLines: number): string[] {
  const wrapped = lines.flatMap((line) => wrapTerminalLine(line, maxChars));
  return wrapped.slice(-maxLines);
}

function wrapTerminalLine(value: string, maxChars: number): string[] {
  const text = cleanText(value, 500);
  if (!text) return [""];
  const output: string[] = [];
  for (let cursor = 0; cursor < text.length; cursor += maxChars) {
    output.push(text.slice(cursor, cursor + maxChars));
  }
  return output;
}

function drawAvatar(r: Raster, widget: GlassWidget, x: number, y: number, w: number, h: number, assetRoot?: string): void {
  r.outline(x, y, w, h, WHITE, 2);
  let initials = initialsFor(widget.name || widget.title);
  let pattern = "diagonal";
  if (widget.left_image && assetRoot) {
    try {
      const asset = JSON.parse(readFileSync(resolve(assetRoot, widget.left_image), "utf8")) as { initials?: string; pattern?: string };
      initials = asset.initials || initials;
      pattern = asset.pattern || pattern;
    } catch {
      pattern = "diagonal";
    }
  }
  for (let yy = y + 6; yy < y + h - 6; yy += 1) {
    for (let xx = x + 6; xx < x + w - 6; xx += 1) {
      const on = pattern === "grid" ? xx % 18 === 0 || yy % 18 === 0 : pattern === "bands" ? Math.floor((yy - y) / 14) % 2 === 0 : (xx + yy) % 22 < 10;
      if (on) r.rect(xx, yy, 1, 1, DIM);
    }
  }
  drawCentered(r, initials, x, y + Math.round(h / 2) - 18, w, 5, WHITE);
}

function drawIcon(r: Raster, icon: string, x: number, y: number, size: number): void {
  const s = size;
  if (icon === "phone") {
    r.outline(x + s * 0.25, y + s * 0.05, s * 0.5, s * 0.9, WHITE, 3);
    r.rect(x + s * 0.43, y + s * 0.78, s * 0.14, s * 0.05, WHITE);
  } else if (icon === "cards") {
    r.outline(x + 4, y + 2, s * 0.52, s * 0.72, WHITE, 2);
    r.outline(x + s * 0.34, y + s * 0.2, s * 0.52, s * 0.72, WHITE, 2);
    drawText(r, "A", x + s * 0.44, y + s * 0.38, 2, WHITE, s);
  } else if (icon === "warning") {
    r.line(x + s / 2, y + 4, x + s - 4, y + s - 4, WHITE, 4);
    r.line(x + s - 4, y + s - 4, x + 4, y + s - 4, WHITE, 4);
    r.line(x + 4, y + s - 4, x + s / 2, y + 4, WHITE, 4);
    r.rect(x + s / 2 - 2, y + s * 0.38, 4, s * 0.24, WHITE);
    r.rect(x + s / 2 - 2, y + s * 0.72, 4, 4, WHITE);
  } else if (icon === "check") {
    r.line(x + s * 0.12, y + s * 0.55, x + s * 0.4, y + s * 0.82, WHITE, 5);
    r.line(x + s * 0.4, y + s * 0.82, x + s * 0.9, y + s * 0.16, WHITE, 5);
  } else {
    r.outline(x, y, s, s, WHITE, 2);
    drawText(r, "HUD", x + 7, y + Math.round(s / 2) - 6, 1, WHITE, s - 8);
  }
}

function drawCentered(r: Raster, text: string, x: number, y: number, width: number, scale: number, value: number): void {
  const label = cleanText(text, 48).toUpperCase();
  drawText(r, label, x + Math.max(0, Math.round((width - measureText(label, scale)) / 2)), y, scale, value, width);
}

function drawWrapped(r: Raster, text: string, x: number, y: number, maxWidth: number, scale: number, maxLines: number, value: number): void {
  wrapText(text, maxWidth, scale, maxLines).forEach((line, index) => {
    drawText(r, line, x, y + index * (scale * 9 + 4), scale, value, maxWidth);
  });
}

function wrapText(text: string, maxWidth: number, scale: number, maxLines: number): string[] {
  const words = cleanText(text, 240).toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, scale) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function drawText(r: Raster, text: string, x: number, y: number, scale: number, value: number, maxWidth: number): number {
  const label = cleanText(text, 120).toUpperCase();
  let cursor = Math.round(x);
  const maxX = Math.round(x + maxWidth);
  for (const char of label) {
    if (cursor + 5 * scale > maxX) break;
    const glyph = FONT_5X7[char] || UNKNOWN_GLYPH;
    glyph.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx += 1) {
        if (row[xx] === "1") r.rect(cursor + xx * scale, Math.round(y) + yy * scale, scale, scale, value);
      }
    });
    cursor += 6 * scale;
  }
  return cursor - x;
}

function measureText(text: string, scale: number): number {
  return cleanText(text, 200).length * 6 * scale;
}

function initialsFor(text: string): string {
  return text.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function defaultFramePath(outDir: string, widget: GlassWidget): string {
  const safeId = widget.id.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48) || "widget";
  return resolve(outDir, `${Date.now()}-${widget.type}-${safeId}.png`);
}

export function previewName(inputPath: string): string {
  return basename(inputPath).replace(/\.json$/i, ".png");
}
