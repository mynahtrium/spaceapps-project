# Loading AGENTS.md into Grok and DeepSeek

[AGENTS.md](../../AGENTS.md) is the **single source of truth** for every coding agent on this repo (Claude, Gemini, Grok, and DeepSeek). Claude Code and Gemini CLI already have short pointers ([CLAUDE.md](../../CLAUDE.md), [GEMINI.md](../../GEMINI.md)). Grok and DeepSeek often start as a blank chat or CLI, so a human should give them AGENTS.md at the **start of every session**.

This page is **generic**. Product UIs change. Exact button names, attachment limits, and whether an official CLI has a "project files" feature are **UNVERIFIED** — if what you see does not match, use the generic method below and do not invent tool features.

## Generic method (use this first)

1. Start a **new** session so old instructions do not linger.
2. Give the agent [AGENTS.md](../../AGENTS.md) before any task: **attach** the file if the composer allows it, or **paste** the full text.
3. If the tool can see the repo (a workspace, `@` file mention, or a folder you opened), ask it to **read** `AGENTS.md` rather than pasting a stale copy.
4. If the context window is tight, AGENTS.md still goes first. Then, if space remains, add your [role sheet](../roles/), [ROADMAP.md](../../ROADMAP.md), [BOARD.md](./BOARD.md), and [docs/team/profiles/](../team/profiles/).
5. Tell the agent, in one short paragraph:
   - Follow AGENTS.md.
   - First session with me: run the onboarding interview before other work; write a profile with first name or nickname only; no phone, email, address, school name, or photo.
   - Pull, read the board, handoffs, latest agent log, and all profiles.
   - No application code before 14 November 2026. No secrets. Keep the repo private.

## Grok

Grok may be used as a web chat, inside X, through an API, or from an editor that offers a Grok model. **UNVERIFIED:** file-attach vs paste limits, and whether a dedicated Grok CLI project-file feature exists on event day.

Practical approach: new chat; attach `AGENTS.md` if the composer accepts files; otherwise paste it. If you are already in Cursor (or another editor) with this repo open, ask Grok to read `AGENTS.md` from the workspace.

## DeepSeek

DeepSeek may be used as a web chat, an API, or via a third-party editor. **UNVERIFIED:** upload limits and any official CLI "project knowledge" convention.

Practical approach: same as above — new session, attach or paste `AGENTS.md` first, or point at the file in the repo if the tool can read the workspace.

## Claude and Gemini (reminder)

Those tools should still **open AGENTS.md**, not stop at `CLAUDE.md` or `GEMINI.md`. The short files only exist to point here.

## After AGENTS.md is loaded

Follow the session checklist in AGENTS.md: board, handoffs, agent log, profiles, claim a task, branch, then work.
