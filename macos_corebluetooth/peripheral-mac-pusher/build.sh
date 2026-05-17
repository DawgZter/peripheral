#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${SDKROOT:-/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk}"
TARGET="${SWIFT_TARGET:-arm64-apple-macosx15.0}"
OUT_DIR="$ROOT/.build/manual"

mkdir -p "$OUT_DIR"

swiftc \
  -sdk "$SDK" \
  -target "$TARGET" \
  -parse-as-library \
  -module-name PeripheralFrame \
  -emit-module \
  "$ROOT/Sources/PeripheralFrame/PeripheralFrame.swift" \
  -emit-module-path "$OUT_DIR/PeripheralFrame.swiftmodule"

swiftc \
  -sdk "$SDK" \
  -target "$TARGET" \
  -parse-as-library \
  -module-name PeripheralFrame \
  -c "$ROOT/Sources/PeripheralFrame/PeripheralFrame.swift" \
  -o "$OUT_DIR/PeripheralFrame.o"

swiftc \
  -sdk "$SDK" \
  -target "$TARGET" \
  -I "$OUT_DIR" \
  "$ROOT/Sources/PeripheralMacPusher/main.swift" \
  "$OUT_DIR/PeripheralFrame.o" \
  -framework CoreBluetooth \
  -o "$OUT_DIR/peripheral-mac-pusher"

echo "$OUT_DIR/peripheral-mac-pusher"
