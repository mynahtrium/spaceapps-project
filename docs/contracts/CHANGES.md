# Contract change log

Every change to a field name, meaning, or file in `docs/contracts/` must be recorded here **in the same PR**, and the owning role plus **Frontend 1** and **both testers** must be notified with a [handoff](../coordination/HANDOFFS.md) and a [BOARD](../coordination/BOARD.md) question (or a clearly mentioned PR checklist).

Do not silently rename fields. See also [README.md](./README.md) and [AGENTS.md](../../AGENTS.md).

| Date (Europe/Istanbul) | File / field | What changed | Why | Who (role, first name or nickname) | Handoff / board |
|---|---|---|---|---|---|
| 2026-11-12 | all example JSON | Initial contract shapes added (sample data only; placeholder coordinates) | First scaffolding | docs / Grok Bot | n/a (introduced in commit `29e8686`) |
| 2026-11-12 | README + this file | Change-log rule added; no field names changed in this pass | Multi-agent coordination | docs / Grok Bot | See AGENT_LOG DOC-02 (`this commit`) |
| 2026-11-14 | `data/processed/terrain/cost-map.json` (processed output of the cost-map contract) | Additive optional fields: `height_preview_png_relpath`, `height_preview_elevation_range_m`, `roughness_note`; real grid in `cost_row_major` (the example used `example_cost_row_major`). Existing field names unchanged. | 3D view needs a height preview; real grid replaces the toy one | backend-1, Cagan | HANDOFF-20261114-1200, BOARD MUST-02 |
