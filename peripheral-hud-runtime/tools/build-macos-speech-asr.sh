#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
src="$script_dir/macos-speech-asr/MacSpeechAsr.swift"
plist="$script_dir/macos-speech-asr/Info.plist"
out_dir="$script_dir/bin"
app="$out_dir/PeripheralMacASR.app"
contents="$app/Contents"
macos="$contents/MacOS"
out="$macos/peripheral-mac-asr"

mkdir -p "$macos"
cp "$plist" "$contents/Info.plist"
swiftc \
  -O \
  -framework AVFoundation \
  -framework Foundation \
  -framework Speech \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "$plist" \
  "$src" \
  -o "$out"

codesign --force --deep --sign - "$app" >/dev/null 2>&1 || true
"$out" --self-test >/dev/null
printf '%s\n' "$out"
