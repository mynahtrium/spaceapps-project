# Full team plan

Repo: mynahtrium/spaceapps-project. AGENTS.md is the role sheet. No secrets in git. No force-push.

Each agent stays on one long-lived branch and pulls then pushes that branch after each prompt. Merge to main only when asked. Keep both sides of AGENT_LOG and BOARD conflicts. Status and handoffs go in docs/comms/. Do not invent outcrop names. Stops stay is_example until PRE-07 is locked.

## Who does what

- Cagan, largest: pipeline/terrain/ and pipeline/costmap/, including a HiRISE crop that covers the example stops. Branches backend/terrain and backend/costmap.
- Doruk / Backend 2, second: pipeline/stops/ and pipeline/routing/. Branches backend/stops and backend/routing. Re-run the route when Cagan's cost map covers the stops.
- cc, small: science cache leftovers in pipeline/data/. Branch backend/science. NASA key stays in local .env only.
- Frontend 1: planner and HUD read the route, stops, and telemetry contracts. Branch frontend/planner-hud. Does not edit pipeline folders.
- Tester 1: test plan, checks, docs/AI_USE.md rollup. Branch tester/review.
- Tester 2: demo path, short subtitled video or 7-slide alternative. Branch tester/demo. No under-18 faces or voices.

## Order

1. Each agent reads AGENTS.md, claims only its folders, and posts a docs/comms note.
2. Cagan crops terrain and writes the cost map. cc fills science fixtures. Doruk keeps example stops and routing working against the current cost map.
3. Frontend wires the planner and HUD and notes missing fields in docs/comms/.
4. Tester 1 writes the checklist. Tester 2 scripts the demo.
5. Merge only when asked: backend/terrain, backend/costmap, backend/stops, backend/routing, backend/science, frontend/planner-hud, tester/review, tester/demo into main, push main, then Tester 1 records what actually runs.

## Already pushed, not merged

- PR #3 tester/review
- PR #4 tester/demo
- PR #5 backend/science
- PR #6 backend/terrain
- PR #7 backend/costmap
- PR #8 backend/routing and backend/stops at 3aeb82c (790.3 m)
- Frontend was stopped before its branch landed.
