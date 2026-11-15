# GitHub workflow (beginner guide)

This team is new to GitHub. Follow this page exactly during the 48 hours. The repo is **public**: [mynahtrium/nasathingamajig](https://github.com/mynahtrium/nasathingamajig). Never commit secrets or personal data, and do not connect Vercel or other hosting.

If you have never used Git, pair with a teammate for the first clone.

## 1. Get an account and access

1. Create a GitHub account if you do not have one (use an email you can open during the event).
2. Ask a repo admin to add you as a collaborator on this repo.
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

## 3. Branches

Use a short branch for each piece of work and merge it into `main` when it works. Name it however the team agrees (for example `frontend/context-menu`, `fix/hud-slope`). Small direct commits to `main` are fine when the team agrees.

```bash
git checkout main
git pull
git checkout -b topic/short-name
```

`short-name` is a few words, no spaces. One topic per branch.

## 4. Talk before editing the same file

Agree with teammates who is changing which file. Conflicts happen when two people change the same lines.

## 5. Pull `main` often (before you start work, and before you open a PR)

Beginners should **merge** `main` into the branch (not rebase), so history stays simple:

```bash
git checkout main
git pull
git checkout topic/short-name
git merge main
```

If Git reports conflicts, see §8. Do not keep a branch alive for 12 hours without merging `main`.

## 6. Commit, push, and open a small PR

```bash
git status
git add path/to/your/file
git commit -m "A short sentence of what this change does"
git push -u origin topic/short-name
```

Then merge into `main` yourself, or open a pull request if you want someone to look first. A good PR text says what changed, how to check it, whether any **contract** field changed, and "I did not commit `.env` or `data/raw/`".

## 7. When you are stuck, or Git looks scary

- Read the error slowly. Copy it into a message to a teammate **without** pasting secrets.
- `git status` and `git log --oneline -5` are safe and useful.
- Do not run `git push --force` on `main`. Do not run `git checkout --` on files you still need unless you intend to throw away work.

### Merge conflicts (step by step)

A conflict means you and `main` both changed the same lines.

1. After `git merge main`, Git lists unmerged files.
2. Open each file. Look for `<<<<<<<`, `=======`, `>>>>>>>`. Keep the correct final text (often *both* changes, combined). Delete the marker lines.
3. `git add` those files, then `git commit` (Git may already offer a merge message).
4. If you feel lost, stop. Zip nothing; call a teammate. Do not delete the `.git` folder.

## 8. Emergency rollback (revert, never force-push `main`)

If a bad commit is already on `main`:

1. Tell the team. Stop merging other PRs for a few minutes.
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

## 9. Secrets and bulky files

Never commit `.env`, API keys, `data/raw/`, or large `.tif` / `.IMG` / JP2 files. The NASA key is only `NASA_API_KEY` in a local `.env`. If a key might have been pushed, tell the team immediately, assume it is leaked, and request a new key.

## 10. Cheat sheet

```bash
git checkout main && git pull
git checkout -b topic/short-name
# work, then check: node --test web/tests/*.test.mjs
git add PATH
git commit -m "A short sentence of what this change does"
git checkout main && git pull && git checkout topic/short-name && git merge main
git push -u origin topic/short-name
# merge into main (or open a PR), then start the next branch from a fresh main
```

Optional commit reminder, once per clone: `git config commit.template .gitmessage`
