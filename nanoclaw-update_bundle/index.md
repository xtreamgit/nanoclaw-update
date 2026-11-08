---
okf_version: "0.2"
---

# NanoClaw update sandbox brief

Read this first in the `nanoclaw-update` Cursor window. This bundle is only context for the upgrade sandbox; it is not the live install.

* [Brief](brief.md) - live vs update paths, rules, GCE status, versions
* [Catch-up plan](plan/catch-up.md) - sandbox-only replay of the live 2.0.64 delta onto upstream 2026.10.1-rc.2
* [Inventory](plan/inventory.md) - upstream gap, excluded `groups/` files, and the anti-confabulation stack now in this clone
* [Saul copy](plan/saul-copy.md) - read-only copy of memory, CLAUDE files, and session databases onto the practice VM
* [Memory migration](plan/memory-migration.md) - legacy CLAUDE files organized into memory/ on the practice VM
* [Saul2](plan/saul2.md) - bring up the accepted update install and open it in Telegram and the OneCLI console
* [OneCLI connections](plan/onecli-connections.md) - reach the practice gateway and compare its app connections with the live Mac gateway
* [Local OneCLI](plan/local-onecli.md) - Develom can host one OneCLI per client and share it across that client's agents
* [Microsoft credentials](plan/microsoft-mail.md) - write one client's Entra app into `~/microsoft-mail.env` on the machine that runs the broker
* [Network diagram](nanoclaw-update-vm-network.pdf) - practice VM, VPC, Mac paths, and what a future Kubernetes move has to replace
