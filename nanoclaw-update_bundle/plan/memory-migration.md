---
type: Report
title: Practice VM memory migration
description: How legacy CLAUDE files and Claude auto-memory were organized into memory/ on nanoclaw-update-vm.
status: awaiting approval
created: 2026-11-06
sources:
  - resource: saul-copy.md
    title: Copy Saul onto the practice VM
---

# Practice VM memory migration

This ran only on `nanoclaw-update-vm`, after the host was stopped. The live Mac install and `nanoclaw-vm` were not changed. No agent was woken, and the 42 paused recurring tasks stayed paused.

Each group now has `memory/` and, where the legacy file contained role or rules, `instructions.prepend.md`. The original `CLAUDE.md`, `CLAUDE.local.md`, and Claude auto-memory directories were renamed into `.memory-migration-staging/` and left there. `CLAUDE.md` was generated boilerplate in every group that had one. `robert` has a database row and no folder on the Mac, so there was nothing to migrate.

Claude auto-memory `.git` directories and `MEMORY.md` indexes stayed in staging. The individual notes were copied into `memory/notes/` with a `type`. No symlinks were found.

Saul (`ag-1777520861575-n3h33w`) is the check: 7 standing-instruction sections, 14 concept files, 82 notes, and his 344 conversation files untouched. His staged `CLAUDE.local.md` is still the backup.

| Group | Instructions | Concepts | Notes |
| --- | --- | --- | --- |
| aleck | 5 | 12 | 18 |
| ana | 4 | 12 | 1 |
| bluedot-travel | 4 | 5 | 0 |
| camille | 4 | 8 | 0 |
| develom-onboard | 1 | 10 | 0 |
| diogo | 4 | 11 | 11 |
| eero | 2 | 12 | 1 |
| frontend-engineer | 1 | 0 | 2 |
| harper | 2 | 11 | 2 |
| javier | 5 | 9 | 2 |
| javier-2 | 3 | 6 | 0 |
| jean-luc | 4 | 12 | 6 |
| jeanne-luke | 1 | 0 | 0 |
| kai | 4 | 9 | 4 |
| kwame | 4 | 6 | 0 |
| ledger | 4 | 3 | 0 |
| main | 4 | 8 | 0 |
| mara | 6 | 16 | 17 |
| morgan | 4 | 11 | 4 |
| motion | 1 | 7 | 0 |
| nadia | 4 | 8 | 0 |
| nia | 3 | 2 | 1 |
| owner-relations | 3 | 6 | 0 |
| priya | 3 | 7 | 0 |
| rami | 3 | 8 | 0 |
| researcher | 3 | 8 | 5 |
| roman | 4 | 11 | 6 |
| saul | 7 | 14 | 82 |
| steve | 3 | 21 | 4 |
| test-agent | 4 | 1 | 0 |
| tomas | 3 | 3 | 0 |
| vera | 4 | 8 | 0 |
| victor | 4 | 10 | 26 |
| viz | 2 | 5 | 1 |
| writer | 2 | 6 | 1 |
| yara | 2 | 5 | 0 |
| yuki | 3 | 2 | 4 |

The practice host is running again. A recall test was not sent, because a turn would use the live vault. Staging stays until you approve deleting those backups. Tasks stay paused.
