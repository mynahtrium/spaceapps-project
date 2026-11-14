# Submission & Rehearsal Checklist (Hours 40–48) — Martian Mappers

**Owner:** Bug tester 2 (Eymen), with Bug tester 1 and the team  
**Official submission window (confirmed from [2026 landing page](https://www.spaceappschallenge.org/2026/)):**
- Where: **Team page → Project tab** on `spaceappschallenge.org`
- Opens: **Saturday 14 November 2026, 09:00** (local event time)
- Closes: **Sunday 15 November 2026, 23:59** (local event time)
- **Target internal deadline:** **Hour 44** (submit early; never wait until the final hour).

---

## 1. Hour 40 Feature Freeze & Demo-Safe Verification

- [ ] **Feature freeze enforced at Hour 40:** No new features, libraries, or unverified stretch code merged to `main` after hour 40.
- [ ] **Stretch gate:** If WebXR (`STRETCH-01`) or paired rover mode (`STRETCH-02`) is unstable, hide or disable it so the default 2D planner + 3D HUD view is 100% solid.
- [ ] **Demo-safe mode (`SHOULD-07` / `SHOULD-08`):**
  - [ ] Open the app with `?demo=1` (or `DEMO_SAFE=1`).
  - [ ] Turn off Wi-Fi / enable DevTools **Offline** network throttling and hard-reload.
  - [ ] Verify with Tester 1 that **zero** external network requests are made (all JSON and previews load from `data/demo/` or local static assets).

---

## 2. Under-18 & Privacy Compliance Check (Mandatory)

- [ ] **No minor likenesses:** Video, screenshots, slides, and repo contain **zero** photos, webcam clips, voices, or likenesses of under-18 team members.
- [ ] **No personal data:** Slides, video credits, and commit messages use **first names or nicknames only** (no surnames, phone numbers, emails, home addresses, school names, or ages).
- [ ] **Guardian & registration rule:** All team members registered online before the event start and accompanied by a parent/legal guardian per the [official terms](https://www.spaceappschallenge.org/legal/).

---

## 3. Demo Video (≤30 s) & 7-Slide Deck Check

*(Provisionally official from the 13 Nov `curl -k` read of the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/); confirm with a cert-valid fetch when available.)*

- [ ] **Video duration:** Strictly **≤ 30 seconds** (aim for 28–29 s; see [video-beats.md](./video-beats.md)).
- [ ] **English subtitles:** Burned-in English captions on every beat of the video.
- [ ] **7-slide presentation ready:** [slides-outline.md](./slides-outline.md) exported to PDF/slides (7 slides total including title and intro) as our companion/backup demo artifact.
- [ ] **Public no-login link verified:**
  - [ ] Video and/or 7-slide link opened in an Incognito browser window on a second device with **no login, password, or permission request**.
- [ ] **Local backup saved:** `.mp4` video and `.pdf` slide deck saved in two local places (not committed to git if bulky).

---

## 4. Scientific Honesty & NASA Data Citations Check

- [ ] **Global Award eligibility:** Project uses and cites multiple official NASA datasets (Mars Trek WMTS, MRO HiRISE DTM & ortho, MSL Curiosity RAD / REMS / waypoints / raw images, CCMC DONKI WSA-Enlil).
- [ ] **Fetch dates listed:** Every dataset in the UI credits and submission page lists its source URL and fetch date (11–14 November 2026).
- [ ] **Four honesty disclosures visible in UI & slides:**
  1. **Gale framing:** Gale / Mount Sharp is a Curiosity rover site, framed as *"if a crew visited where Curiosity studied Mount Sharp."*
  2. **Slope thresholds:** 15° and 20° limits are **lunar EVA stand-ins** (NASA Exploration EVA ConOps / LPSC 2023 #1413).
  3. **DTM vs. rover tilt:** 14 Nov check of 176 waypoints (Sol 4400–5073) did **not** show a systematic under-read (about 5 m: median DTM 9.0°, median rover tilt 8.6°, weak correlation). The 11 Nov four-sol under-read note stays a planning note, not this result. Keep a safety margin. See `data/processed/terrain/tilt-check.json`. DTM slope matches Curiosity waypoint tilt only weakly at ~5 m resolution (`tilt-check.json` medians 9.0° vs. 8.6°, no systematic under-read); keep a safety margin.
  4. **Placeholders & radiation:** Suit O₂ % and walking time are **illustrative placeholders**; radiation dose (`0.64 ± 0.12 mSv/day` × duration) is a **time/shielding budget**, not a spatial map of rocks.

---

## 5. AI / SI-Tools Disclosure Check

- [ ] Tester 1 and authors have rolled all tools and uses into [docs/AI_USE.md](../AI_USE.md).
- [ ] Submission form SI-tools blurb prepared from `docs/AI_USE.md`:
  - States clearly which AI/SI tools were used (Grok Bot, Gemini / Antigravity, Claude, Copilot) and for what (documentation, pipeline scripts, UI code, testing/demo checklists).
  - Confirms AI was **not** used to come up with the challenge idea, and no NASA branding/logos were generated or altered.

---

## 6. Final Upload & Git Tag (Hours 44–48)

- [ ] All submission text on the Space Apps Project tab is written in **English**.
- [ ] Project description, challenge name (*Interplanetary Survival Guide: Martian Map*), NASA data links, repo reference, and public demo link pasted into the **Team page → Project tab** and **saved/submitted before Hour 44**.
- [ ] Create or note the submission commit on `main` (e.g., `git tag demo-submit` or note the exact commit SHA).
- [ ] Do not push risky changes after submission; keep the team on standby until 23:59 Sunday 15 November.
