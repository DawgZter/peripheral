#!/usr/bin/env python3
"""Dry-run-first live display validation helper for Peripheral glasses.

This script intentionally does not start the local web sidecar and does not
touch the live display transport unless --live is provided. It posts to the
existing local sidecar endpoints and saves text-only JSON evidence. Live
scenarios that send captions or text ticks also require --allow-display-change.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DISPLAY_WIDTH = 540
DISPLAY_HEIGHT = 280
DISPLAY_ROW_BYTES = 270
DISPLAY_PAGE_SIZE = 252


def _sidecar_metadata(raw_path: Path) -> dict[str, Any]:
    sidecar = raw_path.with_suffix(".json")
    if not sidecar.exists():
        return {}
    try:
        return json.loads(sidecar.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _byte_position(index: int, page_start: int, page_size: int = DISPLAY_PAGE_SIZE) -> tuple[int, int, int]:
    absolute = page_start * page_size + index
    y = absolute // DISPLAY_ROW_BYTES
    byte_x = absolute % DISPLAY_ROW_BYTES
    return byte_x, byte_x * 2, y


def _bbox_add(bbox: list[int] | None, x: int, y: int) -> list[int]:
    if bbox is None:
        return [x, y, x, y]
    bbox[0] = min(bbox[0], x)
    bbox[1] = min(bbox[1], y)
    bbox[2] = max(bbox[2], x)
    bbox[3] = max(bbox[3], y)
    return bbox


def summarize_raw(raw_path: Path) -> dict[str, Any]:
    raw = raw_path.read_bytes()
    metadata = _sidecar_metadata(raw_path)
    page_start = int(metadata.get("pageStart") or 0)
    page_size = int(metadata.get("pageSize") or DISPLAY_PAGE_SIZE)
    nonzero = 0
    bbox: list[int] | None = None
    pages: set[int] = set()
    for index, byte in enumerate(raw):
        if byte & 0xF0:
            nonzero += 1
            _, x, y = _byte_position(index, page_start, page_size)
            if 0 <= y < DISPLAY_HEIGHT:
                bbox = _bbox_add(bbox, x, y)
            pages.add(page_start + index // page_size)
    return {
        "rawPath": str(raw_path),
        "rawBytes": len(raw),
        "rawSha256": hashlib.sha256(raw).hexdigest(),
        "pageStart": page_start,
        "pageCount": int(metadata.get("pageCount") or max(1, (len(raw) + page_size - 1) // page_size)),
        "pageSize": page_size,
        "highNibbleNonZeroBytes": nonzero,
        "highNibbleBbox": bbox,
        "highNibblePages": sorted(pages),
    }


def high_nibble_diff(first: bytes, second: bytes, page_start: int, page_size: int = DISPLAY_PAGE_SIZE) -> dict[str, Any]:
    changed = 0
    bbox: list[int] | None = None
    pages: set[int] = set()
    compared = min(len(first), len(second))
    for index in range(compared):
        if (first[index] & 0xF0) != (second[index] & 0xF0):
            changed += 1
            _, x, y = _byte_position(index, page_start, page_size)
            if 0 <= y < DISPLAY_HEIGHT:
                bbox = _bbox_add(bbox, x, y)
            pages.add(page_start + index // page_size)
    return {
        "comparedBytes": compared,
        "highNibbleChangedBytes": changed,
        "highNibbleChangedPages": sorted(pages),
        "highNibbleChangedBbox": bbox,
    }


SCENARIOS: dict[str, dict[str, Any]] = {
    "capture-roi-3": {
        "endpoint": "/api/framebuffer/fast-loop",
        "payload": {
            "cycles": 80,
            "pageStart": 184,
            "pageCount": 3,
            "pageTimeoutMs": 8000,
            "writeWithoutResponse": True,
            "pipelineWindow": 8,
            "fastNoResponse": True,
            "sendDelayMs": 0,
            "continuous": True,
        },
        "notes": "Capture-only small ROI. This is the least risky 15 FPS check.",
    },
    "capture-roi-4": {
        "endpoint": "/api/framebuffer/fast-loop",
        "payload": {
            "cycles": 80,
            "pageStart": 184,
            "pageCount": 4,
            "pageTimeoutMs": 8000,
            "writeWithoutResponse": True,
            "pipelineWindow": 16,
            "fastNoResponse": True,
            "sendDelayMs": 0,
            "continuous": True,
        },
        "notes": "Capture-only four-page ROI. Useful boundary check.",
    },
    "integrated-text-roi-3": {
        "endpoint": "/api/framebuffer/fast-loop",
        "payload": {
            "cycles": 40,
            "pageStart": 184,
            "pageCount": 3,
            "pageTimeoutMs": 8000,
            "writeWithoutResponse": True,
            "pipelineWindow": 8,
            "fastNoResponse": True,
            "sendDelayMs": 0,
            "continuous": True,
            "textPrefix": "FB SAFE",
            "textEveryFrames": 10,
            "textMinIntervalMs": 600,
            "textWriteWithoutResponse": False,
            "textAssistantPostSequence": True,
        },
        "notes": "Safer changing-text check. It may not repaint in this ROI.",
    },
    "async-text-roi-3": {
        "endpoint": "/api/framebuffer/fast-loop",
        "payload": {
            "cycles": 80,
            "pageStart": 184,
            "pageCount": 3,
            "pageTimeoutMs": 8000,
            "writeWithoutResponse": True,
            "pipelineWindow": 8,
            "fastNoResponse": True,
            "sendDelayMs": 0,
            "continuous": True,
            "textPrefix": "FB ASYNC",
            "textEveryFrames": 10,
            "textMinIntervalMs": 600,
            "textWriteWithoutResponse": True,
            "textFastNoResponse": False,
            "textAssistantPostSequence": True,
            "textAsync": True,
        },
        "notes": "Changing-text check that keeps the rolling capture pipeline active while caption writes are queued.",
    },
    "async-text-roi-3-light": {
        "endpoint": "/api/framebuffer/fast-loop",
        "payload": {
            "cycles": 80,
            "pageStart": 184,
            "pageCount": 3,
            "pageTimeoutMs": 8000,
            "writeWithoutResponse": True,
            "pipelineWindow": 8,
            "fastNoResponse": True,
            "sendDelayMs": 0,
            "continuous": True,
            "textPrefix": "FB ASYNC",
            "textEveryFrames": 20,
            "textMinIntervalMs": 1000,
            "textWriteWithoutResponse": True,
            "textFastNoResponse": False,
            "textAssistantPostSequence": True,
            "textAsync": True,
        },
        "notes": "Lower text-write cadence for wall-clock 15 FPS proof while still forcing visible text changes.",
    },
    "roi-sweep-3": {
        "endpoint": "/api/framebuffer/fast-loop",
        "payload": {
            "cycles": 30,
            "pageStart": 184,
            "pageCount": 3,
            "pageTimeoutMs": 8000,
            "writeWithoutResponse": True,
            "pipelineWindow": 8,
            "fastNoResponse": True,
            "sendDelayMs": 0,
            "continuous": True,
        },
        "sweepPageStarts": [150, 160, 173, 180, 184, 188],
        "notes": "Capture-only small ROI sweep for locating active/changing page ranges.",
    },
    "text-delta-roi-11": {
        "notes": "Caption A, capture active text band, caption B, capture again, then high-nibble diff.",
        "steps": [
            {
                "name": "caption_a",
                "endpoint": "/api/send-caption",
                "payload": {
                    "text": "DELTA A 111",
                    "displayMode": 7,
                    "assistantSlot": 0,
                    "refreshDisplayMode": True,
                    "assistantPostSequence": True,
                    "writeWithoutResponse": True,
                    "fastNoResponse": False,
                    "noInit": True,
                },
                "sleepAfter": 1.2,
            },
            {
                "name": "capture_a",
                "endpoint": "/api/framebuffer/capture",
                "payload": {
                    "pageStart": 180,
                    "pageCount": 11,
                    "pageTimeoutMs": 8000,
                    "writeWithoutResponse": True,
                    "pipelineWindow": 4,
                    "fastNoResponse": True,
                    "sendDelayMs": 0,
                    "includeRaw": False,
                    "noInit": True,
                },
                "sleepAfter": 0.5,
            },
            {
                "name": "caption_b",
                "endpoint": "/api/send-caption",
                "payload": {
                    "text": "DELTA B 222",
                    "displayMode": 7,
                    "assistantSlot": 0,
                    "refreshDisplayMode": False,
                    "assistantPostSequence": True,
                    "writeWithoutResponse": True,
                    "fastNoResponse": False,
                    "noInit": True,
                },
                "sleepAfter": 1.2,
            },
            {
                "name": "capture_b",
                "endpoint": "/api/framebuffer/capture",
                "payload": {
                    "pageStart": 180,
                    "pageCount": 11,
                    "pageTimeoutMs": 8000,
                    "writeWithoutResponse": True,
                    "pipelineWindow": 4,
                    "fastNoResponse": True,
                    "sendDelayMs": 0,
                    "includeRaw": False,
                    "noInit": True,
                },
            },
        ],
    },
    "stream-roi-4": {
        "kind": "stream",
        "endpoint": "/api/framebuffer/stream",
        "params": {
            "pageStart": 184,
            "pageCount": 4,
            "pipelineWindow": 8,
            "frames": 140,
            "fastNoResponse": 1,
        },
        "notes": "Throughput-only SSE ROI check; this is not a full mirror accuracy proof.",
    },
    "stream-roi-3": {
        "kind": "stream",
        "endpoint": "/api/framebuffer/stream",
        "params": {
            "pageStart": 184,
            "pageCount": 3,
            "pipelineWindow": 8,
            "frames": 140,
            "fastNoResponse": 1,
        },
        "notes": "Stable throughput-only SSE ROI check; this is not a full mirror accuracy proof.",
    },
    "stream-roi-4-ticks": {
        "kind": "stream",
        "endpoint": "/api/framebuffer/stream",
        "params": {
            "pageStart": 184,
            "pageCount": 4,
            "pipelineWindow": 8,
            "frames": 140,
            "fastNoResponse": 1,
        },
        "ticks": {
            "count": 3,
            "firstDelaySeconds": 1.2,
            "intervalSeconds": 2.0,
            "prefix": "STREAM TICK",
        },
        "notes": "Throughput-only SSE ROI while pushing low-cadence text ticks; requires separate vision/correlation proof.",
    },
    "stream-roi-3-ticks": {
        "kind": "stream",
        "endpoint": "/api/framebuffer/stream",
        "params": {
            "pageStart": 184,
            "pageCount": 3,
            "pipelineWindow": 8,
            "frames": 140,
            "fastNoResponse": 1,
        },
        "ticks": {
            "count": 3,
            "firstDelaySeconds": 1.2,
            "intervalSeconds": 2.0,
            "prefix": "STREAM TICK",
        },
        "notes": "Stable throughput-only SSE ROI while pushing low-cadence text ticks; requires separate vision/correlation proof.",
    },
}


SUMMARY_KEYS = [
    "ok",
    "durationMs",
    "totalDurationMs",
    "wallFps",
    "steadyStateFps",
    "avgFrameMs",
    "bestFrameMs",
    "p50FrameMs",
    "p90FrameMs",
    "pageStart",
    "pageCount",
    "pipelineWindow",
    "requestedPipelineWindow",
    "highPressureAllowed",
    "bytesPerFrame",
    "uniqueFrameHashes",
    "uniqueHighNibbleFrameHashes",
    "metric",
    "updateText",
    "textUpdates",
    "textEveryFrames",
    "textMinIntervalMs",
    "textTemplate",
    "textWriteWithoutResponse",
    "textFastNoResponse",
    "textAssistantPostSequence",
    "rawPath",
    "rawSha256",
    "highNibbleNonZeroBytes",
    "highNibbleBbox",
    "frames",
    "wallFps",
    "steadyStateFpsAfterWarmup",
    "uniqueHighNibbleHashes",
    "hashTransitions",
    "tickCount",
    "tickErrors",
]


DISPLAY_CHANGE_ENDPOINTS = {"/api/send-caption"}
DISPLAY_CHANGE_PAYLOAD_KEYS = {"text", "textPrefix", "textTemplate", "updateText"}


def payload_display_changing(payload: dict[str, Any]) -> bool:
    return any(bool(payload.get(key)) for key in DISPLAY_CHANGE_PAYLOAD_KEYS)


def ticks_display_changing(ticks: dict[str, Any] | None) -> bool:
    if not ticks:
        return False
    return int(ticks.get("count") or 0) > 0


def steps_display_changing(steps: list[dict[str, Any]]) -> bool:
    for step in steps:
        payload = dict(step.get("payload") or {})
        if step.get("endpoint") in DISPLAY_CHANGE_ENDPOINTS or payload_display_changing(payload):
            return True
    return False


def require_display_change_permission(args: argparse.Namespace, display_changing: bool, plan: dict[str, Any]) -> bool:
    if not args.live or not display_changing or args.allow_display_change:
        return True
    print(json.dumps(plan, indent=2, sort_keys=True))
    print("blocked: display-changing live validation requires --allow-display-change after explicit operator permission", file=sys.stderr)
    return False


def post_json(base_url: str, endpoint: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + endpoint,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def high_nibble_signature_from_base64(value: str) -> str:
    raw = base64.b64decode(value or "")
    hash_value = 2166136261
    for byte in raw:
        hash_value ^= byte & 0xF0
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"{hash_value:08x}-{len(raw)}"


def stream_url(base_url: str, endpoint: str, params: dict[str, Any]) -> str:
    encoded = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
    return base_url.rstrip("/") + endpoint + ("?" + encoded if encoded else "")


def run_tick_sequence(base_url: str, tick_config: dict[str, Any], timeout: float, errors: list[str]) -> None:
    count = int(tick_config.get("count") or 0)
    if count <= 0:
        return
    first_delay = float(tick_config.get("firstDelaySeconds") or 0)
    interval = float(tick_config.get("intervalSeconds") or 0)
    prefix = str(tick_config.get("prefix") or "STREAM TICK")
    try:
        time.sleep(max(0, first_delay))
        for index in range(count):
            text = f"{prefix} {index + 1} {int(time.time()) % 10000}"
            post_json(
                base_url,
                "/api/send-caption",
                {
                    "text": text,
                    "displayMode": 7,
                    "assistantSlot": 0,
                    "refreshDisplayMode": False,
                    "assistantPostSequence": True,
                    "noInit": True,
                    "writeWithoutResponse": True,
                    "fastNoResponse": False,
                },
                timeout,
            )
            if index + 1 < count:
                time.sleep(max(0, interval))
    except Exception as error:  # noqa: live transport/live evidence should record exact failure text.
        errors.append(str(error))


def run_stream_scenario(base_url: str, scenario: dict[str, Any], params: dict[str, Any], timeout: float) -> dict[str, Any]:
    frames = []
    tick_errors: list[str] = []
    tick_config = dict(scenario.get("ticks") or {})
    tick_thread = None
    if tick_config:
        tick_thread = threading.Thread(
            target=run_tick_sequence,
            args=(base_url, tick_config, timeout, tick_errors),
            daemon=True,
        )
        tick_thread.start()

    request = urllib.request.Request(
        stream_url(base_url, scenario["endpoint"], params),
        headers={"Accept": "text/event-stream"},
        method="GET",
    )
    started = time.time()
    event_name = None
    data_lines: list[str] = []
    stream_error = None
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", "replace").rstrip("\n")
                if line.startswith("event: "):
                    event_name = line[7:]
                elif line.startswith("data: "):
                    data_lines.append(line[6:])
                elif line.strip() == "" and event_name:
                    data = "\n".join(data_lines)
                    if event_name == "frame":
                        frame = json.loads(data)
                        if not frame.get("highNibbleSha256"):
                            frame["highNibbleSha256"] = high_nibble_signature_from_base64(frame.get("rawBase64", ""))
                        frame.pop("rawBase64", None)
                        frames.append(frame)
                        if len(frames) >= int(params.get("frames") or 0):
                            break
                    elif event_name == "stream-error":
                        stream_error = json.loads(data).get("error") or data
                        break
                    event_name = None
                    data_lines = []
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8", "replace"))
        except Exception:
            body = {"error": str(error)}
        return {"ok": False, "httpStatus": error.code, **body}

    if tick_thread:
        tick_thread.join(timeout=0.1)

    duration = time.time() - started
    intervals = [
        frame.get("frameIntervalMs")
        for frame in frames
        if isinstance(frame.get("frameIntervalMs"), (int, float))
    ]
    warm_intervals = intervals[5:] if len(intervals) > 5 else intervals
    hashes = [frame.get("highNibbleSha256") for frame in frames if frame.get("highNibbleSha256")]
    transitions = sum(1 for first, second in zip(hashes, hashes[1:]) if first != second)
    avg_interval = sum(intervals) / len(intervals) if intervals else None
    avg_warm_interval = sum(warm_intervals) / len(warm_intervals) if warm_intervals else None
    tick_count = int(tick_config.get("count") or 0)
    summary = {
        "ok": stream_error is None and not tick_errors and bool(frames),
        "frames": len(frames),
        "wallFps": round(len(frames) / max(0.001, duration), 3),
        "steadyStateFps": round(1000 / avg_interval, 3) if avg_interval else None,
        "steadyStateFpsAfterWarmup": round(1000 / avg_warm_interval, 3) if avg_warm_interval else None,
        "avgFrameMs": round(avg_interval, 1) if avg_interval else None,
        "pageStart": int(params.get("pageStart") or 0),
        "pageCount": int(params.get("pageCount") or 0),
        "pipelineWindow": int(params.get("pipelineWindow") or 0),
        "bytesPerFrame": int(params.get("pageCount") or 0) * 252,
        "uniqueHighNibbleHashes": len(set(hashes)),
        "hashTransitions": transitions,
        "tickCount": tick_count,
        "tickErrors": tick_errors,
        "metric": "sse_stream_high_nibble",
    }
    return {
        **summary,
        "durationSeconds": round(duration, 3),
        "streamError": stream_error,
        "firstFrame": frames[0] if frames else None,
        "lastFrame": frames[-1] if frames else None,
        "framesDetail": frames,
    }


def result_summary(result: dict[str, Any]) -> dict[str, Any]:
    return {key: result.get(key) for key in SUMMARY_KEYS if key in result}


def expand_requests(scenario: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    starts = scenario.get("sweepPageStarts")
    if not starts:
        return [payload]
    requests = []
    for start in starts:
        item = dict(payload)
        item["pageStart"] = int(start)
        requests.append(item)
    return requests


def result_step_summary(result: dict[str, Any]) -> dict[str, Any]:
    summary = result_summary(result)
    if "text" in result:
        summary["text"] = result.get("text")
    display_result = result.get("result")
    if isinstance(display_result, dict):
        summary["displayResult"] = {
            key: display_result.get(key)
            for key in ["ok", "transport", "queued", "rawNoResponse", "fastNoResponse", "frames", "bytes"]
            if key in display_result
        }
    return summary


def apply_step_overrides(steps: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    patched = []
    for step in steps:
        item = {
            "name": step["name"],
            "endpoint": step["endpoint"],
            "payload": dict(step.get("payload") or {}),
        }
        if "sleepAfter" in step:
            item["sleepAfter"] = step["sleepAfter"]
        if item["endpoint"] == "/api/send-caption":
            if item["name"] == "caption_a" and args.caption_a is not None:
                item["payload"]["text"] = args.caption_a
            if item["name"] == "caption_b" and args.caption_b is not None:
                item["payload"]["text"] = args.caption_b
            if args.paint_delay_ms is not None and item["name"] in {"caption_a", "caption_b"}:
                item["sleepAfter"] = max(0, args.paint_delay_ms) / 1000
        if item["endpoint"] in {"/api/framebuffer/capture", "/api/framebuffer/fast-loop"}:
            if args.page_start is not None:
                item["payload"]["pageStart"] = args.page_start
            if args.page_count is not None:
                item["payload"]["pageCount"] = args.page_count
            if args.pipeline_window is not None:
                item["payload"]["pipelineWindow"] = args.pipeline_window
            if args.text_every_frames is not None:
                item["payload"]["textEveryFrames"] = args.text_every_frames
            if args.text_min_interval_ms is not None:
                item["payload"]["textMinIntervalMs"] = args.text_min_interval_ms
            if args.allow_high_pressure:
                item["payload"]["allowHighPressure"] = True
        patched.append(item)
    return patched


def run_steps(base_url: str, steps: list[dict[str, Any]], timeout: float) -> tuple[bool, list[dict[str, Any]], dict[str, Any] | None]:
    results = []
    for step in steps:
        started = time.time()
        try:
            result = post_json(base_url, step["endpoint"], step["payload"], timeout)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read().decode("utf-8", "replace"))
            except Exception:
                body = {"error": str(error)}
            result = {"ok": False, "httpStatus": error.code, **body}
        item = {
            "name": step["name"],
            "endpoint": step["endpoint"],
            "payload": step["payload"],
            "durationSeconds": round(time.time() - started, 3),
            "summary": result_step_summary(result),
            "result": result,
        }
        results.append(item)
        if not result.get("ok"):
            return False, results, None
        sleep_after = float(step.get("sleepAfter") or 0)
        if sleep_after > 0:
            time.sleep(sleep_after)

    capture_raws = [
        Path(item["result"]["rawPath"])
        for item in results
        if item["endpoint"] == "/api/framebuffer/capture" and item["result"].get("rawPath")
    ]
    high_nibble = None
    if len(capture_raws) >= 2 and capture_raws[0].exists() and capture_raws[1].exists():
        first = summarize_raw(capture_raws[0])
        second = summarize_raw(capture_raws[1])
        high_nibble = {
            "first": first,
            "second": second,
            "diff": high_nibble_diff(capture_raws[0].read_bytes(), capture_raws[1].read_bytes(), first["pageStart"]),
        }
        high_nibble["changingPixelsOk"] = high_nibble["diff"].get("highNibbleChangedBytes", 0) > 0
    return True, results, high_nibble


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", choices=sorted(SCENARIOS))
    parser.add_argument("--base-url", default="http://127.0.0.1:8791")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--live", action="store_true", help="Actually call the local live endpoint.")
    parser.add_argument(
        "--allow-high-pressure",
        action="store_true",
        help="Pass allowHighPressure:true to the fast-loop endpoint. Use only for deliberate stress tests.",
    )
    parser.add_argument(
        "--allow-display-change",
        action="store_true",
        help="Permit live scenarios that send captions or text ticks. Use only after explicit operator approval.",
    )
    parser.add_argument("--cycles", type=int)
    parser.add_argument("--stream-frames", type=int)
    parser.add_argument("--tick-count", type=int)
    parser.add_argument("--tick-interval-ms", type=int)
    parser.add_argument("--page-start", type=int)
    parser.add_argument("--page-count", type=int)
    parser.add_argument("--pipeline-window", type=int)
    parser.add_argument("--text-every-frames", type=int)
    parser.add_argument("--text-min-interval-ms", type=int)
    parser.add_argument("--text-template")
    parser.add_argument("--caption-a")
    parser.add_argument("--caption-b")
    parser.add_argument("--paint-delay-ms", type=int)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    scenario = SCENARIOS[args.scenario]
    if scenario.get("kind") == "stream":
        params = dict(scenario["params"])
        if args.cycles is not None:
            params["frames"] = args.cycles
        if args.stream_frames is not None:
            params["frames"] = args.stream_frames
        if args.page_start is not None:
            params["pageStart"] = args.page_start
        if args.page_count is not None:
            params["pageCount"] = args.page_count
        if args.pipeline_window is not None:
            params["pipelineWindow"] = args.pipeline_window
        if args.text_every_frames is not None:
            params["textEveryFrames"] = args.text_every_frames
        if args.text_min_interval_ms is not None:
            params["textMinIntervalMs"] = args.text_min_interval_ms
        if args.text_template is not None:
            params["textTemplate"] = args.text_template
        stream_plan = {
            "schema": "peripheral-live-validation-plan-v1",
            "scenario": args.scenario,
            "kind": "stream",
            "endpoint": scenario["endpoint"],
            "url": stream_url(args.base_url, scenario["endpoint"], params),
            "baseUrl": args.base_url,
            "notes": scenario["notes"],
            "params": params,
            "ticks": scenario.get("ticks") or None,
            "live": args.live,
        }
        if args.tick_count is not None:
            stream_plan["ticks"] = dict(stream_plan.get("ticks") or {})
            stream_plan["ticks"]["count"] = args.tick_count
        if args.tick_interval_ms is not None:
            stream_plan["ticks"] = dict(stream_plan.get("ticks") or {})
            stream_plan["ticks"]["intervalSeconds"] = max(0, args.tick_interval_ms) / 1000
        display_changing = ticks_display_changing(stream_plan.get("ticks")) or payload_display_changing(params)
        stream_plan["displayChanging"] = display_changing
        stream_plan["displayChangePermission"] = bool(args.allow_display_change)
        if not args.live:
            print(json.dumps(stream_plan, indent=2, sort_keys=True))
            print("dry_run_only: pass --live to touch the glasses", file=sys.stderr)
            return 0
        if not require_display_change_permission(args, display_changing, stream_plan):
            return 2
        started = time.time()
        stream_scenario = dict(scenario)
        if stream_plan.get("ticks") is not None:
            stream_scenario["ticks"] = stream_plan["ticks"]
        result = run_stream_scenario(args.base_url, stream_scenario, params, args.timeout)
        ok = bool(result.get("ok"))
        evidence = {
            "schema": "peripheral-live-validation-result-v1",
            "createdAtUnix": started,
            "scenario": args.scenario,
            "kind": "stream",
            "endpoint": scenario["endpoint"],
            "baseUrl": args.base_url,
            "params": params,
            "ticks": stream_scenario.get("ticks") or None,
            "displayChanging": display_changing,
            "displayChangePermission": bool(args.allow_display_change),
            "ok": ok,
            "durationSeconds": round(time.time() - started, 3),
            "summary": result_summary(result),
            "result": result,
        }
        if args.json_out:
            args.json_out.parent.mkdir(parents=True, exist_ok=True)
            args.json_out.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(evidence["summary"], indent=2, sort_keys=True))
        return 0 if ok else 1

    if "steps" in scenario:
        steps = apply_step_overrides(list(scenario["steps"]), args)
        display_changing = steps_display_changing(steps)
        plan = {
            "schema": "peripheral-live-validation-plan-v1",
            "scenario": args.scenario,
            "baseUrl": args.base_url,
            "notes": scenario["notes"],
            "stepCount": len(steps),
            "steps": steps,
            "displayChanging": display_changing,
            "displayChangePermission": bool(args.allow_display_change),
            "live": args.live,
        }
        if not args.live:
            print(json.dumps(plan, indent=2, sort_keys=True))
            print("dry_run_only: pass --live to touch the glasses", file=sys.stderr)
            return 0
        if not require_display_change_permission(args, display_changing, plan):
            return 2
        started = time.time()
        ok, results, high_nibble = run_steps(args.base_url, steps, args.timeout)
        evidence = {
            "schema": "peripheral-live-validation-result-v1",
            "createdAtUnix": started,
            "scenario": args.scenario,
            "baseUrl": args.base_url,
            "stepCount": len(steps),
            "displayChanging": display_changing,
            "displayChangePermission": bool(args.allow_display_change),
            "ok": ok,
            "durationSeconds": round(time.time() - started, 3),
            "summary": {
                "ok": ok,
                "completedSteps": len(results),
                "changingPixelsOk": bool(high_nibble and high_nibble.get("changingPixelsOk")),
                "highNibbleChangedBytes": (high_nibble or {}).get("diff", {}).get("highNibbleChangedBytes"),
                "highNibbleChangedPages": (high_nibble or {}).get("diff", {}).get("highNibbleChangedPages"),
                "highNibbleChangedBbox": (high_nibble or {}).get("diff", {}).get("highNibbleChangedBbox"),
            },
            "steps": results,
            "highNibble": high_nibble,
        }
        if args.json_out:
            args.json_out.parent.mkdir(parents=True, exist_ok=True)
            args.json_out.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(evidence["summary"], indent=2, sort_keys=True))
        return 0 if ok else 1

    payload = dict(scenario["payload"])
    if args.cycles is not None:
        payload["cycles"] = args.cycles
    if args.page_start is not None:
        payload["pageStart"] = args.page_start
    if args.page_count is not None:
        payload["pageCount"] = args.page_count
    if args.pipeline_window is not None:
        payload["pipelineWindow"] = args.pipeline_window
    if args.text_every_frames is not None:
        payload["textEveryFrames"] = args.text_every_frames
    if args.text_min_interval_ms is not None:
        payload["textMinIntervalMs"] = args.text_min_interval_ms
    if args.allow_high_pressure:
        payload["allowHighPressure"] = True
    requests = expand_requests(scenario, payload)
    display_changing = any(payload_display_changing(request_payload) for request_payload in requests)

    plan = {
        "schema": "peripheral-live-validation-plan-v1",
        "scenario": args.scenario,
        "endpoint": scenario["endpoint"],
        "baseUrl": args.base_url,
        "notes": scenario["notes"],
        "payload": payload,
        "requestCount": len(requests),
        "requests": requests,
        "displayChanging": display_changing,
        "displayChangePermission": bool(args.allow_display_change),
        "live": args.live,
    }
    if not args.live:
        print(json.dumps(plan, indent=2, sort_keys=True))
        print("dry_run_only: pass --live to touch the glasses", file=sys.stderr)
        return 0
    if not require_display_change_permission(args, display_changing, plan):
        return 2

    started = time.time()
    results = []
    for request_payload in requests:
        try:
            result = post_json(args.base_url, scenario["endpoint"], request_payload, args.timeout)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read().decode("utf-8", "replace"))
            except Exception:
                body = {"error": str(error)}
            result = {"ok": False, "httpStatus": error.code, **body}
        results.append({
            "payload": request_payload,
            "summary": result_summary(result),
            "result": result,
        })
        if not result.get("ok"):
            break
        time.sleep(0.25)
    ok = all(item["result"].get("ok") for item in results) and len(results) == len(requests)
    evidence = {
        "schema": "peripheral-live-validation-result-v1",
        "createdAtUnix": started,
        "scenario": args.scenario,
        "endpoint": scenario["endpoint"],
        "baseUrl": args.base_url,
        "payload": payload,
        "requestCount": len(requests),
        "displayChanging": display_changing,
        "displayChangePermission": bool(args.allow_display_change),
        "ok": ok,
        "durationSeconds": round(time.time() - started, 3),
        "summary": results[-1]["summary"] if len(results) == 1 else {
            "ok": ok,
            "completedRequests": len(results),
            "bestSteadyStateFps": max(
                (item["summary"].get("steadyStateFps") or 0 for item in results),
                default=0,
            ),
            "maxUniqueFrameHashes": max(
                (item["summary"].get("uniqueFrameHashes") or 0 for item in results),
                default=0,
            ),
        },
        "results": results,
    }
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence["summary"], indent=2, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
