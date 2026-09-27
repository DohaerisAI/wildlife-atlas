# Wildlife Atlas — Product Specification

**Status:** Draft for review  
**Version:** 0.2  
**Date:** 25 September 2026  
**Working concept:** A globe for exploring where animals live, how their presence changes through the year, and where migratory species travel. **Launch focus: India.**

## 1. Product vision

Wildlife Atlas lets a person explore any place on Earth and ask: **“Which animals are here, at this time of year?”** They can then follow a species across its range, learn about its life, and inspect the evidence behind what the map shows.

**Mission:** Make wildlife knowledge free and beautiful to explore, useful to students, researchers, and enthusiasts, and increasingly valuable to conservation. The project is noncommercial: no paid features, sale of wildlife data, or commercial licensing. Its long-term value comes from helping people learn, contribute good observations, find gaps in knowledge, and support evidence-led conservation.

The distinctive experience is a **seasonal globe**. Moving a time slider changes the wildlife visible in a place. Resident species remain; seasonal visitors arrive and leave; migrants pass through. The interface makes these changes legible without claiming to know the exact position of an untracked animal.

The product combines three complementary journeys:

1. **Place → wildlife:** Zoom to a location, choose a time, and discover species likely to occur there.
2. **Species → world:** Search for an animal, see its seasonal range and migration, and explore the places connected by its journey.
3. **Curiosity → contribution:** Learn how an observation becomes useful evidence, contribute it through a trusted workflow, and see how records improve knowledge over time.

The primary audiences are students, educators, researchers, birders, naturalists, and curious explorers. The product should be inviting to a casual visitor while preserving enough source detail and data access for a knowledgeable one to judge and reuse a claim.

## 2. Product goals and boundaries

### Goals

- Make seasonal wildlife change visible and understandable on a globe.
- Provide useful discovery by location, time, and species name.
- Explain each species with concise, sourced information and suitable media.
- Distinguish modeled occurrence, recorded sightings, and tracked animal routes.
- Communicate uncertainty, incomplete coverage, and data age clearly.
- Work globally as an exploration interface, beginning with a deep, curated India collection and explicit coverage labels elsewhere.
- Let people contribute observations through a trustworthy process and expose research-ready records where consent and source terms allow.
- Help conservation partners identify seasonal corridors, important habitats, and evidence gaps without exposing sensitive locations.

### Boundaries for the first release

- The first release focuses on **Indian birds** and a curated initial collection of roughly **30–50 species**, subject to the pilot data review. It should include year-round residents, winter visitors, summer visitors, and passage migrants.
- The first deep geographic coverage is **India**. The opening globe centers on India and offers curated entry points across the Northeast, northern wetlands, and peninsular India. International portions of a featured species' journey remain visible when supported by data.
- A global globe and global place search are available from launch. Detailed seasonal coverage is released where usable data has been validated.
- The experience depicts species-level patterns. Animated dots or lines must not imply live positions of individual animals.
- A full ecosystem simulation, real-time tracking of all wildlife, and 3D animal encounters are future possibilities, not first-release requirements.
- “Complete information” means a consistent, useful species profile with visible gaps; it does not promise every known fact for every species.
- The public experience and its data access remain free. Community contributions do not bypass identification and location-safety checks before publication.

## 3. Core user experience

### 3.1 Landing and place exploration

The opening view is a globe centered on India, with a visible month selector and one clear prompt: **“Explore wildlife anywhere.”** Curated starting points invite exploration of different Indian habitats and migration stories. A visitor can rotate and zoom the globe, search for a place, or use their current location after granting browser permission.

After choosing a place, the product presents:

- A **Wildlife here** panel for the selected month or week.
- Species grouped as **Year-round**, **Seasonal visitor**, **Passing through**, or **Occurrence uncertain** when supported by data.
- A small seasonal chart or twelve-month strip showing how the area's wildlife changes.
- Filters for birds initially, then mammals and other groups as supported.
- A coverage indicator such as **Well modeled**, **Some records**, or **Limited data**.

At broad zoom levels the map shows regional patterns, habitat context, and selected migration stories. At local zoom levels it shows species lists and, where permitted, observation clusters. The map must avoid filling every square kilometer with animal icons, which would falsely imply precise locations.

### 3.2 Seasonal time control

The visitor can drag a twelve-month slider, select a month directly, or press Play to animate one annual cycle. The selected date is always visible. As time changes:

- Seasonal range or relative-abundance layers update.
- The place's species list and resident/visitor/passage labels update.
- The species detail view shows the matching life-cycle stage, such as breeding, non-breeding, or migration, where supported.
- The URL stores location, zoom, selected time, filters, and selected species so a view can be shared.

The interface uses the finest time resolution supported by the underlying dataset. If a source only supports seasons, the UI must not imply weekly precision. Playback may interpolate a visual transition, but the legend must state the data's actual time resolution.

### 3.3 Species search and profile

Search accepts common names and scientific names, with synonyms where the taxonomy source provides them. Results include a thumbnail, scientific name, animal group, and an indication of whether a seasonal map is available. Selecting a result flies the globe to its range and opens its profile.

Each profile has these fields when available:

| Section | Content |
|---|---|
| Identity | Common and scientific name, taxonomy, alternate names |
| At a glance | Resident or migratory behavior, typical habitat, size, diet |
| Seasonal world | Range or relative abundance by time period, with a legend |
| Journey | Breeding and non-breeding areas, stopovers or corridors where supported |
| Conservation | Assessment category, threats, and date of assessment |
| Media | Licensed photo, illustration, and sound where available |
| Evidence | Sources, observation or model date, coverage, and limitations |

Missing fields display **“Not available from current sources”** or a similarly honest explanation. They are never filled with generated facts.

### 3.4 Migration visualization

The map supports three visually distinct evidence layers:

| Layer | Meaning | Visual treatment |
|---|---|---|
| **Expected presence** | A modeled seasonal range or relative abundance | Shaded area or density surface; labeled as an estimate |
| **Recorded sightings** | Dated observations made at particular places | Clusters or points; filterable by date and source |
| **Tracked journey** | Locations from one tagged animal or study | A connected path with study, animal, and date labels |

Where a source supports a **general migration corridor** but not an individual route, it is shown as a broad corridor or animated flow, labeled as an inferred species-level pattern. Individual tracked paths are never presented as the route followed by every member of a species.

### 3.5 India launch collection

The first collection should show contrasting ways birds use India through the year. These are **editorial candidates**, not a final licensed species list:

| Candidate | Role in the experience | Source for the proposed story |
|---|---|---|
| Amur Falcon | A dramatic passage through Northeast India on a much longer intercontinental journey | [Bird Count India migration map](https://birdcount.in/migration-map/amufal1/) |
| Bar-headed Goose | A winter visitor connecting Indian wetlands with breeding areas beyond the Himalaya | [Bird Count India migration map](https://birdcount.in/migration-map/bahgoo/) |
| Indian Golden Oriole | A seasonal shift within India that makes the month slider useful even without a continental crossing | [Bird Count India migration map](https://birdcount.in/migration-map/ingori1/) |
| Indian Peafowl | A familiar resident baseline against which seasonal visitors can be understood | [eBird Status and Trends example](https://science.ebird.org/en/status-and-trends/species/compea/abundance-map) |

Candidate launch entry points include **Northeast India**, **northern wetlands**, and **peninsular India**. Exact map extents and featured places are selected after checking source coverage and geographic precision. Bird Count India's [migration-map collection](https://birdcount.in/migration-maps-home/) and [State of India's Birds 2023](https://birdcount.in/state-of-indias-birds-2023/) are useful editorial references; their maps, text, data, and media each require a rights check before reuse.

### 3.6 Contribute and use data

In the first release, each place and species view should offer a clear **“Help document wildlife”** route to an established observation platform, with guidance on what makes a record useful: a credible identification, date, location with uncertainty, evidence where possible, and the observation method. A native contribution flow can follow after the project has a review process and partners for maintaining the records.

When native observations are introduced, contributors should be able to submit a sighting, see whether it is **unreviewed**, **community reviewed**, or **expert verified**, correct their own record, and choose an appropriate public-location precision. Sensitive locations receive stricter handling. Submissions remain visibly separate from modeled seasonal presence; an unverified sighting cannot silently change a range map.

Researchers and educators should be able to inspect sources, methods, and dataset versions. For records the project is permitted to redistribute, provide a documented export with stable identifiers and citations. Where a source does not permit redistribution, link to its original access route rather than copying its dataset into a download. The project's own publishable records should use biodiversity standards such as [Darwin Core](https://www.gbif.org/data-quality-requirements-occurrences), with a path to sharing suitable datasets through [GBIF](https://www.gbif.org/publishing-data) after contributor consent and data review.

## 4. Functional requirements

Priority definitions: **P0** is required for the first public release; **P1** follows once the core experience is sound; **P2** is exploratory.

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| F01 | P0 | Interactive global globe with pan, rotate, zoom, and place search | A user can navigate to an arbitrary named place and share that view by URL. |
| F02 | P0 | Seasonal control | Changing month updates the visible species layer and place list; the selected period and data resolution remain visible. |
| F03 | P0 | Wildlife at a place | A selected location shows supported species for the period, grouped by seasonal behavior and ordered by relevance. |
| F04 | P0 | Species search | Common and scientific names find the same canonical species profile. Empty and ambiguous results are handled clearly. |
| F05 | P0 | Species profile | Every included species has a name, visual identity, short description, range view, and source metadata; unavailable sections are labeled. |
| F06 | P0 | Evidence labeling | Every map layer identifies whether it is a model, observation, or track and provides source and date information. |
| F07 | P0 | Coverage and uncertainty | Sparse or absent data produces a coverage message rather than an assertion that no animals live there. |
| F08 | P0 | Safe location display | Sensitive observations and tracks are withheld or generalized according to source permissions and product policy. |
| F09 | P0 | Responsive and accessible controls | Globe alternatives, search, filters, time controls, and species information can be operated by keyboard and on mobile. |
| F10 | P1 | Recorded-sighting overlay | A user can toggle dated sightings and inspect source links where redistribution permits. |
| F11 | P0 | Curated migration stories | A user can play an annual journey for at least three selected species; modeled corridors and individual tracks are labeled distinctly. |
| F12 | P1 | Compare two times | A user can compare two months at the same place or for the same species. |
| F13 | P2 | Additional animal groups | Mammals or marine species appear only after suitable seasonal or range data has passed a coverage review. |
| F14 | P2 | 3D habitat scenes | Selected locations may offer immersive scenes, clearly distinguished from geographic evidence. |
| F15 | P1 | Terrain or satellite basemap | A user can switch map style without losing their selected place, time, species, or evidence layers. |
| F16 | P0 | Contribution pathway | From a place or species view, a user can reach a trusted observation workflow and guidance on submitting a useful record. |
| F17 | P0 | Research provenance | A user can inspect dataset source, version, method, citation, and permitted access route for every published layer. |
| F18 | P1 | Native observations | A contributor can submit and amend a sighting; its review state and public-location precision are visible before publication. |
| F19 | P1 | Permitted data export | A researcher can download records or derived summaries that the project is allowed to redistribute, with metadata and stable identifiers. |
| F20 | P2 | Conservation partner views | Approved partners can examine validated seasonal patterns and knowledge gaps at suitable spatial resolution. |

## 5. Seasonal behavior and data rules

The product must keep **time**, **place**, **taxon**, and **evidence type** explicit. A sighting is evidence that an organism was recorded at a place and time; it is not, by itself, a prediction of year-round presence or proof of absence in other months.

For a place and period, the species service returns a ranked list with a presence category, evidence source, model or record date, and coverage level. The rules for resident, seasonal visitor, and passage labels should be configurable per dataset and reviewed against known examples before publication. They must derive from validated seasonal range or abundance data, not from a simple count of raw observations.

Suggested display semantics:

- **Year-round:** modeled presence across most or all of the annual cycle in the selected area.
- **Seasonal visitor:** modeled presence is concentrated in a breeding or non-breeding portion of the year.
- **Passing through:** modeled occurrence peaks during migration periods without a sustained local season.
- **Occurrence uncertain:** the evidence cannot support a confident seasonal label.

These are product labels, not biological classifications. Thresholds and exceptions belong in a documented data pipeline and must be tested with ecological input.

Data quality rules include taxonomy reconciliation, coordinate validation, removal or flagging of obvious outliers, temporal normalization, duplicate handling, source attribution, and license checks. A derived layer keeps its source dataset and processing version so that it can be reproduced or withdrawn.

For project-collected observations, capture at least a stable record ID, taxon identification and its review state, observation date, coordinates and uncertainty or generalized area, observation method, contributor attribution preference, evidence links, usage consent, and sensitivity status. Preserve corrections and review history. Published research exports should meet the relevant [GBIF occurrence-data quality requirements](https://www.gbif.org/data-quality-requirements-occurrences); structured monitoring projects should also record sampling effort so absence and abundance analyses are more defensible.

## 6. Data sources and rights

These are candidate sources for a **free, noncommercial** project. Each source still has its own attribution, access, redistribution, and location-sensitivity conditions. Noncommercial intent does not transfer ownership of a source's data or grant permission to republish it.

| Need | Candidate source | Intended use and constraint |
|---|---|---|
| Bird seasonal patterns | [eBird Status and Trends](https://science.ebird.org/en/status-and-trends) | Modeled weekly abundance and seasonal ranges for supported species; access terms and coverage must be checked for the launch use case. |
| Bird observations | [eBird data and API](https://support.ebird.org/en/support/solutions/articles/48000838205-download-ebird-data) | Recent or historical observations where permitted; the public API is for limited recent and summary outputs. |
| India-specific migration stories and context | [Bird Count India migration maps](https://birdcount.in/migration-maps-home/) and [State of India's Birds 2023](https://birdcount.in/state-of-indias-birds-2023/) | Candidate editorial and validation sources for Indian species; check reuse rights for each content and data asset. |
| Flyway context | [Convention on Migratory Species: Central Asian Flyway](https://www.cms.int/legalinstrument/central-asian-flyway) | Context for journeys connecting India with other parts of Asia; it is not itself a per-species location dataset. |
| General occurrence records | [GBIF Occurrence API](https://techdocs.gbif.org/en/openapi/v1/occurrence) | Supporting observations and provenance; record density must not be treated as population density. |
| Taxonomy and names | [GBIF Species API](https://techdocs.gbif.org/en/openapi/v1/species) | Canonical taxon identifiers, accepted names, and synonyms, with a review path for mismatches. |
| Tracked individual journeys | [Movebank](https://www.movebank.org/cms/movebank-content/access-data) | Selected studies only; study owners control access and use terms. |
| Conservation information | [IUCN Red List API](https://api.iucnredlist.org/) | Status and assessment details under its noncommercial API terms, with required attribution and permitted display checked before integration. |
| Photos and audio | Licensed media providers, to be selected | Store creator, license, attribution, and permitted uses per asset. |
| New project observations | Voluntary contributor submissions, once a review workflow exists | Publish or share only at the consented and safe spatial precision; keep origin, review, and correction history. |

The first release should not depend on having a complete global wildlife dataset. Source coverage varies greatly by species and region. Dataset availability, licensing, and scientific suitability are gates for publishing each layer.

## 7. Safety, trust, and editorial policy

- Respect source-level geoprivacy and access terms. Do not reveal hidden nesting, denning, roosting, or rare-species coordinates through map layers, search, exports, or inferred paths. [iNaturalist's geoprivacy approach](https://help.inaturalist.org/en/support/solutions/articles/151000233080-how-does-inaturalist-protect-the-locations-of-sensitive-species-) and [GBIF guidance](https://docs.gbif.org/sensitive-species-best-practices/master/en/) provide useful precedents.
- Show **last updated**, **source**, and **data type** near claims, not only in a legal footer.
- Distinguish **no data** from **not expected here**. A low-coverage area must never appear biologically empty because few people have reported observations.
- Provide an error-reporting path for taxonomy, location, seasonality, and media attribution issues.
- Keep generated narration or summaries, if introduced later, grounded in reviewed facts and cite those facts in the species profile.
- Keep contributed observations distinct from reviewed models and from conservation conclusions. Invite relevant researchers or local organizations to validate analyses before presenting habitat or corridor priorities as conservation guidance.

## 8. Interface outline

Desktop layout: the globe occupies the main canvas; place and species search sit at the top; the month control runs along the bottom; a collapsible panel holds the current area's wildlife list or the selected species profile. Mobile uses the same controls with the panel as a draggable sheet.

The visual hierarchy should answer three questions in order:

1. **Where and when am I looking?** Place name, map scale, and selected period.
2. **What might I find?** A short, ranked list and visible seasonal pattern.
3. **Why is it shown?** Evidence label, coverage indicator, and source details.

Map color and animation must have a text legend. Seasonal categories must not rely on color alone. Motion can be paused, and the app respects reduced-motion settings.

## 9. Technical outline

This is a proposed implementation shape, not a final vendor commitment.

1. **Web client:** A browser globe and map layer renderer; [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs) currently supports globe projection and is a candidate.
2. **Spatial data service:** Serves places, species search, species profiles, seasonal summaries, and map tiles. A spatial database such as PostgreSQL/PostGIS is a candidate for indexed place and range queries.
3. **Ingestion pipeline:** Imports approved source datasets, reconciles taxonomy, applies quality and sensitivity rules, generates seasonal aggregates and tiles, and records provenance.
4. **Content store:** Holds reviewed species text, media rights, story scripts, and source references.
5. **Contribution and review service (later phase):** Accepts observations, records consent and location precision, supports identification review and corrections, and prepares approved research exports.

Core records should include `Species`, `PlaceOrArea`, `SeasonalPresence`, `Observation`, `Track`, `DatasetVersion`, `MediaAsset`, and `SourceAttribution`. Each geographic record needs a geometry or cell, time interval, evidence type, source ID, usage rights, and public-display precision. Project-collected observations also need contributor consent, review state, coordinate uncertainty, and a correction history.

The client requests precomputed map tiles or area summaries for the visible extent and period. It should not fetch raw worldwide observations on every globe movement. Search and detail views resolve to stable species IDs, so name changes do not break saved links.

## 10. Quality requirements

- **Performance:** The initial globe and search controls should become usable quickly on a normal mobile connection; month changes should feel immediate after the relevant tiles are cached. Set numeric targets after a working prototype and representative device testing.
- **Accessibility:** Keyboard-accessible search, time control, lists, and details; screen-reader descriptions of map findings; sufficient contrast; reduced-motion support.
- **Internationalization:** Unicode names and place search from the start. Localized common names and profile text can be added by market.
- **Reliability:** A source outage should not corrupt previously published datasets; the app should show the last successful data version.
- **Privacy:** Current-location access is opt-in and used only for the requested exploration unless the visitor separately chooses to save it.
- **Observability:** Track data import failures, missing attribution, map errors, search failures, and user-reported content issues.

## 11. Release plan

| Phase | Deliverable | Exit condition |
|---|---|---|
| **0 — Data and interaction proof** | Validate one Indian pilot area, 10–15 bird species, month slider, and one migration story. | Source rights and seasonal signals support the promised experience; users understand the three evidence types. |
| **1 — Public MVP** | Global globe with India as the featured collection; place search; 30–50 curated Indian birds; seasonal presence; species search and profiles; at least three migration stories; source access and a route to contribute observations through a trusted platform. | Core journeys work on desktop and mobile; published species pass data and editorial review; visitors can trace claims to sources and reach the contribution workflow. |
| **2 — Research and participation** | More regions and species; sightings overlay; selected tracked journeys; permitted exports; native observations with review; classroom-friendly stories. | New records have consent, provenance, uncertainty, and review states; export respects source rights and sensitive-location rules. |
| **3 — Conservation and breadth** | More animal groups; partner-led views of validated patterns and evidence gaps; optional immersive habitat scenes. | Conservation partners can use the outputs responsibly, and each new group has a credible source and maintainable data pipeline. |

## 12. Measures of success

The earliest success measure is comprehension: can a first-time visitor tell where a species is *likely* to be in a chosen month, and tell the difference between an estimate and a recorded sighting? Long-term success is measured by useful learning, reliable new data, research reuse, and conservation outcomes rather than revenue.

After release, measure:

- Percentage of visitors who explore a place and change the month at least once.
- Percentage who open a species profile or follow a migration story.
- Search success and zero-result rate.
- Whether users correctly interpret uncertainty and evidence labels in short usability sessions.
- Coverage by region and species, plus the age and failure rate of each published dataset.
- Content corrections and rights issues per published species or media asset.
- Number of new observations that pass review, with geographic and seasonal gaps they help close.
- Documented reuse of project-published data in teaching, research, and validated conservation work.

## 13. Open product decisions

1. **India pilot area:** Choose the first high-resolution test area within India using audience interest, seasonal data quality, and source rights. India is the confirmed launch focus.
2. **Contribution partners:** Choose an established Indian observation workflow for the first release and decide when native submissions can be responsibly reviewed.
3. **Open-data policy:** Set contributor consent and the license for the project's own publishable records. Imported sources keep their original terms; exports must not silently relicense them.
4. **Visual tone:** Scientific atlas, cinematic exploration, or a blend. A prototype should test whether animation improves understanding.
5. **Content depth:** Decide whether the first species profiles are short and highly curated or broader and partially automated.
6. **Language sequence:** English can support the first prototype; decide which Indian languages to add for the public release.
7. **Account features:** Saving places or species can wait until the core exploration journey proves useful; contributing native observations will require a way to manage corrections and consent.

## 14. Definition of a successful first release

A new visitor can search for a place, move through the year, discover a few relevant birds, open one species, understand its seasonal geography, and see why the product believes it belongs on the map. Where evidence is weak, the product says so plainly. The visitor can find the underlying source or a trusted route to contribute a new observation. That full learning-to-contribution journey is the first-release benchmark.
