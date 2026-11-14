# pipeline/data/

Owned by **Backend 3** (long-lived branch `backend/science`). These scripts cache REMS, RAD, DONKI, Curiosity POV stills, weather, and THEMIS / CRISM layer metadata. See [docs/roles/backend-3-data.md](../../docs/roles/backend-3-data.md).

## Offline (no NASA_API_KEY)

`NASA_API_KEY` stays in the environment or a gitignored `.env`. Never commit it. `DEMO_KEY` is refused. If the key is missing, do not call `api.nasa.gov`.

```bash
python -m pipeline.data.run_examples
```

That command:

- writes labelled example fixtures `data/processed/science/donki-cache.example.json` and `alerts.example.json` (the 11 Nov 2026 planning-check Mars arrival already in `docs/contracts/alerts.json`)
- leaves a real `donki-cache.json` and `alerts.json` unchanged
- refreshes `dose.json` from `data/processed/routing/route.json` when that file exists (still an example until PRE-07; walk time stays a placeholder)
- rewrites POV JSON from the on-disk stops file and reuses JPEGs already in `pov/` (no image download)
- copies those science fixtures into `data/demo/`

`python -m pipeline.data.fetch_donki` takes the same skip path when the key is missing.

## Live fetchers

`run_must07`, `run_phase2`, and `run_phase3` still use the network for waypoints, PDS listings, weather, THEMIS, CRISM, and POV downloads. The DONKI live fetch also needs a personal key. Do not run them on a machine that should stay offline.
