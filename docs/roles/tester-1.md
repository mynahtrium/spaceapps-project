# Bug tester 1 — test plans, merge checks, AI-use log

You are a bug tester, not a third backend. You protect `main`, write the MUST (and shared) test plans, review pull requests (especially backends), and keep the SI / AI-use log in shape for submission. Tester 2 owns demo / video / slides; you two cover for each other on reviews.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/ai-use-log/SKILL.md](../../skills/ai-use-log/SKILL.md), [docs/contracts/README.md](../contracts/README.md).

**No application code before 14 November 2026.** You may write checklists and this docs tree now.

## Responsibilities

- Written test plans for MUST (hour 16) and regression; help Tester 2 with SHOULD/STRETCH if asked.
- Review PRs before merge: does it stay in owned folders, are secrets absent, do contract fields still match, can Frontend 1 still load fallbacks?
- Maintain [docs/AI_USE.md](../AI_USE.md): everyone adds their own rows; you nag and turn the log into the submission's SI-tools paragraph at hours 40–44.
- File bugs as GitHub issues. Do not silently fix other people's folders (tiny typo in a contract *example* only with the owner's OK).
- Confirm under-18 recording rules are understood (Tester 2 checks the actual takes).

## Owned folders

- `docs/testing/`
- `docs/AI_USE.md` (hygiene and submission wording; do not delete other people's rows)

Review-only everywhere else. Prefer reviewing **backend** PRs; Tester 2 leads on **frontend** and demo docs, but either tester may review any PR if the other is busy. Every PR needs **one** tester approval before merge.

## Tasks by phase

**Pre-14 Nov:** Account, practice PR, draft `docs/testing/must-checklist.md` (docs only), read the 13 November guides the same day they appear (**UNVERIFIED** until then), remind the team to log AI use and to lock stops inside the DTM.

**Hours 0–16:** Kickoff checklist (everyone cloned, branches named correctly). Review all early PRs quickly. Walk the MUST plan at hours 14–16. **MUST sign-off** or force fallbacks (contract JSON) and record what was cut.

**Hours 16–32:** Regression after each SHOULD merge. Check dose numbers against the cited baseline, and that alerts are cached, not live-only.

**Hours 32–40:** If stretch starts, add a short WebXR / rover-mode checklist. Block stretch that endangers the MUST demo.

**Hours 40–48:** Feature freeze. Write the SI-tools blurb. Help Tester 2 with submission fields (sources, limits, honesty notes). Do not allow "one more feature."

## Handoffs

| When | You give | To |
|---|---|---|
| Pre-14 Nov and hour 0 | Checklists in `docs/testing/` | Whole team |
| Each PR | Approve, request changes, or reject secrets | The author and whoever merges |
| Hour 16 / 32 | Sign-off or a written fail + fallback | Whole team |
| Hour 40–44 | SI-tools paragraph from the log | Tester 2 / submitter |

## Checklist (standing)

- [ ] Every PR reviewed by a tester, small, and in the right folder
- [ ] No `.env`, keys, or `data/raw/` in git
- [ ] `docs/AI_USE.md` has a row for each substantive AI use
- [ ] MUST / SHOULD sign-offs recorded in `docs/testing/`
- [ ] Official 13 Nov guide items added to the checklist after you read them

## Ready-to-paste prompt for your coding agent

```
You are helping Bug tester 1 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/GITHUB_WORKFLOW.md, docs/roles/tester-1.md, and docs/contracts/README.md.

Rules: If today is before 14 November 2026, no application code. You may draft docs in docs/testing/ and tidy docs/AI_USE.md without deleting other people's rows. Do not rewrite pipeline/ or web/. Never commit secrets. Keep the repo private. Log your own AI use.

Write clear, beginner-friendly test plans and PR review notes. Definition of MUST/SHOULD/STRETCH is in ROADMAP.md. Frontend must fall back to docs/contracts/. Slope limits and suit O2 are placeholders. Do not invent science. Mark UNVERIFIED items (including the 13 Nov judging guide until it is read).

Site: Gale / Mount Sharp, lake-sediment / habitability science goal, boxwork bonus stop, 3D HUD fed by a MapLibre planner.

Task: [DESCRIBE THE TASK]
```
