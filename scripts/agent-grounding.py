#!/usr/bin/env python3
"""agent-grounding.py — keep agents anchored to reality (Layer 4).

Confabulation grows when an agent reasons from stale, compacted context instead
of measured fact. This script gives the operator two levers:

  snapshot   Compute a VERIFIED ground-truth status (email endpoint reachability
             + email config port drift + timestamp) and write it to
             data/agent-grounding.json. Read-only. Schedule it (e.g. launchd every
             few minutes) so a recent, measured status always exists to compare an
             agent's claims against — and so the operator/agents read facts, not
             assumptions.

  reset      Force a fresh context for a confabulating agent by clearing its
             continuation/compaction state keys (the same keys the weekly
             session-maintenance job clears). Use when an agent is stuck making
             things up because its context has drifted. Stop the container first,
             then restart it after.

Usage:
  python3 scripts/agent-grounding.py snapshot
  python3 scripts/agent-grounding.py reset --group ag-XXXX [--yes]

Point NANOCLAW_DIR at the install root if running from a worktree.
"""
import argparse
import json
import os
import socket
import sqlite3
import ssl
import sys
import time

REPO = os.environ.get("NANOCLAW_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V2DB = os.path.join(REPO, "data", "v2.db")
SESSDIR = os.path.join(REPO, "data", "v2-sessions")
GROUPS = os.path.join(REPO, "groups")
OUT = os.path.join(REPO, "data", "agent-grounding.json")
# v2 stores the resume token as continuation:<provider>. The other two keys
# are the v1 compaction markers; deleting them is a no-op when they are absent.
CLEAR_EXACT = ["compaction_warning", "turn_in_progress"]
TIMEOUT = 8


def _addresses(host, port):
    """Resolved (family, sockaddr), IPv4 first (avoid IPv6-SMTP-filter false negatives)."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    infos.sort(key=lambda ai: 0 if ai[0] == socket.AF_INET else 1)
    return [(ai[0], ai[4]) for ai in infos]


def reachable(host, port, tls):
    for family, sockaddr in _addresses(host, port):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(TIMEOUT)
                s.connect(sockaddr)
                if tls:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE  # reachability, not trust
                    with ctx.wrap_socket(s, server_hostname=host):
                        pass
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def config_drift():
    """Per email agent: does the DB SMTP port match the materialized container.json?
    A mismatch means the next container spawn will silently change the port."""
    con = sqlite3.connect(f"file:{V2DB}?mode=ro", uri=True)
    rows = con.execute("SELECT agent_group_id, mcp_servers FROM container_configs").fetchall()
    folders = dict(con.execute("SELECT id, folder FROM agent_groups").fetchall())
    con.close()

    out = []
    for gid, mcp in rows:
        email = (json.loads(mcp).get("email-imap") or {})
        env = email.get("env")
        if not env:
            continue
        db_port = env.get("MCP_EMAIL_SERVER_SMTP_PORT")
        mat_port = None
        folder = folders.get(gid)
        if folder:
            cj = os.path.join(GROUPS, folder, "container.json")
            if os.path.exists(cj):
                try:
                    mj = json.load(open(cj))
                    mat_port = ((mj.get("mcpServers") or {}).get("email-imap") or {}).get("env", {}).get(
                        "MCP_EMAIL_SERVER_SMTP_PORT"
                    )
                except Exception:  # noqa: BLE001
                    mat_port = "unreadable"
        out.append(
            {
                "group": gid,
                "address": env.get("MCP_EMAIL_SERVER_EMAIL_ADDRESS", "?"),
                "db_port": db_port,
                "materialized_port": mat_port,
                "consistent": mat_port is None or mat_port == db_port,
            }
        )
    return out


def cmd_snapshot(_args):
    status = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "email_reachable": {
            "smtp.migadu.com:465": reachable("smtp.migadu.com", 465, True),
            "smtp.migadu.com:587": reachable("smtp.migadu.com", 587, False),
            "imap.migadu.com:993": reachable("imap.migadu.com", 993, True),
        },
        "email_config": config_drift(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(status, f, indent=2)
    print(json.dumps(status, indent=2))
    print(f"\nWritten to {OUT}")


def cmd_reset(args):
    gid = args.group
    root = os.path.join(SESSDIR, gid)
    if not os.path.isdir(root):
        sys.exit(f"No sessions for group {gid} under {root}")
    dbs = [os.path.join(root, s, "outbound.db") for s in os.listdir(root)]
    dbs = [d for d in dbs if os.path.exists(d)]
    if not dbs:
        sys.exit("No outbound.db found for that group.")

    print(f"Will clear continuation:* and {CLEAR_EXACT} from {len(dbs)} session(s) of {gid}.")
    print("IMPORTANT: stop the agent's container FIRST, or it may re-write these keys.")
    if not args.yes and input("Type 'yes' to proceed: ").strip().lower() != "yes":
        sys.exit("Aborted.")

    total = 0
    placeholders = ",".join("?" * len(CLEAR_EXACT))
    for d in dbs:
        c = sqlite3.connect(d)
        total += c.execute(
            f"DELETE FROM session_state WHERE key LIKE 'continuation:%' OR key IN ({placeholders})",
            CLEAR_EXACT,
        ).rowcount
        c.commit()
        c.close()
    print(f"Cleared {total} state key(s). Restart the agent for a fresh context:")
    print(f"  ncl groups restart --id {gid}")


def main():
    ap = argparse.ArgumentParser(description="Agent grounding: verified-status snapshot + on-demand context reset.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ps = sub.add_parser("snapshot", help="Write verified ground-truth status to data/agent-grounding.json")
    ps.set_defaults(func=cmd_snapshot)
    pr = sub.add_parser("reset", help="Clear a confabulating agent's continuation/compaction state")
    pr.add_argument("--group", required=True, help="Agent group id")
    pr.add_argument("--yes", action="store_true", help="Skip confirmation")
    pr.set_defaults(func=cmd_reset)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
