"use client";

import Tooltip from "./Tooltip";
import FormError from "@/app/components/FormError";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUST_PX,
  CANVAS,
  COLOR_GROUPS,
  CROP_X,
  CROP_Y,
  FADE_DARKEN,
  FADE_HEIGHT,
  FADE_TINT,
  GROUPS,
  LAYERS,
  PLATE_SRC,
  SHEET_DIR,
  SHIFT_X,
  TILE,
  allowedColors,
  allowedParts,
  buildPalette,
  recolor,
  tileRect,
  randomSelection,
} from "@/lib/portrait/catalog";

// The catalog's crop window, expressed as fractions of CANVAS so the same
// math works at any output `size` (the big preview and the small option
// thumbnails alike). render.js pads the bust where the window overhangs; a
// canvas needs no equivalent, since it clips a draw outside [0, size) on its
// own and the plate is already painted underneath.
const CROP_X_FRAC = CROP_X / CANVAS;
const CROP_Y_FRAC = CROP_Y / CANVAS;

const FADE_RGB = (() => {
  const { r, g, b } = FADE_TINT;
  return [Math.round(r * FADE_DARKEN), Math.round(g * FADE_DARKEN), Math.round(b * FADE_DARKEN)];
})();
import Modal from "./Modal";
import { setPortraitAvatar } from "../(app)/character/actions";

// The portrait maker's own UI — the browser half of the renderer pair
// described in web/lib/portrait/catalog.js. Everything here is preview: the
// picture that actually gets stored is rendered server-side from the selection
// this modal posts. See docs/systemdocs/PORTRAITS.md.

// Which selection key each palette in a layer's `tints` reads, so a hair
// colour change re-tints four sheets instead of fifteen.
const TINT_KEY = { skin: "skin", hair: "hairColor", eye: "eyeColor" };

const THUMB_PX = 64; // CSS size; the canvas itself stays at TILE

const TABS = [
  ...GROUPS.map((g) => ({ ...g, kind: "part" })),
  ...COLOR_GROUPS.map((c) => ({ ...c, kind: "color" })),
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Module-level so the sixteen sheets are decoded once per page load rather
// than once per open. The HTTP cache would have covered the bytes; this covers
// the decode, which is what a reopen would otherwise visibly wait on.
let assetsPromise = null;

function loadAssets() {
  assetsPromise ??= Promise.all([
    ...LAYERS.map((layer) => loadImage(`${SHEET_DIR}/${layer.file}`)),
    loadImage(PLATE_SRC),
  ])
    .then((images) => {
      const sheets = {};
      LAYERS.forEach((layer, i) => {
        sheets[layer.key] = images[i];
      });
      return { sheets, plate: images[images.length - 1] };
    })
    .catch((err) => {
      // Cleared so a reopen retries instead of latching the failure forever.
      assetsPromise = null;
      throw err;
    });
  return assetsPromise;
}

// A sheet is recoloured once per colour change and reused by the preview and
// every thumbnail on screen. Doing it per draw instead would mean a
// getImageData pass per thumbnail — 28 of them on a tab switch — and that is
// exactly the laggy-dashboard feel this app is supposed to avoid.
function tintedSheet(cache, layer, img, selection, palette) {
  const signature = layer.tints.map((t) => selection[TINT_KEY[t]]).join("/");
  const cached = cache.get(layer.key);
  if (cached && cached.signature === signature) return cached.canvas;

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  if (layer.tints.length > 0) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    recolor(pixels.data, palette);
    ctx.putImageData(pixels, 0, 0);
  }

  cache.set(layer.key, { signature, canvas });
  return canvas;
}

// The mirror of renderPortrait() in web/lib/portrait/render.js: same layers,
// same order, same palette, same SHIFT_X, same BUST_PX crop and fade. If you
// change one, change the other.
function drawPortrait(ctx, size, assets, cache, selection, palette) {
  // Overall scale from one TILE (128) to the BUST_PX-sized bust, expressed in
  // this canvas's own `size` units (128 for a thumbnail, 256 for the
  // preview) — the same ratio render.js gets from two separate resize steps.
  const bustScale = (size / TILE) * (BUST_PX / CANVAS);
  const destSize = TILE * bustScale;
  const destX = SHIFT_X * bustScale - CROP_X_FRAC * size;
  const destY = -CROP_Y_FRAC * size;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  if (assets.plate) ctx.drawImage(assets.plate, 0, 0, size, size);

  for (const layer of LAYERS) {
    const index = layer.group === null ? 0 : selection[layer.group];
    const img = assets.sheets[layer.key];
    if (!img || !Number.isInteger(index)) continue;
    const rect = tileRect(index);
    if (rect.top + TILE > img.height) continue;
    const sheet = tintedSheet(cache, layer, img, selection, palette);
    // Drawn at bust scale, shifted and cropped to match the server's
    // resize-to-BUST_PX-then-extract-to-CANVAS path; the canvas clips
    // anything outside [0, size) on its own, same as sharp's extract().
    ctx.drawImage(sheet, rect.left, rect.top, TILE, TILE, destX, destY, destSize, destSize);
  }

  // The bottom-of-frame fade, drawn last so it sits over the finished bust.
  const [fr, fg, fb] = FADE_RGB;
  const gradient = ctx.createLinearGradient(0, size * (1 - FADE_HEIGHT), 0, size);
  gradient.addColorStop(0, `rgba(${fr},${fg},${fb},0)`);
  gradient.addColorStop(1, `rgba(${fr},${fg},${fb},1)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, size * (1 - FADE_HEIGHT), size, size * FADE_HEIGHT);
}

/**
 * One canvas that redraws itself whenever anything it draws from changes.
 *
 * The tint cache arrives as a ref rather than a Map because the whole grid
 * shares one, and reading `.current` during render is a `react-hooks/refs`
 * error in this repo — so it is only ever touched inside the effect.
 */
function PortraitCanvas({ size, cssSize, assets, cacheRef, selection, palette, pixelated = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !assets) return;
    drawPortrait(canvas.getContext("2d"), size, assets, cacheRef.current, selection, palette);
  });

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        width: cssSize,
        height: cssSize,
        display: "block",
        borderRadius: "var(--r-md)",
        // Upscaled art keeps its hard pixel edges; downscaled thumbnails read
        // better resampled, which is why only the big preview asks for it.
        imageRendering: pixelated ? "pixelated" : "auto",
      }}
    />
  );
}

function OptionButton({ active, onClick, label, children }) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        className="swatch"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// Mounted only while it is open (see AvatarField.js) — that is what resets
// the selection on a cancel-then-reopen, rather than an effect syncing state
// to a prop, which `react-hooks/set-state-in-effect` forbids here anyway.
export default function PortraitMaker({ onClose, initialSelection, allowFantasy = false }) {
  const [selection, setSelection] = useState(initialSelection);
  const [tabKey, setTabKey] = useState(TABS[0].key);
  const [assets, setAssets] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const tintCache = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    loadAssets()
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const palette = useMemo(() => buildPalette(selection), [selection]);
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];

  const set = useCallback((key, value) => {
    setSelection((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const result = await setPortraitAvatar(selection).catch(() => ({
      ok: false,
      error: "Could not save your portrait. Try again.",
    }));
    setSaving(false);
    if (result?.ok) onClose();
    else setSaveError(result?.error ?? "Could not save your portrait. Try again.");
  }, [selection, onClose]);

  return (
    <Modal
      title="Customize Appearance"
      width="widest"
      onClose={onClose}
    >
      <div>
        {loadError ? (
          <p className="mt-4 text-sm text-muted">
            The portrait art didn&apos;t load. Reload the page and try again.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-5 sm:flex-row">
              <div className="flex shrink-0 flex-col items-center gap-3">
                <div
                  style={{
                    width: 200,
                    height: 200,
                    borderRadius: "var(--r-md)",
                    border: "1px solid var(--border)",
                    background: "var(--field-bg)",
                  }}
                >
                  {assets && (
                    <PortraitCanvas
                      size={CANVAS}
                      cssSize={200}
                      assets={assets}
                      cacheRef={tintCache}
                      selection={selection}
                      palette={palette}
                      pixelated
                    />
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSelection(randomSelection({ allowFantasy }))}
                >
                  Randomize
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div
                  className="flex flex-wrap items-center gap-1"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="tab-item"
                      data-active={t.key === tabKey}
                      onClick={() => setTabKey(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="portrait-options mt-3">
                  {tab.kind === "part"
                    ? allowedParts(tab, allowFantasy).map((index) => (
                        <OptionButton
                          key={index}
                          active={selection[tab.key] === index}
                          onClick={() => set(tab.key, index)}
                          label={`${tab.label} ${index + 1}`}
                        >
                          {assets && (
                            <PortraitCanvas
                              size={TILE}
                              cssSize={THUMB_PX}
                              assets={assets}
                              cacheRef={tintCache}
                              selection={{ ...selection, [tab.key]: index }}
                              palette={palette}
                            />
                          )}
                        </OptionButton>
                      ))
                    : allowedColors(tab.options, allowFantasy).map((option) => {
                        const index = tab.options.indexOf(option);
                        return (
                          <OptionButton
                            key={option.id}
                            active={selection[tab.key] === index}
                            onClick={() => set(tab.key, index)}
                            // Hair and eye colours are named; skin tones are
                            // deliberately not, because every available word
                            // for one is loaded and a swatch says it better.
                            label={option.label ?? `${tab.label} ${index + 1}`}
                          >
                            <span
                              style={{
                                display: "block",
                                width: THUMB_PX,
                                height: 32,
                                borderRadius: "var(--r-sm)",
                                // The ramp's mid tone: for skin the lit plane,
                                // for hair its body, for eyes the iris itself.
                                background: option.ramp[tab.key === "eyeColor" ? 1 : 0],
                              }}
                            />
                          </OptionButton>
                        );
                      })}
                </div>
              </div>
            </div>

            {saveError && (
              <FormError className="mt-3">
                {saveError}
              </FormError>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={save} disabled={saving || !assets}>
                {saving ? "Saving…" : "Use this portrait"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
