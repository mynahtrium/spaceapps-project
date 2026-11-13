# Bug tester 2 — demo rehearsal, video, slides, merge checks

You are a bug tester who also owns the **show**. You write SHOULD/STRETCH and demo checklists, review PRs (especially frontend), run rehearsals, and support the 30-second video and slides. Tester 1 owns MUST test plans and the AI-use log; you two cover for each other on reviews.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/ai-use-log/SKILL.md](../../skills/ai-use-log/SKILL.md).

**No application code before 14 November 2026.** Demo scripts and slide outlines in `docs/demo/` are allowed now.


## Session start and end

Follow the checklist in [AGENTS.md](../../AGENTS.md): `git pull`; read [BOARD.md](../coordination/BOARD.md), [HANDOFFS.md](../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../coordination/AGENT_LOG.md) entries, and all [profiles](../team/profiles/). **First session:** run the [onboarding interview](../team/profiles/README.md) **before any other work**. Claim a board task, work on a `ROLE/short-topic` branch, test, append the agent log in the same commit (`Commit: this commit`), update the board, and open a PR for a tester. At 6-hour marks, append [STANDUP.md](../coordination/STANDUP.md).
## Responsibilities

- Demo flow (about 2–3 minutes) and a 30-second video beat sheet, updated to the 12 November decisions: 3D HUD first, planner feeds the route, lake-sediment goal, boxwork as a bonus stop.
- Rehearsal at hours 40–44; backup recording; submit-early checklist.
- Under-18 rule: no photos, video, voices, or likenesses of under-18s in any take. Prefer screen recording + captions (or an adult / synthetic voice if the official guide allows — still **UNVERIFIED**). The [official terms](https://www.spaceappschallenge.org/legal/) (updated 7 August 2026) require under-18s to be registered by a parent or legal guardian and accompanied by that parent/legal guardian throughout the event, and require participants to register online before the event starts.
- Demo submission (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); see the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)): if you record a video, it must be **30 s or less**, have **English subtitles**, and be shared as a **public no-login link**. A **7-slide** presentation (including title and introductory slides) is an allowed alternative.
- Honesty on slides: lunar slope stand-in, DTM under-reads tilt, radiation is mostly a time problem, O₂ and walk time are placeholders, list sources and dates.
- Rehearse and record in **demo-safe mode** (`?demo=1`) so the video does not depend on venue Wi-Fi. Tester 1 signs the network-off check.
- On 13 November, with Tester 1, update [docs/JUDGING_CHECKLIST.md](../JUDGING_CHECKLIST.md) from the official guide (board **PRE-06**). A 13 November check could not read the guide (certificate error / HTTP 500); a status note was added and the checklist stays **UNVERIFIED**. PRE-06 remains `todo` until the guide can be read.
- PR reviews, especially `web/`. Every PR needs one tester approval.

## Owned folders

- `docs/demo/` (script, slide outline, video beat sheet, submission checklist)

Review-only elsewhere. Do not add features to `web/`; file issues for Frontend 1 instead.

## Tasks by phase

**Pre-14 Nov:** Account, practice PR, draft `docs/demo/script.md` and `docs/demo/video-beats.md` from the roadmap (docs only). A later 13 November `curl -k` reading of the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/) is provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00): English-subtitled video ≤30 s with a public no-login link, or a 7-slide alternative. Do not start application code.

**Hours 0–16:** Watch the MUST build; review frontend PRs; keep the script in sync (cut any line that the software cannot yet show). At hour 16, walk the demo once even if it is rough.

**Hours 16–32:** Add SHOULD beats (dose, DONKI, POV, weather/thermal) only when testers signed them off. Review frontend PRs.

**Hours 32–40:** Stretch is optional in the video. If WebXR is flaky, the recorded demo stays on the normal web HUD.

**Hours 40–48:** Freeze. Record the planned 30-second (or less) screen video with **English subtitles**, and upload it as a **public no-login link** — or ship a 7-slide presentation instead (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); see the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)). Build slides with a presenter. Submission checklist: description, SI-tools blurb from Tester 1 (disclosure required; SI form answer is not shown to judges; provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00)), sources, backup file, early upload. Submit on the Team page's Project tab. Official window, from the [2026 landing page](https://www.spaceappschallenge.org/2026/): opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time**. Nothing new after hour 40.

Suggested 30-second beats (adapt after you read the official guide): (0–5 s) first humans need a map of *their* walk at Mount Sharp; (5–12 s) planner context into the 3D visor; (12–22 s) hazard + route + a science stop (mudstone, then boxwork bonus if time); (22–27 s) dose and space-weather card; (27–30 s) team name + "built from NASA data."

## Handoffs

| When | You give | To |
|---|---|---|
| Pre-14 Nov | Draft script and beats | Whole team for comments |
| Each frontend PR | Review | Frontend 1 |
| Hour 40–44 | Frozen video + slide draft + backup | Submitter |
| Hour 44–48 | Submit-early confirmation | Whole team |

## Checklist

- [ ] Demo script matches what the app can actually do
- [ ] Video has no under-18 likeness or voice
- [ ] Video is 30 s or less (or 7-slide alternative), has English subtitles, and the upload link is public with no login
- [ ] Honesty + sources on slides
- [ ] Backup recording and a tagged or noted commit
- [ ] AI use logged (your rows too) — disclose SI/AI use; never use it to come up with the challenge idea (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/))

## Ready-to-paste prompt for your coding agent

```
You are helping Bug tester 2 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/GITHUB_WORKFLOW.md, docs/roles/tester-2.md, and docs/demo/ files.

Rules: If today is before 14 November 2026, no application code. You may write docs in docs/demo/ only. Do not implement web/ or pipeline/ features. Never commit secrets. Log AI use in docs/AI_USE.md. Keep the repo private.

Help with a beginner-friendly demo script, 30-second-or-less video beat sheet, slide outline, and submission checklist. No photos, voices, or likenesses of under-18s. Video (if used) needs English subtitles and a public no-login link; a 7-slide presentation is an allowed alternative (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00); [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)). Be honest about placeholders (slope limits, O2, walk time) and remaining **UNVERIFIED** items (including the "do not build early" rule). Official submission window (2026 landing page): Team page Project tab, opens 14 Nov 09:00 and closes 15 Nov 23:59 local event time. Science goal: ancient lake sediments / habitability at Gale / Mount Sharp; boxwork is a bonus stop. Format: 3D helmet HUD fed by a 2D MapLibre planner; WebXR is stretch only.

First session: interview your human before other work (docs/team/profiles/README.md). At every session start, read BOARD, HANDOFFS, the latest AGENT_LOG entries, and all profiles. Claim a board task before starting. Append docs/coordination/AGENT_LOG.md in the same commit (Commit: this commit).

Task: [DESCRIBE THE TASK]
```
