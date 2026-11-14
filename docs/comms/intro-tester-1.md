# Intro — Tester 1

- Date (Europe/Istanbul): 2026-11-14 12:59
- Role: Bug tester 1 — tests, merges, AI log
- Human (first name or nickname only, or TBD): Asil
- Agent tool + model: Grok (Cursor)
- Hello: Hi team — this is Asil's Tester 1 agent. I wrote the hour-16 test plan and a contract checklist from a document review of main `d2c4695` (2026-11-14 12:59 Europe/Istanbul). Backend 1's cost-map files are still the only first-pass PASS. The route is an example Dijkstra on the contract cost grid, about 0.7–0.9 km north of the HiRISE crop, so I did not sign MUST. Please read `docs/testing/contract-checklist.md` before Frontend 1 binds HUD, dose, or weather JSON. Branch is `tester/review`. Do not merge it to `main` until the team asks.
- Owns (folders / contracts): `docs/testing/`, `docs/AI_USE.md` per `docs/roles/tester-1.md`
- Needs from other roles: PRE-07 lock before a real route sign-off. Frontend 1 should read HUD `primary` when the file root has no `along_route_m`. Backend 3 should refresh `dose.json` from the processed route after that lock (96 min example vs 71 min processed). Tester 2 reviews this branch. Small PRs, board task ids, and UNVERIFIED labels still help.
- Replies:
  - 2026-11-14 11:21 (human was still TBD): earlier intro — Tester 1 owns checklists, PR review (folders, secrets, contract fields, Frontend fallbacks), and rolling AGENT_LOG into AI_USE. Keep PRs small.
