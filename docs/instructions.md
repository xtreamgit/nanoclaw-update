# Anti-Confabulation Toolkit — How to Use

Practical guide to the anti-confabulation system on branch
`feature/anti-confabulation`. It has two halves:

- **Operator tools/skills** — things *you* run when you suspect an agent is making
  things up, or want to check the real state.
- **Agent-side layers** — things that run automatically inside agent containers to
  keep them honest.

Design rationale and the build record live in
[`anti-confabulation-design-qa.md`](anti-confabulation-design-qa.md).

> Paths below assume you run from the install root. If you run from the worktree,
> prefix host scripts with `NANOCLAW_DIR=/path/to/nanoclaw` so they read the live
> install's `data/` and `groups/`.

---

## Quick reference

| I want to… | Use | Mutates? |
|------------|-----|----------|
| Check whether an agent's claim is true | `/fact-check` skill (in Claude Code) | no |
| Measure real system state myself | `scripts/nanoclaw-doctor.py <category>` | no |
| See a verified status snapshot | `scripts/agent-grounding.py snapshot` | writes a status file only |
| Reset an agent stuck confabulating | `scripts/agent-grounding.py reset --group <id>` | **yes** (clears context) |
| (agents) measure reachability | `node /app/skills/ground-truth/selfcheck.mjs` | no |

---

## Operator tools

### `/fact-check` — verify a suspected confabulation (read-only)

Invoke it in Claude Code when an agent says something you doubt about ports,
networking, firewalls, config, credentials, container state, or "what changed."

```
/fact-check
```

Then paste the agent's claim (or the chat snippet). It will:

1. Restate the specific falsifiable claim.
2. Classify it and run the matching `nanoclaw-doctor` check(s).
3. Return a verdict with quoted evidence:
   - **CONFIRMED** — measurement supports the claim.
   - **CONTRADICTED** — measurement disproves it (a confabulation).
   - **UNVERIFIABLE** — nothing measurable settles it (said plainly, not guessed).
4. Suggest a next step — which **you** carry out. It never rejects approval cards,
   rotates anything, or restarts containers.

It also treats any agent-supplied credential value as an automatic red flag and
will not echo it.

### `nanoclaw-doctor.py` — measure ground truth directly (read-only)

Run any category yourself. Nothing it does changes state.

```bash
python3 scripts/nanoclaw-doctor.py all            # the common checks

python3 scripts/nanoclaw-doctor.py net smtp.migadu.com 465
#   reachability from BOTH host and an agent container.
#   If both agree, the cause is NOT a container firewall.

python3 scripts/nanoclaw-doctor.py email          # SMTP/IMAP reachability + per-mailbox config
python3 scripts/nanoclaw-doctor.py config         # DB vs materialized container.json (port drift)
python3 scripts/nanoclaw-doctor.py containers      # running agent containers + image tags
python3 scripts/nanoclaw-doctor.py git src/container-runner.ts   # recent commits / did a file change
python3 scripts/nanoclaw-doctor.py egress         # are there any firewall/egress rules? (there aren't)
```

Use `net`/`egress` to debunk "X is blocked / the network was firewalled," `config`
to catch silent port drift, and `git` to refute "the system reset/changed X."

### `agent-grounding.py` — status snapshot + on-demand reset

```bash
# Write a VERIFIED status snapshot (email reachability + config drift + timestamp)
# to data/agent-grounding.json. Read-only. Schedule it (launchd) for a fresh
# ground-truth reference.
python3 scripts/agent-grounding.py snapshot

# Reset a confabulating agent's drifted context (clears continuation/compaction
# state so its next wake starts clean). THIS MUTATES.
python3 scripts/agent-grounding.py reset --group ag-1777520861575-n3h33w
```

**Before `reset`:** stop the agent's container first (so it can't re-write the keys
mid-reset), then restart it afterward:

```bash
# stop it (e.g. via ncl), reset, then:
ncl groups restart --id <group-id>
```

Use `reset` when an agent keeps making things up despite the facts — that is the
classic symptom of accumulated/compacted context, and a clean slate fixes it.

---

## Agent-side layers (automatic)

These run for agents; you don't invoke them, but it helps to know what agents now
see and can't do.

### Layer 1 — `selfcheck.mjs` (the agent's own measuring tool)

Mounted at `/app/skills/ground-truth/selfcheck.mjs`. Agents are told to run it before
claiming a port/host is blocked:

```bash
node /app/skills/ground-truth/selfcheck.mjs            # DNS + Migadu endpoints
node /app/skills/ground-truth/selfcheck.mjs net HOST PORT
```

Credential-free TCP/TLS reachability; a completed handshake proves the port is
reachable regardless of local cert trust.

### Layer 2 — the `ground-truth` skill (always-on discipline)

`container/skills/ground-truth/instructions.md` is composed into every agent's
CLAUDE.md, so on every turn the agent is bound to: measure before claiming, run
`selfcheck` before reachability claims, never invent credentials/ports, label
`[measured]` vs `[hypothesis]`, and quote the verbatim error instead of inventing a
cause. `SKILL.md` adds the full procedure and a worked example.

### Layer 3 — credential/config lockdown (hard backstop)

Agents **cannot** add, remove, or modify the `email-imap` (or other
credential-bearing) MCP server, nor paste raw secrets into config — via either the
`ncl groups config …` path or the self-mod tool. Such a request is refused before an
approval card is created, so it never reaches your queue and can't be
accidentally approved. Email and other credentials stay operator-managed,
through the credential gateway.

If an agent reports "my config change was refused," that is Layer 3 working as
intended — the fix is for **you** to make the change, not the agent.

### Layer 4 — grounding (see `agent-grounding.py` above)

The snapshot keeps a recent measured status on hand; `reset` clears an agent that
has drifted.

---

## Common workflows

**An agent gives a suspicious technical explanation**
→ `/fact-check`, paste the claim, read the verdict. If CONTRADICTED, don't act on
the agent's proposed "fix."

**Email looks broken**
→ `python3 scripts/nanoclaw-doctor.py email`. Reachability + per-mailbox config in
one view. Auth itself stays with the operator and the credential gateway.

**Suspect the config drifted (e.g. a port)**
→ `python3 scripts/nanoclaw-doctor.py config`. `DRIFT` means the next container
spawn will change it.

**An agent won't stop confabulating**
→ Stop its container, `scripts/agent-grounding.py reset --group <id>`, restart it.

**"Did the last restart/update change X?"**
→ `python3 scripts/nanoclaw-doctor.py git [path]`. Commits and mtimes don't lie.

---

## Deployment status

As of this writing everything above lives on `feature/anti-confabulation` and is
**not merged or deployed** — the live install is unaffected. Promote per the
deployment order in
[`anti-confabulation-design-qa.md`](anti-confabulation-design-qa.md):
Layer 3 (host restart) → Layers 1+2 (canary one agent) → Layer 4 + operator tooling
(no restart).
