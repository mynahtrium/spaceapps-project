# GitHub workflow (beginner guide)

This team is new to GitHub. Follow this page exactly during the 48 hours. The repo is **private**: [mynahtrium/nasathingamajig](https://github.com/mynahtrium/nasathingamajig). Do not make it public and do not connect Vercel or other hosting.

If you have never used Git, pair with a tester for the first clone and the practice pull request (before 14 November). **Do not write application code before 14 November 2026.** The practice PR is docs only.

## 1. Get an account and access

1. Create a GitHub account if you do not have one (use an email you can open during the event).
2. Ask a repo admin to add you as a collaborator on this private repo.
3. Install [Git](https://git-scm.com/downloads). Optional: the [GitHub CLI](https://cli.github.com/).
4. Set your name and email (use the email on your GitHub account):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

5. On GitHub, add an SSH key or use HTTPS login (`gh auth login` if you use the CLI).

## 2. Clone the repo (once)

```bash
git clone https://github.com/mynahtrium/nasathingamajig.git
cd nasathingamajig
git status
```

You should be on `main`. Do not invent a second copy of the project on your Desktop and type over it; always work inside this clone.

## 3. Never code on `main`

`main` is the shared, working demo. You only update it through **reviewed pull requests** (or an admin hotfix that still goes through a PR if at all possible).

```bash
git checkout main
git pull
git checkout -b ROLE/short-topic
```

### Branch names

| Role | Prefix | Example |
|---|---|---|
| Backend 1 | `backend-1/` | `backend-1/slope-preview` |
| Backend 2 | `backend-2/` | `backend-2/first-route` |
| Backend 3 | `backend-3/` | `backend-3/donki-cache` |
| Frontend 1 | `frontend-1/` | `frontend-1/hud-o2` |
| Tester 1 | `tester-1/` | `tester-1/must-checklist` |
| Tester 2 | `tester-2/` | `tester-2/video-beats` |

`short-topic` is a few words, no spaces. One topic per branch. Prefer many small PRs over one giant PR.

## 4. Stay in your folders

Folder ownership is in [ROADMAP.md](../ROADMAP.md) §2 and in your [role sheet](./roles/). If you need a change in someone else's file, open a GitHub issue or ask them to make a PR. Testers review; they do not quietly rewrite `web/` or `pipeline/`.

## 5. Pull `main` often (before you start work, and before you open a PR)

Beginners should **merge** `main` into the branch (not rebase), so history stays simple:

```bash
git checkout main
git pull
git checkout ROLE/short-topic
git merge main
```

If Git reports conflicts, see §8. Do not keep a branch alive for 12 hours without merging `main`.

## 6. Commit, push, and open a small PR

```bash
git status
git add path/to/your/file
git commit -m "A short sentence of what this change does"
git push -u origin ROLE/short-topic
```

Then open a pull request on GitHub: from your branch into `main`. In the PR text include:

- What you changed, and which folder
- How a tester can check it (commands or clicks)
- Whether any **contract** field changed (say so clearly)
- Screenshots for UI work
- "I did not commit `.env` or `data/raw/`"

Ask **Tester 1** (backends / docs / AI log) or **Tester 2** (frontend / demo) for review. Either tester may review if the other is busy. **Do not merge your own PR.** Wait for one tester approval.

Keep PRs small enough to review in 10 minutes. If a reviewer asks for changes, push more commits to the **same branch**; the PR updates itself.

## 7. Practice PR (before 14 November)

1. Create a branch `ROLE/practice-roster`.
2. Add your GitHub username next to your role in [docs/team/ROSTER.md](./team/ROSTER.md).
3. Open a PR. A tester approves and someone with access merges it.
4. After it is merged: `git checkout main && git pull`.

That is the whole loop you will use during the hackathon.

## 8. When you are stuck, or Git looks scary

- Read the error slowly. Copy it into a message to a tester **without** pasting secrets.
- `git status` and `git log --oneline -5` are safe and useful.
- Do not run `git push --force` on `main`. Do not run `git checkout --` on files you still need unless you intend to throw away work.
- If you edited the wrong folder, do not "just finish it." Stop and tell the owner.

### Merge conflicts (step by step)

A conflict means you and `main` both changed the same lines. Because of folder ownership this should be rare.

1. After `git merge main`, Git lists unmerged files.
2. Open each file. Look for `<<<<<<<`, `=======`, `>>>>>>>`. Keep the correct final text (often *both* changes, combined). Delete the marker lines.
3. `git add` those files, then `git commit` (Git may already offer a merge message).
4. If you feel lost, stop. Zip nothing; call a tester. Do not delete the `.git` folder.

## 9. Emergency rollback (revert, never force-push `main`)

If a bad commit is already on `main`:

1. Tell the testers. Stop merging other PRs for a few minutes.
2. Someone with access creates a revert:

```bash
git checkout main
git pull
git log --oneline -10
git revert COMMIT_SHA
git push
```

`git revert` adds a new commit that undoes the change. It does **not** rewrite history. That is what we want.

- Do **not** `git reset --hard` on `main` and force-push.
- Do **not** `git push --force` to `main`.
- If the bad PR also contains good work, revert first, then cherry-pick or redo the good part on a new branch.

If the bad change is only on your branch and was never merged, you may abandon the branch and start a new one from `main`.

## 10. Secrets and bulky files

Never commit `.env`, API keys, `data/raw/`, or large `.tif` / `.IMG` / JP2 files. The NASA key is only `NASA_API_KEY` in a local `.env`. If a key might have been pushed, tell a tester immediately, assume it is leaked, and request a new key. Testers will reject PRs that contain secrets.

## 11. Day-of-event cheat sheet

```bash
git checkout main && git pull
git checkout -b ROLE/short-topic
# ...do work only in your folders...
git add PATH && git commit -m "MESSAGE"
git checkout main && git pull && git checkout ROLE/short-topic && git merge main
git push -u origin ROLE/short-topic
# open a PR, wait for a tester, then start the next small branch from a fresh main
```

More detail on timing and handoffs: [ROADMAP.md](../ROADMAP.md). Role prompts and checklists: [docs/roles/](./roles/).
