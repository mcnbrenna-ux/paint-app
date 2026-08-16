# Prism

A glass + oil-slick iridescence design system, built for a painting app.

```
prism/
├─ src/
│  ├─ tokens.css        ← every design decision. change here, nowhere else.
│  ├─ glass.css         ← glass primitives + component classes
│  └─ components.jsx    ← React wrappers (zero dependencies)
├─ tailwind.config.js   ← maps tokens → utilities (v3; v4 notes at the bottom of the file)
├─ prism-showcase.html  ← open this. everything rendered, live, both themes.
├─ showcase.template.html + build.js  ← regenerate the showcase after editing CSS
└─ README.md
```

## Install

```bash
npm i -D tailwindcss   # optional — the CSS works standalone
```

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1&family=Schibsted+Grotesk:wght@400..800&family=Martian+Mono:wght@300..600&display=swap" rel="stylesheet">
```

```jsx
import './src/tokens.css'
import './src/glass.css'
import { PrismRoot, Panel, Button, ToolRail } from './src/components'

export default () => (
  <PrismRoot theme="dark">
    <Panel title="Brush">…</Panel>
  </PrismRoot>
)
```

`PrismRoot` is not optional. It renders the blob field the glass refracts. Without it every surface is a flat gray box.

---

## The five rules

**1. Glass needs something behind it.**
`backdrop-filter` samples what it sits on. Six blurred radial fields drift behind the whole app on independent orbits — that is the light source. Every panel, button, and rail is sampling from it. This is why the system reads as material instead of as a CSS filter.

**2. Saturation is the whole trick.**
`backdrop-filter: blur(26px) saturate(185%)`. Real glass concentrates the color behind it. Drop `--glass-sat` to 100% and the system dies instantly — try it, then put it back.

**3. Three tiers. Never four.**
Tier 1 subtle (chips, rows), tier 2 default (panels, toolbars), tier 3 modal (dialogs, popovers). Each tier changes fill *and* blur *and* border weight *and* shadow together. Changing only opacity is the tell of a system that was never designed.

**4. Grain, always.**
1.6% film grain over everything. You won't consciously see it. You will absolutely notice its absence — without it, large blurred gradients band and look cheap.

**5. Iridescent text and iridescent fills need dark ink.**
`.btn--iri` uses `#14101f` text, not white. White on mid-tone iridescence fails WCAG AA every single time. `.t-iri` is display-size only; at body size a gradient fill drops legibility below AA and looks like a 2013 dribbble shot.

---

## Tokens

| Group | Prefix | Notes |
|---|---|---|
| Substrate | `--ink-900…600` | Near-black with a violet bias so every hue reads as *lit* |
| Paper | `--paper-100…300` | The canvas. Warm, never `#FFFFFF` — painters don't paint on pure white |
| Spectrum | `--iri-magenta`, `-violet`, `-cyan`, `-mint`, `-gold`, `-blush` | Sampled around a soap-bubble interference pattern |
| Sweep | `--iri-sweep`, `--iri-line` | The canonical conic and linear gradients. Reuse these so every iridescent element shares one light source |
| Glass | `--glass-{1,2,3}-{fill,edge,blur}`, `--glass-sat` | |
| Specular | `--glass-spec`, `--glass-spec-strong`, `--glass-bounce` | Inset 1px highlights that fake physical thickness |
| Shadow | `--shadow-{sm,md,lg,xl}` | Violet-tinted. Neutral gray shadows on a violet floor look dirty |
| Type | `--font-{display,ui,mono}`, `--fs-*`, `--tr-*` | |
| Geometry | `--r-*`, `--sp-*` | Radii step down ~6px when nesting so corners stay concentric |
| Motion | `--ease-{out,in-out,spring}`, `--dur-*` | Nothing linear. Nothing cartoon-bouncy |

### Type
- **Fraunces** — optical serif with real wonk (`SOFT 40, WONK 1`). Display only, never below 18px. This is the painterly voice.
- **Schibsted Grotesk** — humanist terminals keep the UI from reading like a spreadsheet.
- **Martian Mono** — numerics only: hex, px, %, dimensions. Tabular figures so values don't shimmy while you drag a slider.

---

## Components

| Class | React | Notes |
|---|---|---|
| `.glass` `.glass--1/--3` | `<Glass tier>` | The primitive. Everything composes from it |
| `.glass--iri` | `<Glass iri>` | Rotating conic ring masked to 1px. **One per view** — two is noise |
| `.glass--sheen` | `<Glass sheen>` | Light band crosses on hover |
| `.btn` `--iri` `--ghost` `--sm/lg/icon` | `<Button variant size>` | Press = scale down **and** drop elevation. Scale alone reads as a bug |
| `.panel` `.card` | `<Panel> <Card>` | |
| `.rail` `.tool` | `<ToolRail>` | Roving tabindex + arrow keys. A tool palette that's mouse-only is half a tool palette |
| `.swatch` | `<Swatch>` | Checkerboard underlay is not decoration — it's how alpha is visible |
| `.hue-ring` | `<HueRing>` | Drag or arrow-key. Ships `hslToHex` |
| `.slider` | `<Slider>` | `--slider-pct` drives the WebKit track fill. Keep it in sync or the gradient and thumb disagree |
| `.segmented` `.toggle` `.input` | `<Segmented> <Toggle> <Input>` | |
| `.layer` | `<LayerRow>` | |
| `.scrim` `.modal` | `<Modal>` | Escape, scroll lock, initial focus |
| `.toast` `.chip` `.tooltip` | `<Toast> <Chip>` | |
| `.canvas-surface` | — | Warm paper, inset shadow so it sits *below* the chrome |
| `.stagger` | — | Set `--i` on children. One orchestrated load beats twelve scattered micro-interactions |

---

## Accessibility

- Focus ring: 2px cyan, 2px offset, on every interactive element. Offset it, never remove it.
- `prefers-reduced-motion` kills the blob drift and the iridescent sweep, keeps state transitions. Removing those makes an interface feel broken rather than calmer.
- `@supports not (backdrop-filter)` falls back to **opaque** panels. Translucent-with-no-blur over a blob field is unreadable.
- Every icon button carries `aria-label`. Tools use `aria-pressed`, tabs `aria-selected`, switches `role="switch"` + `aria-checked`.
- Body text sits at `--text-hi` (0.96α) or `--text-mid` (0.68α). Do not go below `--text-mid` for anything a user has to read.

## Performance

- Blobs are `position: fixed` with `contain: strict` and `will-change: transform` — they composite on the GPU and never trigger layout.
- `backdrop-filter` is the expensive part. Don't nest a tier-3 glass inside another tier-3 glass; stack tiers instead.
- Six blobs is the ceiling. Past that, mobile Safari starts dropping frames on the drift.

## Rebuilding the showcase

```bash
node build.js   # inlines src/*.css into prism-showcase.html
```

## Light mode

`data-theme="light"` on the root. It is not an inversion — glass over a light substrate needs *darker* fills, *stronger* borders, and a warm near-white specular. Most glass systems skip this step and ship invisible components on light backgrounds.
