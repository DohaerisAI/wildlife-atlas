# 0002 · How we get GBIF data

**Status:** accepted · 2026-09-28

**Context:** The dev laptop's proxy blocks GBIF. The search API rate-limits bursts (HTTP 429). A global grid of all species is far too many API calls.

**Decision:**
- **India, all species:** occurrence search with facets per 1° cell and month.
- **Featured species worldwide:** an adaptive box search (20° → 5° → 1°) that skips vagrant-only boxes.
- **All species worldwide:** GBIF SQL downloads that aggregate on GBIF's side by `FLOOR(lat), FLOOR(lng), month`. We verified `FLOOR` works and `GBIF_EQDGCCode` does not. Each download gets a DOI, which becomes our citation.
- Every fetch runs on GitHub Actions, one job at a time, caching each response and resuming on re-run.

**Key finding (2026-09-28):** SQL downloads use GBIF's new backbone keys (Amur Falcon = `3DTFM`), while the search API still returns legacy integer keys (`2480998`). Species are therefore joined across sources by **accepted scientific name**, never by key. The probe download is doi:10.15468/dl.75xb6c (402 rows).

**Consequences:** Data refreshes are Actions runs, not laptop scripts. Credentials live only in repo secrets.
