# Bug tester 1 — test plans, merge checks, AI-use log

You are a bug tester, not a third backend. You protect `main`, write the MUST (and shared) test plans, review pull requests (especially backends), and keep the SI / AI-use log in shape for submission. Tester 2 owns demo / video / slides; you two cover for each other on reviews.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/ai-use-log/SKILL.md](../../skills/ai-use-log/SKILL.md), [docs/contracts/README.md](../contracts/README.md).

**No application code before 14 November 2026.** You may write checklists and this docs tree now.


## Session start and end

Follow the checklist in [AGENTS.md](../../AGENTS.md): long-lived branch; **after every prompt** pull then push (merge to `main` only when asked); read [BOARD.md](../coordination/BOARD.md), [HANDOFFS.md](../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../coordination/AGENT_LOG.md) entries, and all [profiles](../team/profiles/). **First session:** run the [onboarding interview](../team/profiles/README.md) **before any other work**. Claim a board task, test, append the agent log in the same commit (`Commit: this commit`), update the board. At 6-hour marks, append [STANDUP.md](../coordination/STANDUP.md).

**Not this backend pass** (Cagan / Doruk / CC). Review when PRs land.

## Responsibilities

- Written test plans for MUST (hour 16) and regression; help Tester 2 with SHOULD/STRETCH if asked.
- Review PRs before merge: does it stay in owned folders, are secrets absent, do contract fields still match, can Frontend 1 still load fallbacks?
- Maintain [docs/AI_USE.md](../AI_USE.md): everyone adds their own rows; you nag and turn the log into the submission's SI-tools paragraph at hours 40–44. Disclosure is required; AI/SI must **not** be used to come up with the challenge idea; the SI form answer is not shown to judges (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); see the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)).
- File bugs as GitHub issues. Do not silently fix other people's folders (tiny typo in a contract *example* only with the owner's OK).
- Confirm under-18 recording rules are understood (Tester 2 checks the actual takes).
- **Demo-safe check (hour 32, board SHOULD-07 / SHOULD-08):** with `DEMO_SAFE=1` or `?demo=1`, the app must load only `data/demo/` fixtures and must not call the network, NASA, or DONKI.
- On 13 November, with Tester 2, update [docs/JUDGING_CHECKLIST.md](../JUDGING_CHECKLIST.md) from the official judging guide (board **PRE-06**). A 13 November check could not read the guide; a status note was added and the checklist stays **UNVERIFIED**. PRE-06 remains `todo`.
- Keep [AGENT_LOG.md](../coordination/AGENT_LOG.md) honest and roll it into [docs/AI_USE.md](../AI_USE.md) before submission.

## Owned folders

- `docs/testing/`
- `docs/AI_USE.md` (hygiene and submission wording; do not delete other people's rows)

Review-only everywhere else. Prefer reviewing **backend** PRs; Tester 2 leads on **frontend** and demo docs, but either tester may review any PR if the other is busy. Every PR needs **one** tester approval before merge.

## Tasks by phase

**Pre-14 Nov:** Account, practice PR, draft `docs/testing/must-checklist.md` (docs only), read the 13 November guides when they can be loaded (a 13 November check failed; they stay **UNVERIFIED**), remind the team to log AI use and to lock stops inside the DTM. A Curiosity waypoint reference is in [docs/testing/STOP_COORDINATE_CHECK.md](../testing/STOP_COORDINATE_CHECK.md); stops are not locked yet (PRE-07).

**Hours 0–16:** Kickoff checklist (everyone cloned, branches named correctly). Review all early PRs quickly. Walk the MUST plan at hours 14–16. **MUST sign-off** or force fallbacks (contract JSON) and record what was cut.

**Hours 16–32:** Regression after each SHOULD merge. Check dose numbers against the cited baseline, and that alerts are cached, not live-only.

**Hours 32–40:** If stretch starts, add a short WebXR / rover-mode checklist. Block stretch that endangers the MUST demo.

**Hours 40–48:** Feature freeze. Write the SI-tools blurb: disclose how AI/SI was used; do not use it to come up with the challenge idea; the SI form answer is not shown to judges (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); see the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)). Help Tester 2 with submission fields (sources, limits, honesty notes). Official window, from the [2026 landing page](https://www.spaceappschallenge.org/2026/): submit on the Team page's Project tab; opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time**. Do not allow "one more feature."

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
- [ ] `docs/AI_USE.md` has a row for each substantive AI use — disclose SI/AI use; never use it to come up with the challenge idea; SI form answer is not shown to judges (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/))
- [ ] MUST / SHOULD sign-offs recorded in `docs/testing/`
- [ ] Official 13 Nov guide items added to the checklist after you read them

## Ready-to-paste prompt for your coding agent

```
You are helping Bug tester 1 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/GITHUB_WORKFLOW.md, docs/roles/tester-1.md, and docs/contracts/README.md.

Rules: If today is before 14 November 2026, no application code. You may draft docs in docs/testing/ and tidy docs/AI_USE.md without deleting other people's rows. Do not rewrite pipeline/ or web/. Never commit secrets. Keep the repo private. Log your own AI use.

Write clear, beginner-friendly test plans and PR review notes. Definition of MUST/SHOULD/STRETCH is in ROADMAP.md. Frontend must fall back to docs/contracts/. Slope limits and suit O2 are placeholders. Do not invent science. Mark UNVERIFIED items (including the 13 Nov judging guide until it is read).

Site: Gale / Mount Sharp, lake-sediment / habitability science goal, boxwork bonus stop, 3D HUD fed by a MapLibre planner.

First session: interview your human before other work (docs/team/profiles/README.md). At every session start, read BOARD, HANDOFFS, the latest AGENT_LOG entries, and all profiles. Claim a board task before starting. Append docs/coordination/AGENT_LOG.md in the same commit (Commit: this commit).

Task: [DESCRIBE THE TASK]
```
