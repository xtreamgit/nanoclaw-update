---
name: fact-check
description: >-
  Verify a NanoClaw agent's claim against measured ground truth when you suspect
  it is confabulating or hallucinating. Use when the operator says "fact-check",
  "verify the agent", "is that true", "did the system really X", "the agent says
  Y — check it", or pastes an agent's explanation about ports, networking,
  firewalls, config, credentials, container state, or "what changed". Runs the
  read-only nanoclaw-doctor measurements and returns a CONFIRMED / CONTRADICTED /
  UNVERIFIABLE verdict with evidence. READ-ONLY — never changes any state.
---

# /fact-check — verify an agent claim against ground truth

Agents (especially long-running ones with compacted context) produce confident,
plausible, and wrong explanations — "a batch reset changed the passwords", "port
465 is firewall-blocked", "the restart changed the network policy", or fabricated
credentials. Your job here is to **measure, then rule**, and never to take the
agent's word (or your own memory) as fact.

This skill is **read-only**. Report the verdict; do not reject approval cards,
rotate anything, or restart containers as part of a fact-check. Recommend the
operator's next step, but let them take it.

## Procedure

1. **Restate the claim precisely.** Quote the agent's assertion in one line. If
   the operator pasted a chat log, extract the specific falsifiable claim(s).

2. **Classify the claim** and run the matching `nanoclaw-doctor` check(s). The tool
   is at `scripts/nanoclaw-doctor.py` (add `NANOCLAW_DIR=<install root>` if you run
   it from a worktree):

   | Claim is about… | Run |
   |-----------------|-----|
   | a port/host being blocked/unreachable, firewall, network policy | `nanoclaw-doctor.py net <host> <port>` (host **and** container) |
   | email sending/receiving, SMTP/IMAP, "wrong port" | `nanoclaw-doctor.py email` |
   | config being wrong / a port or setting changed | `nanoclaw-doctor.py config` |
   | "the system/restart/update reset or changed X" | `nanoclaw-doctor.py git [file]` |
   | something running/crashed/broken | `nanoclaw-doctor.py containers` |
   | "there is a firewall / egress rule / network lockdown" | `nanoclaw-doctor.py egress` |
   | a credential value the agent supplied | see **Credentials** below |
   | broad / unsure | `nanoclaw-doctor.py all` |

   When a claim contrasts host vs container (e.g. "blocked *in the containers*"),
   the `net` category's host-vs-container comparison is decisive: if the host is
   equally affected, it is not a container-level cause.

3. **Compare** the measured output to the claim and rule:
   - **CONTRADICTED** — the measurement disproves the claim (confabulation).
   - **CONFIRMED** — the measurement supports the claim.
   - **UNVERIFIABLE** — nothing measurable settles it; say so plainly rather than
     guess. Do not upgrade an UNVERIFIABLE to a verdict by reasoning from priors.

4. **Report** in this shape:

   > **Claim:** "<verbatim>"
   > **Measured:** <the key lines from nanoclaw-doctor, quoted>
   > **Verdict: CONTRADICTED** — <one sentence tying evidence to claim>
   > **Suggested next step (operator's call):** <e.g. reject the pending card; or
   > `agent-grounding.py reset --group <id>` to clear the agent's drifted context>

## Credentials

Never confirm or reproduce a credential value. If an agent supplied a password,
API key, or token, treat that alone as a red flag — agents must never originate
secrets (Layer 3 refuses agent-submitted credential config). Verdict: CONTRADICTED
(fabricated credential); do not echo the value. Recommend the operator manage it
through the credential gateway.

## Guardrails

- Quote real tool output; never paraphrase a measurement into a stronger claim.
- If `nanoclaw-doctor` itself errors (e.g. docker down), report that as a tool
  limitation and mark the relevant part UNVERIFIABLE — do not fill the gap.
- Stay read-only. Any state change is the operator's separate, explicit action.

## Example

> **Claim:** "SMTP is firewall-blocked in the containers; the restart changed the
> network policy."
> **Ran:** `nanoclaw-doctor.py net smtp.migadu.com 465` and `… egress`
> **Measured:**
> `host  target smtp.migadu.com:465 [PASS] reachable` /
> `container target smtp.migadu.com:465 [PASS] OPEN` /
> `[egress] NONE — containers use the default bridge, no egress/firewall rules`
> **Verdict: CONTRADICTED** — the container reaches 465 and the spawn path has no
> firewall rules; host and container agree, so there is no container network policy
> to have changed.
