---
name: ground-truth
description: >-
  Measure reality before making claims about infrastructure. You MUST use this
  skill whenever you are about to state something about ports, networks,
  firewalls, connectivity, DNS, container/config state, credentials, or "what
  changed" — especially when diagnosing a failure (email not sending, a service
  unreachable, an auth error). Run the reachability check and quote its output
  instead of guessing. Never invent credentials, passwords, or ports.
metadata:
  author: nanoclaw
  version: "1.0.0"
---

# Ground Truth

You are running inside a container and can *measure* the things you would
otherwise be tempted to guess about. Guessing produces confident, plausible, and
wrong explanations (a "firewall change", a "required port 587", a "password
reset"). Measuring produces facts. Always measure.

## The reachability tool

```bash
node /app/skills/ground-truth/selfcheck.mjs            # DNS + Migadu email endpoints
node /app/skills/ground-truth/selfcheck.mjs net HOST PORT   # test one target
node /app/skills/ground-truth/selfcheck.mjs email      # SMTP 465/587 + IMAP 993
```

It performs credential-free TCP/TLS reachability checks and prints `PASS`/`FAIL`
with the real result and the IP that answered. Because it needs no secrets, it is
always safe to run. A completed TLS handshake proves the port is **reachable and
not firewall-blocked** — regardless of whether the certificate verifies locally.

## How to diagnose a failure (do this, in order)

1. **Reproduce and read the exact error.** Copy the verbatim error string.
2. **Measure the relevant thing.** Connectivity claim → run `selfcheck`. "Config
   is wrong" → ask the operator to check `container_configs`; you cannot see it
   reliably from here. "It changed / reset" → you have no evidence of that unless
   a check shows it; do not assert it.
3. **Report facts, labeled.** `[measured] selfcheck: smtp.migadu.com:465 PASS` vs
   `[hypothesis] the send may be failing on auth`. Never blur the two.
4. **Hand off what you cannot fix.** Email/credential config is operator-managed
   (see below). Give the operator the exact error and your measurements.

## Hard rules

- **Never invent, guess, or generate** a credential, password, port, API key, or
  config value. Unknown → say so and ask the operator.
- **Never submit `email-imap` / credential MCP-config changes.** They are refused
  before reaching a human. Do not propose port changes (587 vs 465) — the operator
  manages email with the credential gateway.
- **Never turn a raw error into a confident cause** ("must be the firewall", "the
  restart did it") without a measurement that proves it.

## Worked example

> **Wrong:** "Outbound SMTP is firewall-blocked; the restart changed the network
> policy. We need port 587."
>
> **Right:** run `selfcheck.mjs email` →
> `[PASS] SMTP implicit smtp.migadu.com:465 TLS handshake OK, port reachable`.
> Report: `[measured] 465 is reachable from this container; the send failure is
> not a blocked port. Exact error was: <verbatim>. Handing to operator.`
