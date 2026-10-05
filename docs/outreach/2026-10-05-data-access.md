# Data access requests (issue #4)

Two requests to send now: eBird reviews data requests by hand, and the answer gates issue #1 (reporting frequency).
Fill in the bracketed parts. Record each reply in `docs/decisions/` and in the layer manifest (F17).

## 1. eBird Basic Dataset (EBD) + sampling event data

Where: https://ebird.org/data/download (sign in, then "Request access"). The form asks for a project description
and intended use. Suggested answers:

**Project title:** Wildlife Atlas: where birds are through the year, and why they move

**Description:**
Wildlife Atlas is an open, non-commercial educational globe that shows which bird species are likely to be present
in a place in a given month, and how that changes through the year. Its first audience is students and enthusiasts
in India; the map covers the whole world. The code is public at https://github.com/DohaerisAI/wildlife-atlas.

**Intended use:**
We want to replace raw occurrence counts with effort-corrected reporting frequency: for each grid cell and month,
the share of complete checklists that report a species. We would use the EBD with its sampling event file, filtered
to complete checklists, and publish only aggregated monthly frequencies per grid cell (no individual records, no
observer information, sensitive species withheld or generalised). Every view credits eBird and the Cornell Lab of
Ornithology and links to the source.

**Regions / time:** [India first, then global] · [2015–2024]

**Questions for eBird (add to the request):**
- Do the terms allow publishing derived monthly reporting frequencies per grid cell on a public website?
- Can modelled weekly abundance from eBird Status & Trends be displayed, or only linked?

## 2. Email to Bird Count India

To: [contact address from https://birdcount.in/contact/]
Subject: Wildlife Atlas: seasonal bird presence for India, asking for guidance

> Hello Bird Count India team,
>
> I'm building Wildlife Atlas, an open, non-commercial globe that answers "which birds can I expect here this
> month?" for students and enthusiasts in India (code: https://github.com/DohaerisAI/wildlife-atlas).
>
> I want the seasonal labels (year-round, seasonal visitor, passing through) to follow the same reporting-frequency
> approach as State of India's Birds, using eBird complete checklists, rather than raw record counts. I've asked
> eBird for EBD access and would value your guidance on three things:
>
> 1. Effort thresholds and grid sizes you consider reliable for Indian districts and parks.
> 2. Whether you'd be willing to sanity-check labels for a handful of species (Bar-headed Goose, Amur Falcon,
>    Indian Golden Oriole, Indian Peafowl) before anything is public.
> 3. The right way to credit and link Bird Count India's migration maps and SoIB, and which of them may be reused.
>
> Happy to share early builds. Thank you for the work you do.
>
> [Your name]
> [Email]
