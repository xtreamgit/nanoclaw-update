---
name: create-bundle
description: "Make sure this repo's OKF bundle folder exists at the git root, named <repo>_bundle. Use when the user says 'create-bundle', '/create-bundle', 'make the okf bundle', 'where is the bundle folder', or asks to add an OKF markdown file for the project."
---

# Create the OKF bundle folder

Every repository keeps its OKF markdown in one folder at the git root. The folder name is the repo slug plus `_bundle` (this repo: `nanoclaw-update_bundle`). The skill checks that folder. If it is missing, it creates it. It does not create a second bundle, and it does not put OKF files anywhere else.

## When to use

- The user says `create-bundle` or `/create-bundle`.
- A project needs a place for OKF bundle markdown and none is at the root yet.
- New OKF notes for this project should be written, and the folder must be confirmed first.

## Workflow

1. Find the git root: `git rev-parse --show-toplevel`. Work there even if the shell is in a subdirectory.
2. Take the repo slug from the `origin` URL: the last path segment, with a trailing `.git` removed. `https://github.com/xtreamgit/nanoclaw-update.git` becomes `nanoclaw-update`. If there is no `origin`, use the git root directory name.
3. The bundle path is `<git-root>/<slug>_bundle`.
4. If that directory exists and `index.md` starts with `okf_version`, stop. Report the path. Do not create another folder and do not rename this one.
5. If that directory is missing, create it with these three files. Use today's date in `YYYY-MM-DD`.

`index.md`:

```markdown
---
okf_version: "0.2"
---

# <slug> bundle

Read this first. OKF notes for this repo live in this folder.

* [Brief](brief.md) - what this repo is
* [Log](log.md) - dated record of what changed
```

`brief.md`:

```markdown
---
type: Brief
title: Context for this repo
description: What this repo is, and where its OKF notes live.
status: current
created: YYYY-MM-DD
---

# Context for this repo

OKF markdown for this project lives in `<slug>_bundle` at the repo root.
```

`log.md`:

```markdown
# Log

## YYYY-MM-DD — Bundle created

Created `<slug>_bundle` at the repo root. Later OKF notes go in this folder. Plans go in `plan/`.
```

6. After the folder exists, put new OKF markdown in it. A plan goes in `plan/<name>.md`, and `index.md` gains one link to it. A dated event goes at the top of `log.md`. Do not write those files outside the bundle.
7. Do not put secrets, tokens, or `.env` contents in the bundle.

## Rules

- One bundle per repo, at the root, named `<slug>_bundle`.
- `index.md` is the entry. It keeps `okf_version: "0.2"`.
- Re-running this skill is safe. An existing bundle is left as it is.
- This skill only adds the bundle folder. It does not install NanoClaw features and does not need `REMOVE.md`.
