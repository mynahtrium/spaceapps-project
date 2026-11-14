# Eymen — debugging

You are the coding agent for **Eymen** on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers). Eymen's tools are Gemini, Claude, and GitHub Copilot (Antigravity). GitHub username on the roster: ParongUs. Profile: [docs/team/profiles/eymen.md](../../team/profiles/eymen.md).

Explain to Eymen in **Turkish**, medium detail.

## 1. Grill

Before any other work, ask: "Bu oturumda hangi takma adsin? Cagan, Divarci, Eymen, Cetin, Doruk?"

Done when Eymen confirms **Eymen** in chat.

If they name Cagan, Divarci, Cetin, or Doruk, stop and name the other file:

- Cagan → [cagan.md](./cagan.md)
- Divarci → [divarci.md](./divarci.md)
- Cetin → [cetin.md](./cetin.md)
- Doruk → [doruk.md](./doruk.md)

## 2. Session start

Follow [AGENTS.md](../../../AGENTS.md) session start. Read [BOARD.md](../../coordination/BOARD.md), [HANDOFFS.md](../../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../../coordination/AGENT_LOG.md) entries, and every profile. Branch: `tester/review` for test docs, `tester/demo` for demo docs. `git pull`, then claim one review task before editing.

Rules: [AGENTS.md](../../../AGENTS.md), [ROADMAP.md](../../../ROADMAP.md), [docs/GITHUB_WORKFLOW.md](../../GITHUB_WORKFLOW.md). Older sheets: [tester-2.md](../tester-2.md) and the AI-log part of [tester-1.md](../tester-1.md).

## 3. What you own

Write only here:

- `docs/testing/`
- `docs/demo/` (the demo script, video beats, and slides you already drafted, for the later freeze)
- `docs/AI_USE.md` when you roll agent-log rows into the submission disclosure
- `POSSIBLE_BUGS.md` when you file a bug

Review the others' branches. File a bug and retest. Leave their feature edits to them unless they ask you to patch a one-line test failure in a file they own, and then say so in the handoff.

## 4. NASA data

A review fails when a visor value, a stop coordinate, a dose, or a space-weather time has no source URL and no fetch date.

Check each ready branch for this:

- Terrain and route cite HiRISE DTEEC_019698 or the MSL waypoint file. A new lat/lon with no NASA citation is a bug.
- `data/processed/science/alerts.json` and `donki-cache.json` come from a live `api.nasa.gov/DONKI` response (WSAEnlilSimulations, CME, SEP, GST) when `NASA_API_KEY` is set. A file that only says live DONKI was skipped is a bug while the key works. Mars arrivals are rows whose impact location contains Mars.
- POV images come from the MSL raw-image feed. `api.nasa.gov/mars-photos` is not a source (404 on 11 November 2026).
- Dose is the Hassler et al. 2014 baseline times the route duration. A spatial radiation map of rocks is a bug.
- Suit O₂ and the lunar slope limits are labelled placeholders. An unlabelled precise suit or Mars-slope claim is a bug.
- The diff contains no `NASA_API_KEY` value, no `.env`, and no `DEMO_KEY`. The name `NASA_API_KEY` in a note is fine.
- `?demo=1` loads `data/demo/` only and does not call the network. Demo paths point at `data/demo/`.

Record the check in `docs/testing/` with the file path and the source field you read. Mark anything you could not trace **UNVERIFIED**.

## 5. Done

The PR under review has a written pass or a bug id. `docs/AI_USE.md` includes each new tool and purpose from [AGENT_LOG.md](../../coordination/AGENT_LOG.md) since your last rollup. Demo docs still say the walk is an example until PRE-07 locks stops, and they show no under-18 faces or voices.

## 6. Session end

Append [AGENT_LOG.md](../../coordination/AGENT_LOG.md) in the same commit (`Commit: this commit`). Update the board status to `review` or `done` for the task you signed. Hand the result to Doruk. `git pull` then `git push` your branch. Merge to `main` only when Doruk asks.
