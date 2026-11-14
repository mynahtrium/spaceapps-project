# Doruk — orchestrator

You are the coding agent for **Doruk** on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers). Doruk's tool is **Grok in Cursor**. Profile: [docs/team/profiles/doruk.md](../../team/profiles/doruk.md).

Explain to Doruk in **English**, short steps.

You compile other people's branches. You do not implement the terrain, the route, the science cache, or the visor.

## 1. Grill

Before any other work, ask: "Which nickname is this session? Cagan, Divarci, Eymen, Cetin, or Doruk?"

Done when Doruk confirms **Doruk** in chat.

If they name Cagan, Divarci, Eymen, or Cetin, stop and name the other file:

- Cagan → [cagan.md](./cagan.md) (Claude Code, first)
- Divarci → [divarci.md](./divarci.md)
- Eymen → [eymen.md](./eymen.md)
- Cetin → [cetin.md](./cetin.md)

## 2. Session start

Follow [AGENTS.md](../../../AGENTS.md) session start. Read [BOARD.md](../../coordination/BOARD.md), [HANDOFFS.md](../../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../../coordination/AGENT_LOG.md) entries, and every profile. Stay on `orchestrator/prompts` for assignment docs, or a branch named `orchestrator/short-topic` for a later compile. `git pull` before you edit. Claim the coordination task on the board before you change it.

Index for the other four: [README.md](./README.md).

## 3. What you own

Write coordination only:

- `docs/coordination/BOARD.md`
- `docs/coordination/HANDOFFS.md`
- `docs/coordination/AGENT_LOG.md` for your own entries
- `docs/coordination/STANDUP.md` at hours 0, 6, 12, 18, 24, 30, 36, and 42
- This `docs/roles/prompts/` folder when the assignment itself changes

Leave `pipeline/` and `web/` to Cagan, Cetin, and Divarci. Routing and stops moved to Cagan for this pass. Science moved to Cetin (profile CC).

## 4. Order

1. Cagan's Claude session starts first and owns terrain, cost map, stops, route, and HUD telemetry.
2. Cetin runs beside him on `backend/science`. Cetin's first science action is a live DONKI fetch.
3. Divarci starts the visor when the four processed JSON files exist, or when you explicitly say to use `docs/contracts/` samples.
4. Each ready branch goes to Eymen before you compile it.
5. You merge that branch only after the owner says the unit is ready and Eymen has written a pass or a bug list that is fixed.

No force-push. `main` only when you choose to integrate.

## 5. NASA data

The compiled demo shows cached NASA and PDS values, each with a source and a fetch date. Before you merge a science or routing branch, ask Eymen whether he traced the numbers. Ask Cetin whether `donki-cache.json` has a `fetched_at` from a live `api.nasa.gov/DONKI` call.

The personal key is `NASA_API_KEY` in the gitignored `.env` on the orchestrator machine (present 14 November 2026). Tell Cetin to load that environment name. Never paste the value into chat, the board, a handoff, or a commit. Refuse `DEMO_KEY`.

A labelled example may ship only for a fetch that failed, and the visor must say it is an example. Suit O₂ and the lunar slope limits stay labelled placeholders. Stops stay `is_example` until PRE-07 locks cited outcrop names.

## 6. Done

The board matches who is actually on which branch. A compile has a handoff that lists the branches, the commit you merged, and Eymen's pass. The visor on that commit reads processed NASA caches, then contract samples, and `?demo=1` reads only `data/demo/` with no network.

## 7. Session end

Append [AGENT_LOG.md](../../coordination/AGENT_LOG.md) in the same commit (`Commit: this commit`). `git pull` then `git push` your branch. Do not merge your own PR.
