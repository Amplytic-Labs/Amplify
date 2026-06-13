# Design System Inspired by Aether Luxe

> Category: Lifestyle & Fintech
> Modern, premium mobile design system inspired by high-end fintech, luxury booking, and quiet-luxury lifestyle platforms.

## 1. Visual Theme & Atmosphere

Aether Luxe is a design system that acts as a physical gallery for luxury digital products. It rejects aggressive marketing and heavy branding in favor of quiet confidence, generous whitespace, and pure geometric discipline. The atmosphere is calm, clean, expensive, and deeply professional — modeled after high-end Swiss typography, luxury modernist architecture, and premium physical interfaces.

Rather than plain clinical whites and harsh blues, Aether Luxe employs a calming, warm, and sophisticated palette: a soft linen canvas background (`#F5F5F3` or `#FAF9F6`), absolute ebony typography (`#111111`), and a single, meticulously calibrated brushed copper-gold accent (`#C5A880`). Components float in extensive, rhythmic whitespace, structured as floating cards with organic, super-elliptical rounded corners (`rounded-3xl` / `24px–32px`), hairline borders, and ultra-soft, nearly invisible shadows that mimic natural ambient light.

Interaction is characterized by smooth, intentional, and high-fidelity feedback: subtle scale transformations, frosted glass depth, and elegant micro-transitions. It feels less like a mobile application and more like a beautifully curated, high-end editorial book.

**Key Characteristics:**
- **Warm Minimalist Canvas**: Soft pearl-white backgrounds (`#FAF9F6`) that feel organic and calming compared to pure sterile whites.
- **Brushed Gold/Bronze Accent**: A sophisticated copper-gold (`#C5A880`) used with high restraint for status, high-importance highlights, and primary CTA accents.
- **Extreme Spacing and Whitespace**: A rhythmic, generous grid where text and components are given room to breathe, establishing a relaxed, luxurious tempo.
- **Super-Elliptical Curves**: Soft, organic rounded corners (16px to 32px) for cards, tabs, and buttons, resembling premium hardware designs.
- **Hairline Borders & Soft depth**: Avoidance of hard black borders; instead using thin, light, custom-tinted borders (`0.5px` width) and microscopic drop shadows (`rgba(0,0,0,0.02)`).
- **Editorial Typography**: Pairing clean geometric headers (`CalSansText-Bold` or `SpaceGrotesk-Bold`) with quiet, highly readable body copy (`Almarai-Light` or `Almarai-Regular`).
- **Glassmorphic Overlays**: Frosting navigation elements with thin translucency (`BlurView` with light intensity) to create layers of atmospheric depth.

---

## 2. Color Palette & Roles

### Primary Canvas & Backgrounds
- **Pearl Linen** (`#FAF9F6`): The primary page canvas in light mode. Sophisticated, warm, organic.
- **Pure Canvas** (`#FFFFFF`): Elevated card and container background. Contrast-builder.
- **Obsidian Velvet** (`#0E0E0F`): The primary canvas in dark mode. Pure, deep, premium black.
- **Obsidian Elevated** (`#161618`): Elevated card surfaces in dark mode.

### Accents & Signifiers
- **Brushed Gold** (`#C5A880`): The signature accent color. Symbolizes elite curation, premium selection, and active states.
- **Burnished Bronze** (`#A3835B`): Secondary accent, used for subtle highlights, active text states, or high-contrast gold elements.
- **Absolute Ebony** (`#111111`): Primary dark text, high-emphasis headings, pill button solids.
- **Pure White** (`#FFFFFF`): Text on dark buttons, icons inside dark containers.

### Neutrals & Text
- **Midnight Ink** (`#1C1C1E`): Body text, high-readability labels.
- **Warm Muted Slate** (`#7C7C80`): Secondary copy, captions, inactive tab items, outlines.
- **Soft Alabaster** (`#F2F0EC`): Light neutral surface, divider lines, disabled buttons.

### Border & Elevation Lines
- **Hairline Light** (`rgba(197, 168, 128, 0.12)` or `#E8E6E0`): Thin borders enclosing cards.
- **Hairline Dark** (`rgba(255, 255, 255, 0.08)` or `#2A2A2D`): Dark mode card separations.

---

## 3. Typography Rules

### Custom Font Mapping
- **Display Headings**: `calsans-bold` (`CalSansText-Bold`) — clean, geometric, high-character, modern.
- **Sub-Headings & Action Labels**: `space-bold` (`SpaceGrotesk-Bold`) or `space-medium` — wide tracking, modern technical feel, elegant proportions.
- **Body & Secondary Copy**: `almarai` (`Almarai-Regular`) or `almarai-light` (`Almarai-Light`) — calm, high-readability sans-serif with a soft, expensive editorial rhythm.

### Typography Hierarchy (Mobile First)

| Role | Font Family | Size | Weight | Line Height | Letter Spacing | Case / Transform |
|------|-------------|------|--------|-------------|----------------|------------------|
| Display Hero | `calsans-bold` | 36px | Bold | 1.10 | -1px | Title Case |
| Screen Title | `calsans-bold` | 28px | Bold | 1.15 | -0.5px | Title Case |
| Section Header | `calsans-bold` | 20px | Bold | 1.20 | 0 | Title Case |
| Card Header | `space-bold` | 16px | Bold | 1.25 | -0.2px | Normal |
| Price Display | `space-bold` | 18px | Bold | 1.00 | -0.3px | Normal |
| Primary Label | `space-medium` | 14px | Medium | 1.20 | 0.5px | UPPERCASE option |
| Body Text | `almarai` | 14px | Regular | 1.50 | 0.1px | Normal |
| Muted Caption | `almarai-light` | 12px | Light | 1.40 | 0.2px | Normal |
| Micro Badge | `space-bold` | 10px | Bold | 1.00 | 1px | UPPERCASE |

---

## 4. Component Stylings

### Buttons
- **Solid Obsidian Pill (Primary)**: Background `#111111` (Ebony), text `#FFFFFF` (White) in `space-bold` (14px). Generously rounded (`rounded-full` or `32px` radius). Padding `16px 28px`.
- **Minimal Gold Accent Pill**: Background `#FAF9F6`, border `1px solid #C5A880`, text `#C5A880` in `space-bold` (14px).
- **Secondary Glassmorphic Pill**: Background `rgba(255, 255, 255, 0.7)` with BlurView, border `0.5px solid rgba(197, 168, 128, 0.2)`, text `#111111` in `space-bold`.
- **Text Link Button**: No background, text `#111111` or `#C5A880` with a microscopic arrow icon.

### Cards & Surfaces
- **Luxe Floating Card**: Background `#FFFFFF` (White), border `0.5px solid #E8E6E0`, rounded corners `rounded-[28px]`, padding `20px`. Shadow: `rgba(0, 0, 0, 0.02) 0px 8px 24px`.
- **Gold Accent Border Card**: Background `#FFFFFF`, border `1px solid #C5A880`, rounded corners `rounded-[28px]`, padding `20px`.
- **Large Image Card**: Large image preview (`height: 240px`) with soft clipping (`rounded-[24px]`). Subtle linear gradient overlay (`rgba(0,0,0,0) to rgba(0,0,0,0.4)`) at the bottom to hold white text elements elegantly.

### Navigation Elements
- **Premium Floating Bottom Tab**: Positioned `16px` off the screen bottom, enclosed in `rounded-3xl` / `24px` border-radius. Frosted glass effect using `BlurView`, border `0.5px solid rgba(0,0,0,0.06)`, high-contrast active icons in `#111111` or `#C5A880` and inactive items in `#7C7C80`.
- **Pill Section Switchers**: Background `#F2F0EC` (Alabaster), active pill background `#FFFFFF` with thin shadow. `space-medium` text.

---

## 5. Layout Principles

### Spacing Scale
- **Base Grid**: 4px
- **Standard Distances**:
  - `xs` = 8px: Inside labels, close icon-text pairs
  - `sm` = 12px: Card subtext elements, small padding
  - `md` = 16px: Standard internal container padding, list gaps
  - `lg` = 24px: Outer page margin, primary spacing between cards
  - `xl` = 32px: Massive whitespace breaks, section dividers
  - `xxl` = 48px: Header to content breathing room

### Whitespace Philosophy
- **Comfortable Breaths**: Always use at least `24px` horizontal padding on pages.
- **Single Focus Composition**: Never crowd a screen with two major actions. Let one central card or slider dominate the user's attention.
- **Asymmetrical Balances**: Pair a massive title block (e.g. 36px font) with extensive empty space beside or below it.

---

## 6. Depth & Elevation

| Level | Background | Border / Shadow | Use Case |
|-------|------------|-----------------|----------|
| **Level 0 (Flat)** | `#FAF9F6` (Linen) | None | Page background canvas |
| **Level 1 (Surface)** | `#FFFFFF` (White) | `0.5px solid #E8E6E0` / `rgba(0,0,0,0.01)` shadow | Primary cards, content grids |
| **Level 2 (Elevated)** | `#FFFFFF` (White) | `0.5px solid #E8E6E0` / `rgba(0,0,0,0.03) 0px 10px 30px` | Dialog sheets, floating menus |
| **Level 3 (Interactive)**| `#FFFFFF` (White) | `1px solid #C5A880` / `rgba(197,168,128,0.1) 0px 8px 20px` | Selected/Active cards, pay blocks |

---

## 7. Do's and Don'ts

### Do
- Use `#FAF9F6` (soft off-white) as the default background, not absolute white `#FFFFFF`. Use absolute white for floating cards to establish contrast.
- Apply `CalSansText-Bold` strictly for screen headers and premium display sections.
- Keep border radii between `20px` and `32px` on all prominent elements — organic curves are vital.
- Use `#C5A880` (Brushed Gold) as an absolute luxury highlight — only on active buttons, gold stars, verified badges, or selected borders.
- Keep dividers thin and light (`0.5px` width and low opacity) to maintain a seamless, borderless feel.

### Don't
- Never use bright neon primaries (no electric blue, neon green, or hot red). Use deep, rich, organic colors instead.
- Never use harsh dark outlines or thick block borders.
- Never stack columns tightly; always allow at least `16px` of empty margin between columns.
- Do not use hard drop shadows with high opacity.
- Avoid using pure black text (`#000000`) on white; use `#111111` or `#1C1C1E` for a softer, more premium contrast.

---

## 8. Screen Flow Specifications

### Screen 1: The Luxe Onboarding
- **Layout**: High-contrast, top-weighted elegant vertical composition.
- **Visuals**: A large vertical image box (`height: 55%`) with super-elliptical corners (`rounded-[32px]`), displaying high-end architecture or curated spaces.
- **Copy**: Large display greeting: "Quiet Luxury. Cured Stays."
- **Action**: A single large solid obsidian pill button centered at the bottom.

### Screen 2: Curated Discovery Home
- **Layout**: Floating card grid with horizontal swiping.
- **Visuals**: A top bar with user profile photo (with verified gold ring) and "Aether" brand logo. Large search pill.
- **Sliders**: Horizontal carousel displaying featured high-end retreats with a copper-gold ribbon overlay.
- **Details**: $1,400/night, rating stars in gold, organic outline items.

### Screen 3: Stately Details
- **Layout**: Immersive visual page with fixed bottom action.
- **Visuals**: Full-bleed gorgeous luxury villa banner, overlapping rounded card containing descriptive editorial texts.
- **Grid**: 4 clean outline amenity icons (Infinity Pool, Wellness Spa, Personal Sommelier, Concierge).
- **CTA**: Floating glass bottom bar with pricing at left, "Reserve Stay" primary solid pill at right.

### Screen 4: Secured Booking & Payment
- **Layout**: Clean checkout list.
- **Visuals**: Clean visual confirmation card, inline calendar row, Apple Pay button, and credit card selector.
- **Total**: Sleek, spacious pricing breakdown.
- **CTA**: "Authorize Payment" solid pill with a lock icon.

### Screen 5: Elite Confirmation
- **Layout**: Symmetrical centerpiece layout.
- **Visuals**: A large gold glowing checkmark, a custom digital ticket with perforated tear-out styling, date, location details, and a high-fidelity QR Code.
- **Action**: "Add to Apple Wallet" black pill, "Done" text link.

---

## 9. Agent Prompt Guide

### Color References
- Canvas: `#FAF9F6`
- Card background: `#FFFFFF`
- Accent color: `#C5A880`
- Typography Dark: `#111111`
- Typography Muted: `#7C7C80`
- Border: `#E8E6E0`


