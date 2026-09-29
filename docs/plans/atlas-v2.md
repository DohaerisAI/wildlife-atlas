# Atlas v2 · built from scratch

**Status:** in progress · 2026-09-29

The first atlas was a dashboard around a globe. v2 is the explorer's view from the design direction (Act IV)
built to the product spec (§3, §8) and the Living Earth style guide. Nothing from the old atlas UI is kept.

## What "done" looks like

1. **The planet is legible at a glance.** All ten Living Earth materials in the hologram look, in the style
   guide's layer order: ocean currents and blooms, land class (forest, grass, crop, desert, rock, urban),
   relief, seasonal water, greenness, snow, wind, city lights. Each is bound to a named dataset and month.
2. **Tap anything and it says what it is.** A probe under the pointer reads the real values:
   "Forest · tree cover 64 % · NDVI 0.71 · wind 3.2 m/s from NE · ERA5, October mean".
3. **Where and when am I?** Place name (reverse geocoded), scale, month, always on screen.
4. **What might I find here?** Wildlife-here panel: grouped Year-round / Seasonal / Passing / Uncertain,
   ranked, each row with a photo thumbnail, a 12-month presence strip and what it is doing this month
   (arriving, leaving, passing). Coverage indicator. "Help document wildlife" route to eBird / iNaturalist.
5. **Species profile, complete or honest.** Photo gallery with credits, identity, at a glance (size, weight,
   status), seasonal world (monthly presence and range share), journey, conservation, evidence and sources.
   Missing fields say "Not available from current sources".
6. **Why is it shown?** Evidence labels, legend for every material and layer, sources one tap away.
7. Desktop: globe canvas, search on top, month control along the bottom, collapsible side panel.
   Mobile: the same controls, panel as a draggable sheet. Reduced motion respected.

## Data contracts

### Living Earth pack v2 · `web/public/content/living-earth/v2/`
Built in Earth Engine on Actions (`living-earth.yml`), same manifest rules as v1 (sources, ranges, units).

| File | Size | Channels | Source |
|---|---|---|---|
| `surface.png` | 4×3 × 1024×512 | water share, snow, NDVI | as v1 |
| `climate.png` | 4×3 × 360×180 | wind u, wind v, temp | as v1 |
| `ocean.png` | 4×3 × 720×360 | current u, current v, log chlorophyll | HYCOM surface velocity, MODIS-Aqua chlorophyll-a, 2015–2024 monthly means |
| `land.png` | 4096×2048 | R class index, G tree cover %, B hillshade | ESA WorldCover (mode), MODIS VCF tree cover, ETOPO1 hillshade |
| `relief.png` | 2048×1024 | R,G elevation as 16-bit (m + 11000), B night lights (log) | ETOPO1, VIIRS DNB annual |

Class index (R of `land.png`): 0 none/ocean, 1 tree, 2 shrub, 3 grass, 4 crop, 5 built, 6 bare, 7 snow/ice,
8 water, 9 wetland, 10 mangrove, 11 moss/lichen.

### Species profiles · `web/public/content/profiles/`
One JSON per species (schema of `species/profile.ts`, plus `thumb` 320 px URL per image), for every species in
`species.json`, and `index.json` becomes `{slug: {name, thumb}}` so lists can show photos without loading each profile.

## Build order
1. Data jobs in parallel: pack v2 (Earth Engine) and profiles for all species (Wikidata / Commons).
2. New atlas app `web/src/atlas/`: engine materials, probe, panel, profile, timeline, sheet.
3. Remove the old atlas code (`scene/shell.ts`, `experiences/atlas/`, `ui/*` used only by it).
4. Screenshots on desktop and phone against this list before calling it done.
