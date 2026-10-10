# Lantern Coffee Roasters — brand & design system

> The brand is an **editable demo identity**. Names, copy and social handles are placeholders that the store owner replaces
> from the admin dashboard (store settings, content blocks, social links). Nothing here implies a real business.

## 1. Who we are

**Lantern Coffee Roasters** is a small-batch roastery and café group. The lantern is a promise: the lights are on, someone
is awake for your coffee, and it was made with attention. The mark is a lantern whose flame is a coffee bean.

**Tagline:** *Slow-roasted. Carefully poured.*

### Voice and tone

| Principle | Means | Example |
|---|---|---|
| **Warm, not cute** | Friendly and direct; no puns, no exclamation marks in UI. | "Your cart is empty" — not "Oops! Nothing here!" |
| **Confident, short** | Short sentences, concrete nouns, verbs first. | "Order ahead. We'll have it waiting." |
| **Honest** | Say what happened and what to do. Never hide a fee, a sandbox or a failure. | "Payment failed. Your card was not charged. Try again." |
| **Editorial** | Headlines can be a little literary (display serif, italic accent word); body copy stays plain. | "Coffee we can name the farm of" |
| **Inclusive** | Plain language, no jargon without explanation (say "milk" not "dairy alternative SKU"). | |

Microcopy rules: sentence case everywhere; buttons are verbs ("Add to cart", "Place order"); errors say what to fix;
empty states offer the next step; prices always show the currency symbol from store settings.

## 2. Logo

`src/design/Logo.tsx` (`Logo`, `LogoGlyph`) and `public/favicon.svg`.

* **Glyph:** lantern (handle, cap, glass body, base) with a coffee-bean flame. The bean's crease is a cut-out (SVG mask) so it reads on any background.
* **Lockups:** `horizontal` (header, footer), `stacked`, `glyph` (favicon, avatars, fallback tile).
* **Variants:** `color` (copper bean, strokes `currentColor`) and `mono` (everything `currentColor`; use on photos, watermarks, single-colour print).
* Colour the logo with a text colour utility: espresso on cream, cream on espresso.
* **Clear space:** one glyph-width (≈ the lantern's body width) on all sides. **Minimum size:** glyph 16 px, horizontal lockup 96 px wide.
* Do not recolour the bean, stretch, outline, add shadows, or place the colour variant on copper.
* Wordmark is set in the display serif (Fraunces, weight 600, optical size 72) with "COFFEE ROASTERS" in Inter 600, +0.22em tracking.

## 3. Colour

All colours live as CSS variables in `src/index.css` (`@theme`). Components use the **semantic** tokens only, which is how the admin
theme re-skins the same components. The brand palette is fixed by `docs/implementation-plan.md` §8.

| Brand token | Hex | Role |
|---|---|---|
| `espresso` | `#2B1D16` | footer, feature bands, solid badges, tooltips |
| `cream` | `#F7F0E3` | page background |
| `parchment` | `#EFE4D0` | wells, skeletons, table headers |
| `sage` | `#5E6E55` | secondary feature tile (white/cream text only) |
| `copper` | `#B4602B` | the single accent: primary actions, ratings, focus of attention |
| `ink` | `#1B1410` | body text, focus ring |

Semantic tokens: `surface`, `surface-raised` (`#FFFBF3`), `surface-sunken`, `surface-inverse`, `border` (decorative hairline),
`border-strong` (control outlines, ≥ 3:1), `text`, `text-muted`, `text-inverse(-muted)`, `accent`, `accent-hover`,
`accent-foreground`, `accent-text` (copper as text on light surfaces), `accent-soft`, `accent-on-dark`, and the status pairs
`success|warning|danger|info|neutral` + `-bg`. Tailwind utilities follow the names: `bg-surface-raised`, `text-text-muted`, `border-border-strong`…

### Contrast (WCAG 2.2 AA)

Raw copper `#B4602B` is only **4.0 : 1** on cream, so it is never used for body-size text there. Rules:

* Copper **fills** carry white text (`accent-foreground`, 4.52 : 1).
* Copper **text** on light surfaces uses `accent-text` `#9C5122` (5.1 : 1 on cream, 4.6 : 1 on parchment).
* Copper text on espresso uses `accent-on-dark` `#E0A070` (7.3 : 1).
* Sage is a fill only (white text 5.5 : 1); sage text on parchment fails, so we don't.

Every foreground/background pair the components use is listed in `src/design/contrast.ts` and **asserted in CI**
(`src/design/tokens.test.ts`, both storefront and admin themes). Run `npm run contrast` for the table.

Status is **never colour alone**: `StatusBadge` pairs an icon and a text label; deltas pair arrows with "Up/Down"; form errors carry an icon and text; selected cards/radios show a filled indicator.

## 4. Typography

Self-hosted variable fonts via `@fontsource-variable` (no remote font requests):

* **Display — Fraunces** (optical size axis on): headlines, prices in feature moments, big numerals. Weight 560 for headings, italic for the accent word.
* **UI — Inter**: everything else. Body 16 px / 1.6; small 14 px; caption 12 px.

Scale (fluid, tokens `text-display|h1|h2|h3|h4|lead|caption`):

| Token | Size | Use |
|---|---|---|
| `display` | clamp 44 → 92 px, lh 1.0 | home hero only |
| `h1` | clamp 36 → 60 px | page titles |
| `h2` | clamp 28 → 44 px | section headings |
| `h3` | clamp 22 → 28 px | card/feature titles |
| `h4` | 18 px | list headings, dialog titles |
| `lead` | clamp 17 → 20 px | intro paragraphs |
| `eyebrow` (utility) | 12 px, 600, +0.14em, uppercase | labels above headings |

Headings use `text-wrap: balance`, paragraphs `pretty`. Numbers in tables/prices use `tabular-nums`.

## 5. Space, shape, elevation, motion

* **Spacing:** Tailwind 4 px base. Sections breathe: 80 px (`py-20`) mobile, 112 px (`py-28`) desktop. Page gutter `clamp(16px → 32px)`; content max 1280 px (wide 1472 px).
* **Radii:** square-ish **6–10 px** (`rounded-sm` 6, `md` 8, `lg`/`xl` 10); `rounded-pill` only for chips, search and badges.
* **Elevation:** hairline borders first (`--color-border`), flat surfaces; shadows are warm, tiny (`shadow-xs/sm`) and reserved for floating layers (`md` popovers, `lg` dialogs).
* **Motion:** `--duration-fast 120ms`, `base 200ms`, `slow 420ms`; `--ease-standard`, `--ease-emphasized`. Scroll-reveal fades/slides 18 px. **`prefers-reduced-motion: reduce` removes all transitions/animations globally** (CSS in `index.css`) and `Reveal` renders content immediately.
* **Focus:** 2 px `--color-focus` (ink; cream on dark surfaces via `data-surface="dark"`) outline with 2 px offset on every focusable element via `:focus-visible`.
* **Touch targets:** buttons/inputs 44 px tall (36 px "sm" is for dense admin tables only).

## 6. Themes

* **Storefront** (default): cream/parchment, serif display, generous whitespace, editorial asymmetry on the home page.
* **Admin** (`data-theme="admin"`, applied by `AdminLayout`): neutral greys, compact density, copper remains the only accent. Same components, different surface tokens.

## 7. Imagery

Product and editorial imagery is illustration-style (generated), warm and softly lit. `ProductImage` always reserves its box
(`aspect-ratio`, `width`/`height`), shows a skeleton, fades the image in, lazy-loads below the fold, and falls back to a tile with the mono glyph when the
image is missing or fails. Alt text: decorative when the product name is adjacent (`alt=""`), descriptive for hero/story imagery managed in the CMS.

## 8. Component inventory (`src/design`)

Button, IconButton, Input, Textarea, PasswordInput, Select, Checkbox, Radio/RadioCard (RadioGroup), Switch, Field, Dialog, Sheet, Tabs,
DropdownMenu, Popover, Tooltip, Badge, StatusBadge, Toaster (sonner), Skeleton, Spinner, EmptyState, ErrorState, Money, Rating/RatingInput,
QuantityStepper, Breadcrumbs, Pagination, DataTable, Stat, SectionHeading, Container, ProductImage, Prose (markdown, no raw HTML), Reveal, SmartLink,
Logo, SocialIcon. See `frontend/README.md` for usage and conventions.
