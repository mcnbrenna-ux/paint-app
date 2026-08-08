# Canvas Coach — Phase A Photo Test, Step by Step

**What this is:** a one-time, ~15-minute photo session that answers the single question the whole Canvas Coach module hangs on — *can your phone's camera, corrected against your own titanium white, report paint colors honestly?* If yes, the Coach screens get built. If no, we find out for $0 instead of after weeks of UI work.

**Cost: $0.** Everything uses paint and gear you already own.

---

## What you need

- Your **titanium white** tube (note the brand — the app can use your exact white as the reference)
- **2–3 other tubes** you own (any colors; one earth + one blue + one red is a nice spread)
- A palette knife
- A scrap surface to paint on: canvas board, primed cardboard, or the back of an old canvas
- A **pencil** (for labeling — pencil, not pen, so it doesn't bleed)
- Your phone (the same one you'd use with the app)
- Two kinds of light: a **window** (indirect daylight) and a **lamp**

---

## Step 1 — Paint the reference patch

1. Squeeze out titanium white **straight from the tube** — no medium, no solvent, nothing mixed in.
2. Knife it onto the board as a patch **at least 2.5 cm (1 inch) square**, thick enough that nothing shows through — two passes with the knife if needed.
3. Make it as **flat and matte** as you can: finish with light, flat knife passes rather than swirls. Ridges and gloss are the enemy — they catch light and lie to the camera.
4. Label it `W` in pencil next to (not on) the patch.

> Wet oil paint is somewhat glossy no matter what. The shooting angle in Step 4 handles that. If you have the patience to let the board dry to the touch for a few days before shooting, the numbers get a little more trustworthy — but same-day is acceptable and much better than never.

## Step 2 — Mix 2–3 recipes you can vouch for

The test compares what the app *predicts* a mix should look like against what the camera *sees* — so the mixes must be ones where you know exactly what went in.

1. In Pigment, pick 2–3 recipes with **simple ratios** — things like `2 : 1` or `3 : 1 : 1`. (Run a few targets on the Mix tab and pick simple ones, or use saved recipes.)
2. Measure the parts as honestly as you can: **equal-sized knife scoops**, leveled off. Same scoop size for every part. This matters more than any other step — a sloppy 2:1 is really a 3:1 and the test can't tell the difference between camera error and mixing error.
3. Mix each pile **thoroughly** — until there are no streaks at all, then ten more seconds.
4. Paint each mix as its own patch (same size and thickness as the white patch) on the same board, near the white patch.
5. **Write down, per patch:** the pencil label (`1`, `2`, `3`), which paints went in (brand + name), and the parts (e.g. `1 = 2 Titanium White : 1 French Ultramarine`). Send me this list with the photos — without it the test means nothing.

Your board now looks something like:

```
┌─────────────────────────────┐
│   ██ W      ██ 1     ██ 2   │
│  white     mix 1    mix 2   │
│             ██ 3            │
│            mix 3            │
└─────────────────────────────┘
```

## Step 3 — The three lighting setups

Shoot the same board under each of these, ~7 photos per setup (≈ 20 total):

| Setup | How |
|---|---|
| **A — Daylight** | Near a window, **indirect** light (no sun stripe falling across the board) |
| **B — Lamp** | Window blocked/curtained, one ordinary lamp on, the kind you actually paint under |
| **C — Mixed** | Window + lamp together — the messy real-studio case |

Avoid: direct sunlight on the board, and light coming from behind the board (backlighting).

## Step 4 — How to shoot

For every photo:

1. Prop the board upright (against a wall or on the easel).
2. Stand so the camera looks at the board **from an angle — roughly 30–45° off straight-on**, with the light coming from the other side. This kills the glare on wet paint. If you can see a shiny hotspot on any patch from where you stand, move until you can't.
3. **Whole board in frame**, filling most of it. White patch and all mix patches visible in every shot.
4. **No flash. No zoom. No portrait mode.** Tap the screen on the board so it focuses and exposes there.
5. Take the ~7 shots per lighting setup from slightly different positions/distances — that variety is the point.
6. **Do not edit, filter, or "enhance" anything afterward.** Send the originals exactly as shot.

## Step 5 — Send it to me

Upload to this chat:

1. The **~20 photos** (originals)
2. Your **patch list** from Step 2 (labels → paints → parts)
3. The **brand of your titanium white**

I'll extract the patch colors, run every shot through `cli/calibrate.mjs`, and score the set.

## How it's scored (the gate)

For each photo: the white patch calibrates the shot (±5.0 error floor — the honest cost of the $0 reference, see `docs/spec-amendments.md`). Then each mix patch's corrected color is compared against what the engine predicts for your declared recipe, with the compounded error band (≈ ±6.2 all-in).

- **Pass (white-patch mode): ≥ 70% of mix-patch readings across the whole set land inside the band.** → I build the Canvas Coach capture, declare, and diagnosis screens, running in white-patch mode from day one.
- **Fail:** we get a per-photo breakdown of *why* (which lighting, which colors, how far off) — and decide with evidence whether the fix is a $10 gray card, drier patches, or shelving the module. Finding this out now, for free, is the whole point.

## Common ways this test gets accidentally ruined

- Thin patches (underlayer showing through changes the color)
- Eyeballed proportions instead of leveled scoops
- A sun stripe or lamp hotspot across the board
- Shooting straight-on into the wet-paint shine
- Phone "auto-enhance," HDR filters, or sending screenshots instead of originals
- Losing track of which patch was which mix — label first, paint second

---

*Once photos are in, results come back as: per-shot captureError, per-patch predicted vs measured with the band, and a pass/fail verdict for the gate — same honesty rules as everything else in Pigment.*
