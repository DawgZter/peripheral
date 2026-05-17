# Peripheral History

## 1. Readback Mechanics

The first useful proof was not visual quality. It was confirming that the glasses could answer host-driven display-surface page requests at all. The important split was:

- Transport worked: the host could request pages and receive bytes.
- Surface selection was still uncertain: early candidate buffers could be readable but not the active wearer-view surface.

That kept the work focused on display memory routing instead of re-litigating display transport plumbing.

## 2. ROI And Dirty Crop

Full display-surface pulls are logically possible but too slow for a demo loop. The panel is 540x280 at 4bpp, or about 75,600 bytes before transport overhead. The practical path became:

- read a small region of interest for speed,
- detect changed/nonzero pixels,
- expand the crop enough to avoid clipping,
- periodically rescan wider when the UI changes.

The dirty-crop work found compressed NZR1/HNR1 style responses that made text-band streaming usable.

## 3. Real Mirror Page

web/real-mirror.html and web/real-mirror.js became the advanced tuning surface:

- packed 4bpp display decode,
- ROI and dirty-crop streams,
- adaptive wide/repair/focus phases,
- camera/POV composition,
- recording hooks and telemetry.

This page is useful for engineering and tuning, but too busy for a live demo.

## 4. One-Click Cast Page

The current demo path is web/cast-mirror.html:

- click Start,
- select/start a Mac camera,
- stream Peripheral display dirty-crops,
- overlay the glasses view as a green optical HUD,
- rescan if the crop blanks, reaches an edge, or gets stale.

The first one-off recorder used a hardcoded crop and clipped the border. The current page keeps a taller scan/focus band and biases the crop upward to preserve the chat frame.
