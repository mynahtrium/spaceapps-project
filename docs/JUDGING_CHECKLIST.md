# Judging checklist

**UNVERIFIED.** The official NASA Space Apps 2026 judging guide is expected on **13 November 2026**. Until testers complete board task **PRE-06**, treat the categories below as **past-year** headings from the 11 November planning note (impact, creativity, validity, relevance, presentation). Do not claim they are this year's criteria.

After the guide appears, update this table (add, rename, or drop rows) and keep the feature / demo-moment / owner mapping. Related: [ROADMAP.md](../ROADMAP.md), [docs/coordination/BOARD.md](./coordination/BOARD.md) (PRE-06, SUB-01).

| Criterion (past-year, UNVERIFIED) | Feature we can point to | Demo moment (about 2–3 min live / 30 s video) | Owner |
|---|---|---|---|
| Impact | A safe, cited walk for a crew: hazard cost map, a route that avoids blocked slope, dose budget, space-weather banner | Toggle the hazard layer, show the route going around steep / no-data cells, then the dose and DONKI cards | B1, B2, B3, F1 |
| Creativity | 3D first-person helmet HUD fed by a 2D MapLibre planner; optional WebXR as stretch only | "Start EVA" on the planner; the visor takes the same route; four MUST readouts visible | F1 (B2 supplies the route) |
| Validity | Real NASA / PDS / Trek / Curiosity data; tilt check vs rover; honest labels (lunar slope stand-ins, DTM under-reads tilt, O₂ and walk time are placeholders, radiation is a time problem) | Show a stop's source credit; mention one limit out loud; compare a slope number to rover tilt if the check is ready | B1, B3, T1, T2 |
| Relevance | Layered Marswalk map at Gale / Mount Sharp; lake-sediment / habitability goal with boxwork as a bonus stop; aim for 3+ data types from 3+ missions | Pan from CTX / THEMIS context to the locked stops (mudstone, then boxwork bonus) | All; F1 drives the views |
| Presentation | 30-second screen-recording video with captions, slides, plain-language legend, early submission; no under-18 faces or voices | Play the video; live path follows the script in `docs/demo/` | T2, presenter, F1 |

If the 13 November guide uses different words, this table must change to match it. Selling points already noted in the planning note (still not official criteria): uses ≥3 data types; checked against real rover data; safety first; works on a tablet; a clear route.

## Status 2026-11-13

A partial pass of board tasks **PRE-05** and **PRE-06** was attempted on 13 November 2026. The official challenge [Details](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) and [Resources](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) tabs, and the 2026 judging guide, could **not** be read: the challenge page failed with a certificate error on HTTPS and HTTP 500. This checklist therefore stays **UNVERIFIED**. PRE-05 and PRE-06 remain `todo` on the [board](./coordination/BOARD.md).

**What did load from official pages (not judging criteria):**

- Submission window, from the [2026 landing page](https://www.spaceappschallenge.org/2026/): project submission is on the Team page's Project tab; it opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time**. See [ROADMAP.md](../ROADMAP.md).
- Under-18 guardian and register-before-start rules, from the [official terms](https://www.spaceappschallenge.org/legal/) (updated 7 August 2026). See [ROADMAP.md](../ROADMAP.md).

**Unconfirmed criterion names** (search snippets of 2026 local-event pages only; not a substitute for the official guide; full descriptions and any weights were not visible):

- Influence, Creativity, Validity, Relevance, Presentation — seen in snippets for [Isa Town](https://www.spaceappschallenge.org/2026/local-events/isa-town/), [Ras Al Khaimah](https://www.spaceappschallenge.org/2026/local-events/ras-al-khaimah/), and [Manama](https://www.spaceappschallenge.org/2026/manama/). The Isa Town and Manama snippets use **Influence**, not "Impact" (the past-year heading in the table above). Do not treat these names as confirmed 2026 criteria.

**Historical only** (not the 2026 rubric): the [Space Apps 2020 Judging and Awards Guide](https://sa-2019.s3.amazonaws.com/media/documents/Space_Apps_2020_Judging_and_Awards_Guide.docx.pdf), linked from the archived [2020 Dubai event page](https://2020.spaceappschallenge.org/locations/dubai/). Do not assume it is this year's guide.

Still **UNVERIFIED** (the 2026 guide was not read, so nothing in the table above is confirmed): official 2026 criterion names, descriptions, and weights; whether "Impact" or "Influence" is the current heading; official video length or format; the SI-tools / AI-use form wording; and the "do not build early" rule (still only a local-event search snippet).

## Status 2026-11-13 afternoon (curl -k and public copies)

A later pass the same day found more content. Existing **UNVERIFIED** markers and the morning Status section above were **not** removed. PRE-05 and PRE-06 remain `todo` until testers accept a certificate-valid reading. Dataset mapping is in [docs/RESOURCES_UNOFFICIAL.md](./RESOURCES_UNOFFICIAL.md). [ROADMAP.md](../ROADMAP.md) and [docs/DECISIONS.md](./DECISIONS.md) were not changed in this pass.

**How official URLs were read:** HTTPS to `www.spaceappschallenge.org` failed certificate verification (`unable to get local issuer certificate`). Plain HTTP returned 500. `curl -k` (TLS certificate not verified) to the official hostname returned HTTP 200 on 13 November 2026. Treat pages loaded that way as provisionally official until a certificate-valid fetch confirms them.

### Official pages that loaded via curl -k (certificate not verified)

- Challenge page [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) — `lastPublishedAt` `2026-11-13T03:46:20.420900Z` (06:46 Europe/Istanbul). Full Details (Background, Objectives, Potential Considerations) and a **NASA Data & Resources** list were in the HTML. **No judging criteria** appear on that page. The same Details text (without the later Resources-tab links) is in the [Wayback snapshot of 1 November 2026, 08:03 UTC](https://web.archive.org/web/20261101080333/https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) (`lastPublishedAt` `2026-10-28T14:18:19.660191Z`). The [8 October 2026 Wayback snapshot](https://web.archive.org/web/20261008052101/https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) is an earlier summary only (`lastPublishedAt` `2026-09-17T14:21:03.079121Z`).
- [Judging & Awards Guide](https://www.spaceappschallenge.org/resources/judging-awards-guide/) — loaded via `curl -k` on 13 November 2026. Criteria are quoted in the next subsection. The slug `…/judging-and-awards-guide/` (with “and”) did not return this content.
- [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/) — loaded via `curl -k` on 13 November 2026. Demo, SI-tools, and timing rules are noted below. They were **not** used to edit the roadmap or decision record.

archive.today timed out. A Google cache request returned a Google Search interstitial, not the challenge page. No 2026 Judging and Awards Guide **PDF** was found on S3 or assets domains.

### Criteria in the official Judging & Awards Guide (curl -k, certificate not verified; 13 November 2026)

Source: [Judging & Awards Guide](https://www.spaceappschallenge.org/resources/judging-awards-guide/). The guide says that at every level of judging, from Local and Universal Events to Executive Judging, a project is evaluated **on a scale of 1-to-5 in each** of the following criteria. No percentage weights were found in the text that loaded. A “Score of 5” description is given for each criterion (not copied in full here). The five names and the lead paragraphs, quoted:

- **Impact** — “This project makes an impact by addressing either a minor or major problem, which influences the quality and quantity of its overall effect. The extent to which it inspires or helps others varies, ranging from a broad audience to a select few.”
- **Creativity** — “This project demonstrates originality and innovation. It introduces a novel concept that has not been attempted before or presents an improvement upon existing ideas in a meaningful way. This project is distinguished by its level of creativity, showcasing a fresh perspective or inventive execution.”
- **Validity** — “This project presents a proposed solution that is grounded in scientific principles and demonstrates technical, functional, or logical feasibility. It is designed to effectively achieve its intended purpose and has the potential to function in real-world applications. The completeness of the proposed solution varies—it may be fully developed or still require significant refinement. Additionally, the usability and user-friendliness of the project influence its practicality and accessibility.”
- **Relevance** — “This project fully and directly addresses the challenge for which it was submitted, demonstrating a strong alignment with the intended objectives. It meaningfully integrates NASA data, utilizing it as a core component of the proposed solution rather than a superficial addition. The depth of engagement with the data enhances the project's credibility and effectiveness.”
- **Presentation** — “The team effectively communicated their project, clearly conveying the challenge, their proposed solution, and its significance. The storytelling was engaging and well-structured, ensuring the audience understood the project's purpose and impact. The clarity, organization, and delivery of their presentation played a key role in making their ideas compelling and clear. Judges evaluate the demo and full project to compute this score.”

The guide also asks teams to pay equal attention to presentation, and notes that Global Nominees are to be announced 3 December 2026 and Global Finalists on 17 December 2026. Because the TLS certificate was not verified, testers should still confirm this page with a valid certificate before treating PRE-06 as done. The past-year table at the top of this file stays marked **UNVERIFIED**.

### Unofficial local-event wording (not a substitute for the guide above)

These are 2026 local-event pages on spaceappschallenge.org, also read with `curl -k` on 13 November 2026. They are **UNOFFICIAL** (local-event content; wording differs from the official guide, including **Influence** vs **Impact**). No percentage weights were found.

- [Isa Town](https://www.spaceappschallenge.org/2026/local-events/isa-town/) (`lastPublishedAt` `2026-11-12T20:52:11.372139Z`): **UNOFFICIAL.** Influence — “How much influence (quality and quantity) can this project have? Does it address a big problem or a little problem? Will it inspire or help many, or a few?” Creativity — “How creative/innovative is the approach? Is the project novel and something that hasn't been attempted before, or is it an incremental improvement on something that already exists?” Validity — “Is the proposed solution scientifically valid? Will it do what it sets out to do? Can it work in the real world?” Relevance — “Is this project responsive to the challenge for which it was submitted? Is it a complete project or does it have a long way to go? Is it technically feasible? How usable or user-friendly is the proposed solution?” Presentation — “How well did the team communicate their project? Were they effective in telling the story of the project, the challenge, the proposed solution, and why is it important?”
- [Manama](https://www.spaceappschallenge.org/2026/local-events/manama/) (`lastPublishedAt` `2026-11-13T11:01:56.514798Z`): **UNOFFICIAL.** Same five names as Isa Town, with slightly shorter Creativity and Relevance sentences (Creativity omits “and something that hasn't been attempted before”; Relevance omits “or does it have a long way to go?”).
- [Ras Al Khaimah](https://www.spaceappschallenge.org/2026/local-events/ras-al-khaimah/) (`lastPublishedAt` `2026-11-11T15:11:13.260928Z`): **UNOFFICIAL.** Shorter paraphrases that use **Impact** (not Influence): “Impact — Does the solution address an important problem? Creativity — How original and innovative is the idea? Validity — Does the solution work and use the data effectively? Relevance — How well does it respond to the selected challenge? Presentation — How clearly is the idea communicated?”

The [2020 Judging and Awards Guide](https://sa-2019.s3.amazonaws.com/media/documents/Space_Apps_2020_Judging_and_Awards_Guide.docx.pdf) remains **historical only**.

### Rules stated in the official Project Submission Guide (curl -k, certificate not verified)

Source: [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/), read 13 November 2026. Recorded here only; the roadmap and decision record were not edited.

- **Submission window:** opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 in the time zone of the team’s Local Event (Universal Event teams use the Team Owner’s local time). This matches the [2026 landing page](https://www.spaceappschallenge.org/2026/) already cited above.
- **Demo format:** a 7-slide presentation (including title and introductory slides) **or** a 30-second or less video. Upload off-site (YouTube, Drive, GitHub, etc.) and give a public link with no password, permission, or registration. The project page does not accept video uploads. If the demo video is not in English, it must include English subtitles. English is required on the project submission page and in linked materials (with that video exception). The majority of judging is based on the project submission; a strong demo can raise the Presentation score.
- **SI tools (AI):** permitted (examples given: machine learning, chatbots, image generation, and large language models) “as a tool to accelerate innovation and creativity.” The guide’s wording is: “SI should not be used to (come up with your idea of how to solve the challenge).” Generated content may not use or modify NASA branding. Teams must clearly indicate where and how SI tools were used: visible watermark on SI-generated images and videos; acknowledge SI generation in descriptive text and metadata for audio, code, and data. The SI form question is “for data-collection purposes only, and your response will not be seen by the judges,” but judges can see watermarks, descriptive text, or metadata in the project.
- **NASA data:** “To be eligible for a Global Award, you must use at least one NASA data or resource.”
- **“Do not build early”:** **not found** in the official Judging or Submission guides that loaded. It remains **UNVERIFIED** as a formal disqualification rule. An **UNOFFICIAL** local-event social post still states it: [Space Apps Amaravati on LinkedIn](https://www.linkedin.com/posts/nasaspaceappsamaravati_spaceapps-spaceappsamaravati-vitap-activity-7521579695469928448-sC0B) (“Do not start building before 14 Nov. Starting early can lead to disqualification.”).
