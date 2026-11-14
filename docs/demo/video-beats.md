# 30-Second Video Beat Sheet — Martian Mappers

**Owner:** Bug tester 2 (Eymen)  
**Format rules (provisionally official from 13 Nov `curl -k` read of the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/); confirm when TLS cert is valid):**
- **Length:** **30 seconds or less** (hard cap: aim for **28–29 seconds** so player rounding never reads 0:31).
- **Audio / Subtitles:** **English subtitles are required** (burned-in captions + `.srt` if possible).
- **Under-18 protection (mandatory):** **Zero** photos, webcam video, voices, or likenesses of under-18 team members. Use **screen recording + burned-in English captions** only (silent or royalty-free instrumental background tone; no minor voiceover).
- **Hosting:** Upload to a **public, no-login, no-password link** (e.g., public/unlisted YouTube with no sign-in gate, or public GitHub release asset) and keep a local `.mp4` backup.
- **Alternative:** A **7-slide presentation** (see [slides-outline.md](./slides-outline.md)) is also an allowed demo submission format; we prepare both so submission is bulletproof.

---

## Second-by-Second Beat Sheet (30 s Total)

| Time | Visual (Screen Recording in `?demo=1` Mode) | Burned-in English Subtitle (On-Screen Text) | Milestone Needed |
|---|---|---|---|
| **0–5 s** | Quick zoom into Gale Crater / lower Mount Sharp on the 2D planner, then cut to the 3D visor overlooking the terrain. | *"When humans walk Mount Sharp, they need more than a rover path—they need a safe crew traverse."* | MUST-08 / MUST-09 |
| **5–12 s** | On the 2D MapLibre planner: toggle the HiRISE 1 m slope/hazard cost map (green/amber/red/blocked >20°), click **"Start EVA"** (`mm:set-route`), and watch the route appear in the 3D helmet HUD. | *"Our 2D MapLibre planner routes around >20° hazards and sends the path straight to a 3D helmet HUD."* | MUST-02 / MUST-05 / MUST-09 |
| **12–22 s** | Walk along the 3D route: highlight HUD readouts (distance, slope class, next stop, illustrative O₂ placeholder). Click a **lake-sediment mudstone stop** (with Curiosity POV still) and the **Altadena boxwork bonus stop**. | *"We target ancient lake mudstones for biosignatures—plus Curiosity's boxwork ridges as a bonus stop."* | MUST-10 / SHOULD-03 |
| **22–27 s** | Zoom on the HUD **Radiation Dose card** (`0.64 ± 0.12 mSv/day` RAD baseline × duration) and the **DONKI WSA-Enlil** Mars space-weather banner, plus THEMIS/REMS toggle. | *"Real Curiosity RAD dose budgets, REMS weather, and cached DONKI solar-storm alerts keep the EVA timed safely."* | SHOULD-01 / SHOULD-02 / SHOULD-04 |
| **27–30 s** | End card over the 3D HUD showing **Martian Mappers — NASA Space Apps 2026**, data credits (HiRISE, Mars Trek, Curiosity MSL, DONKI), and honesty note (lunar slope stand-in, DTM tilt offset, placeholder O₂). | *"Martian Mappers — built from NASA PDS, Mars Trek, Curiosity & DONKI data. Safe walks on Mars."* | All MUST + SHOULD |

---

## Recording & Export Checklist

- [ ] Recorded with `?demo=1` enabled (no network spinners or failed tile requests).
- [ ] Resolution: `1920×1080` (16:9), 30 or 60 fps, `.mp4` (H.264).
- [ ] Duration verified in file properties: **≤ 30.0 seconds** (target 28–29 s).
- [ ] Every spoken/narrative point appears as clear, high-contrast **English subtitles** safe from the bottom player bar.
- [ ] Checked frame-by-frame: **no** under-18 faces, reflections, voices, full names, emails, or school names anywhere in the browser tabs or OS taskbar.
- [ ] SI/AI watermark or disclosure note included if any AI-generated graphic is shown (we use real NASA data + code-rendered UI, and disclose AI coding assistance in `docs/AI_USE.md`).
- [ ] Uploaded to a public link and tested in an **Incognito / Private browser window** with no login.
