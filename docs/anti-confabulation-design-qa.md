# Anti-Confabulation Design — Q&A

Ported onto this sandbox (`2026.10.1-rc.2`) on 2026-11-05. The guard now runs in `validateAddMcpServer` and in `dispatch` before an approval card, and again in `applyAddMcpServer`. Placeholders `onecli-managed` and `gateway-managed` are not treated as raw secrets. Host callers stay exempt.

> Design-rationale notes captured during the anti-confabulation planning session
> (branch `feature/anti-confabulation`). Context: NanoClaw agents (Saul, Victor)
> repeatedly invented mechanisms — a "batch password reset", "port 587 is
> required", "465 is firewall-blocked", "the restart changed network policy" —
> and even fabricated credentials. The plan has four layers: **(1)** ground-truth
> diagnostic tools, **(2)** a "measure before you claim / never fabricate"
> container skill, **(3)** operator-managed credential/config lockdown, and
> **(4)** verified-status injection + compaction hygiene.

---

## Q1. Layer 3 addresses the Migadu/email confabulation specifically. What about other cases where an agent starts making stuff up — do we need a new Layer 3 for each case?

**No — you don't write a new Layer 3 per topic.**

**Layer 3 is the odd one out.** It is not an anti-confabulation mechanism; it's a
*damage-containment* guard on one high-consequence write path (credential/config
changes). It accepts that an agent *might* confabulate and simply ensures it
cannot do harm in that specific spot.

**The general fix is Layers 1, 2, and 4 — those are topic-agnostic:**

- **Layer 1 (diagnostic tools)** — ground truth the agent can measure, for
  *anything*, not just email.
- **Layer 2 (skill)** — "measure before you claim, never invent facts or
  credentials." This governs *all* of the agent's reasoning, on every topic.
- **Layer 4 (status + compaction hygiene)** — keeps the agent anchored to reality
  regardless of subject.

Those three reduce confabulation broadly; you do not duplicate them per case.

**When do you add another Layer-3-style guard?** Only where a confabulated
*action* causes real, hard-to-reverse damage — a short list: writing secrets,
deleting data, spending money, sending external communications, or config that
breaks the system. Everywhere else (an agent merely *saying* something wrong in
chat), Layers 1/2/4 catch it and no guard is needed.

**And it's one extensible policy, not N layers.** `protected-config.ts` is built
to grow — the same module holds the set of "actions agents can't self-authorize."
When a new dangerous path appears, you add an entry there, not a new layer.

**Mental model:** Layers 1/2/4 prevent confabulation everywhere (cheap, general);
Layer 3 is a small, growing lockdown list for the few actions where being wrong is
expensive. The email guard is just the first entry.

---

## Q2. Can we create a skill or a tool I can call to verify an agent's response when I suspect it is confabulating / hallucinating?

**Yes — and it's the highest-value piece for the operator, since the operator is
the one catching these in real time.** It is the operator-side companion to the
plan: instead of trusting the agent's chat, you run one command that measures
ground truth and returns a verdict. It codifies the standing rule — *verify
against logs and the DB, not the agent chat.*

Two pieces that work together:

### 1. A tool — `scripts/nanoclaw-doctor` (deterministic, read-only)

Dumps the *verifiable* state that agent claims tend to be about:

- **Email/network:** per-mailbox port + auth status; SMTP/IMAP reachability **from
  host and from container** (the exact host-vs-container test that debunked "the
  restart firewalled SMTP").
- **Config drift:** DB `container_configs` vs the materialized `container.json`.
- **"The system changed X":** recent `git log`/diff, `updated_at` timestamps, file
  mtimes.
- **State:** running containers, image tags, recent error-log lines.
- **Reality checks:** actual egress/firewall rules (there are none), pending
  approvals.

This doubles as **Layer 1**: a container-safe subset becomes the agents'
`email-doctor`; the full version is the operator's.

### 2. A skill — `/fact-check` (invoked by the operator in Claude Code)

You paste the agent's claim; it classifies the claim type, runs the matching
`nanoclaw-doctor` checks, and returns a labeled verdict:

> **Claim:** "Port 465 is firewall-blocked in the containers."
> **Measured:** container → `smtp.migadu.com:465` TLS handshake OK; host equally
> reachable; zero egress rules in spawn code.
> **Verdict: CONTRADICTED — confabulation.**

Verdicts are `CONFIRMED` / `CONTRADICTED` / `UNVERIFIABLE`, each with the raw
evidence, so the operator never has to take the agent's word *or* Claude's.

**Claim → what to measure** (the refutation playbook from the incident):

| Claim type | What to measure |
|-----------|-----------------|
| network / firewall / port | connectivity tests (host + container), egress rules |
| config (port, password, MCP server) | DB config vs materialized `container.json`, git history |
| "it reset / changed X" | `git log`/diff, `updated_at`, file mtimes |
| credential / auth | live login test (e.g. SMTP/IMAP auth) |
| state ("X is running / broken") | `docker ps`, logs, DB status |
| capability ("X is impossible / there is no Y") | check the actual code/config |

Both pieces belong on the `feature/anti-confabulation` branch (general, useful to
any install). Build order: `nanoclaw-doctor` first (deterministic facts), then the
`/fact-check` skill on top. Open scoping choice: whether `/fact-check` is
read-only (report the verdict — safest) or also offers to act (e.g., surface the
confabulated approval cards for rejection in the same step).

---

## Implementation record

All work below lives on branch `feature/anti-confabulation`, developed in a git
worktree (`../nanoclaw-anticonfab`) so the live `main` checkout kept running
untouched. Nothing is merged or deployed until deliberately promoted; the running
host and containers are unaffected.

### Layer 3 — operator-managed credential/config lockdown (built)

The strongest, cheapest guarantee: a confabulating agent physically cannot change
email/credential config, so the operator can't accidentally approve a bad request
either (the request is refused before an approval card is created). Operator/host
callers are exempt.

- **`src/modules/self-mod/protected-config.ts`** (new) — one shared guard,
  `protectedMcpViolation({ name, env })`, returning a rejection reason or `null`.
  It blocks two things for agents:
  1. **Protected server by name** — `PROTECTED_MCP_SERVERS = { 'email-imap' }`
     (extensible). Catches the 587 port-drift and any add/remove of the email
     server, even with a placeholder password.
  2. **Raw secrets in env** — any `*PASSWORD/TOKEN/API_KEY/…` key with a real
     value (not empty, and not the `onecli-managed` or `gateway-managed`
     placeholder), on any server. Catches a fabricated password. Handles env as an object or
     the JSON-string form `ncl --env` sends.
- **`src/cli/dispatch.ts`** (edited) — guards the ncl path
  (`groups-config-add-mcp-server` / `-remove-mcp-server`) for `ctx.caller === 'agent'`,
  before the approval gate.
- **`src/modules/self-mod/request.ts`** (edited) — guards the self-mod MCP-tool
  path (`handleAddMcpServer`) before its approval card.
- **`src/modules/self-mod/protected-config.test.ts`** (new) — 10 cases, all
  passing: blocks the exact 587 drift, email-imap add/remove (case-insensitive),
  fabricated raw credentials incl. the JSON-string form; **allows** legitimate
  non-credential self-mod and the `onecli-managed` placeholder.

*Verification:* `pnpm run build` (tsc) clean; `vitest` 10/10.

### Layer 1 — ground-truth diagnostic (built)

- **`container/skills/ground-truth/selfcheck.mjs`** (new, Node) — credential-free
  TCP/TLS reachability check the agent runs instead of guessing. (Originally
  written in Python; reimplemented in Node during deployment because the agent
  container has no `python3` — an end-to-end `docker exec` test caught it.)
  `selfcheck.mjs` (DNS + Migadu email endpoints) / `net HOST PORT` / `email`.
  Two design points that make it trustworthy as *ground truth*:
  - **Unverified TLS handshake** — it tests *reachability*, not cert trust. A local
    CA gap must never make it falsely report a reachable port as "blocked" (that
    would be the very confabulation it exists to prevent).
  - **IPv4-first** — outbound IPv6 SMTP is commonly filtered; trying IPv6 first
    produced a false "465 timeout". It now tries IPv4 first and reports the IP that
    answered.

*Verification:* runs, exit 0, all Migadu endpoints PASS with the answering IPv4.

### Layer 2 — "measure before you claim" skill (built)

- **`container/skills/ground-truth/instructions.md`** (new) — the always-on rules.
  Container skills' `instructions.md` fragments are composed into every agent's
  CLAUDE.md by `claude-md-compose.ts`, so these are in context on every turn:
  measure before claiming; run `selfcheck.mjs` before any reachability claim; never
  invent/guess credentials, passwords, or ports; label `[measured]` vs
  `[hypothesis]`; email/credentials are operator-managed (don't submit config
  changes — they're refused by Layer 3); quote the verbatim error, don't invent a
  cause.
- **`container/skills/ground-truth/SKILL.md`** (new) — the invokable definition:
  how to run the tool, an ordered diagnosis procedure, the hard rules, and a worked
  before/after example (the exact "465 is firewall-blocked" confabulation vs the
  measured refutation).

### Layer 4 — status snapshot + on-demand context reset (built)

- **`scripts/agent-grounding.py`** (new, host-side):
  - `snapshot` — writes a VERIFIED status to `data/agent-grounding.json`: email
    endpoint reachability (IPv4-first, same logic as `selfcheck`) + per-agent SMTP
    port drift (DB `container_configs` vs materialized `container.json`) + UTC
    timestamp. Read-only. Intended to be scheduled so a recent measured status
    always exists to check claims against.
  - `reset --group <id>` — clears a confabulating agent's continuation/compaction
    state keys (`continuation:claude`, `compaction_warning`, `turn_in_progress`
    from the session `outbound.db` — the same keys the weekly `session-maintenance.py`
    clears), forcing a fresh context on next wake. Stop the container first.

*Verification:* `snapshot` ran against the live install — SMTP 465/587 + IMAP 993
all reachable, all four email agents `db_port 465 == materialized_port 465`
(`consistent: true`), confirming the 587 drift is fully resolved.

### File manifest

```
new:   src/modules/self-mod/protected-config.ts
new:   src/modules/self-mod/protected-config.test.ts
edit:  src/cli/dispatch.ts
edit:  src/modules/self-mod/request.ts
new:   container/skills/ground-truth/selfcheck.mjs
new:   container/skills/ground-truth/instructions.md
new:   container/skills/ground-truth/SKILL.md
new:   scripts/agent-grounding.py
new:   scripts/nanoclaw-doctor.py
new:   .claude/skills/fact-check/SKILL.md
new:   docs/anti-confabulation-design-qa.md
```

### Deployment notes (per layer, when merging to main)

- **Layer 3** (host TS) → merge + restart the host service; affects all agents at
  once. Well-tested, low risk.
- **Layers 1+2** (mounted skill) → auto-loads for `skills: 'all'` groups; needs a
  CLAUDE.md recompose (for `instructions.md`) + a container respawn. Canary on one
  agent first.
- **Layer 4** (host scripts) → no restart; schedule `snapshot` (e.g. launchd), run
  `reset` on demand.

### Operator verification tooling (built)

Built after Layers 1/2/4, per the Q2 plan. Both are **read-only** (the operator
chose report-only over act-capable), so a fact-check never rejects cards, rotates
credentials, or restarts anything — it reports, and the operator acts separately.

- **`scripts/nanoclaw-doctor.py`** (new, host-side) — read-only ground-truth
  snapshot across the categories agents confabulate about, one subcommand each:
  - `net HOST PORT` — reachability from **both host and an agent container** (the
    decisive test: if the host is equally blocked it is not a container firewall).
  - `email` — endpoint reachability (host + container) + per-mailbox config
    (SMTP port, password-set) + DB-vs-materialized drift.
  - `config` — DB `container_configs` vs materialized `container.json` drift.
  - `containers` — running agent containers + image tags.
  - `git [FILE]` — recent commits + working-tree changes (refutes "the system
    reset/changed X"); with a file, its history + mtime.
  - `egress` — greps the spawn path for firewall/egress rules (there are none).
  - `all` — the common checks. Never mutates.
- **`.claude/skills/fact-check/SKILL.md`** (new, operator skill) — invoke
  `/fact-check` with a suspected claim; it restates the claim, classifies it,
  runs the matching `nanoclaw-doctor` check(s), and returns a
  `CONFIRMED` / `CONTRADICTED` / `UNVERIFIABLE` verdict with quoted evidence,
  plus a suggested (operator-executed) next step. Read-only by design; it also
  treats any agent-supplied credential value as an automatic red flag and never
  echoes it.

*Verification:* `nanoclaw-doctor net smtp.migadu.com 465` → host + container both
`PASS`; `egress` → `NONE`. These are the exact refutations of this incident's
"465 is firewall-blocked" and "the restart firewalled the network" confabulations.

### Deployment order (nothing merged/deployed yet)

Promote per layer, watching `logs/nanoclaw.error.log` between each:

1. **Layer 3** (host TS) — merge + restart the host service. Well-tested; affects
   all agents at once.
2. **Layers 1+2** (mounted `ground-truth` skill) — auto-loads for `skills: 'all'`
   groups; needs a CLAUDE.md recompose (for `instructions.md`) + a container
   respawn. Canary on one agent first.
3. **Layer 4 + operator tooling** (`agent-grounding.py`, `nanoclaw-doctor.py`,
   `/fact-check`) — host scripts + operator skill; no restart. Optionally schedule
   `agent-grounding.py snapshot` via launchd.
