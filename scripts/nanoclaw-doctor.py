#!/usr/bin/env python3
"""nanoclaw-doctor — read-only ground-truth snapshot for fact-checking agent claims.

MEASURES the real state of the system so an operator (or the /fact-check skill) can
compare it against what an agent asserted. It NEVER mutates anything.

Categories — each maps to a kind of claim agents tend to confabulate about:

  net HOST PORT   reachability from BOTH the host and an agent container. This is
                  the decisive test: if the host (not containerized) is equally
                  blocked, it is NOT a container firewall/policy.
  email           email endpoint reachability (host + container) + per-mailbox
                  config (SMTP port, password present) + DB-vs-materialized drift.
  config          DB container_configs vs materialized container.json (drift).
  containers      running agent containers + image tags.
  git [FILE]      recent commits + working-tree changes (refutes "the system reset
                  / changed X"); with FILE, that file's recent history + mtime.
  egress          whether the container spawn path imposes any firewall/egress
                  rules (grep of container-runner.ts) — reality check.
  all             run the common checks.

Usage:
  python3 scripts/nanoclaw-doctor.py all
  python3 scripts/nanoclaw-doctor.py net smtp.migadu.com 465
  python3 scripts/nanoclaw-doctor.py git src/container-runner.ts

Point NANOCLAW_DIR at the install root if running from a worktree.
"""
import json
import os
import socket
import ssl
import subprocess
import sys
import time

REPO = os.environ.get("NANOCLAW_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V2DB = os.path.join(REPO, "data", "v2.db")
GROUPS = os.path.join(REPO, "groups")
TIMEOUT = 8
TLS_PORTS = {443, 465, 993, 8443}


# ---- reachability (host) ------------------------------------------------------
def _addresses(host, port):
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    infos.sort(key=lambda ai: 0 if ai[0] == socket.AF_INET else 1)  # IPv4 first
    return [(ai[0], ai[4]) for ai in infos]


def host_reachable(host, port, tls):
    for family, sockaddr in _addresses(host, port):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(TIMEOUT)
                s.connect(sockaddr)
                if tls:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    with ctx.wrap_socket(s, server_hostname=host):
                        pass
                return True, f"reachable ({sockaddr[0]})"
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
    return False, last


# ---- reachability (container) -------------------------------------------------
def agent_image():
    try:
        out = subprocess.run(
            ["docker", "images", "--format", "{{.Repository}}:{{.Tag}}"],
            capture_output=True, text=True, timeout=15,
        ).stdout.splitlines()
    except Exception:  # noqa: BLE001
        return None
    latest = [x for x in out if "nanoclaw-agent" in x and x.endswith(":latest")]
    return latest[0] if latest else None


def container_reachable(host, port):
    img = agent_image()
    if not img:
        return None, "no nanoclaw-agent:latest image found"
    probe = f'timeout {TIMEOUT} bash -c "exec 3<>/dev/tcp/{host}/{port}" 2>/dev/null && echo OPEN || echo BLOCKED'
    try:
        r = subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "bash", img, "-c", probe],
            capture_output=True, text=True, timeout=TIMEOUT + 20,
        )
        out = r.stdout.strip()
        return (out == "OPEN"), f"{out or 'no output'} (image {img})"
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"


def print_reach(label, host, port, tls):
    ok, detail = host_reachable(host, port, tls)
    print(f"  host      {label:14} {host}:{port:<5}  [{'PASS' if ok else 'FAIL'}] {detail}")
    cok, cdetail = container_reachable(host, port)
    tag = "SKIP" if cok is None else ("PASS" if cok else "FAIL")
    print(f"  container {label:14} {host}:{port:<5}  [{tag}] {cdetail}")


# ---- email config -------------------------------------------------------------
def email_config_rows():
    con = __import__("sqlite3").connect(f"file:{V2DB}?mode=ro", uri=True)
    rows = con.execute("SELECT agent_group_id, mcp_servers FROM container_configs").fetchall()
    folders = dict(con.execute("SELECT id, folder FROM agent_groups").fetchall())
    con.close()
    out = []
    for gid, mcp in rows:
        env = (json.loads(mcp).get("email-imap") or {}).get("env")
        if not env:
            continue
        mat = None
        folder = folders.get(gid)
        if folder:
            cj = os.path.join(GROUPS, folder, "container.json")
            if os.path.exists(cj):
                try:
                    mat = ((json.load(open(cj)).get("mcpServers") or {}).get("email-imap") or {}).get(
                        "env", {}
                    ).get("MCP_EMAIL_SERVER_SMTP_PORT")
                except Exception:  # noqa: BLE001
                    mat = "unreadable"
        pw = env.get("MCP_EMAIL_SERVER_PASSWORD", "")
        out.append(
            {
                "group": gid,
                "address": env.get("MCP_EMAIL_SERVER_EMAIL_ADDRESS", "?"),
                "db_port": env.get("MCP_EMAIL_SERVER_SMTP_PORT"),
                "materialized_port": mat,
                "password_set": bool(pw) and pw not in ("onecli-managed", "gateway-managed"),
            }
        )
    return out


# ---- categories ---------------------------------------------------------------
def cat_net(host, port):
    print(f"[net] reachability of {host}:{port} — MEASURED now")
    print_reach("target", host, int(port), tls=(int(port) in TLS_PORTS))
    print("  → If host and container agree, it is NOT a container firewall.")


def cat_email():
    print("[email] endpoint reachability (host + container):")
    print_reach("SMTP implicit", "smtp.migadu.com", 465, True)
    print_reach("SMTP submit", "smtp.migadu.com", 587, False)
    print_reach("IMAP", "imap.migadu.com", 993, True)
    print("\n[email] per-mailbox config (DB vs materialized container.json):")
    for r in email_config_rows():
        drift = "" if (r["materialized_port"] in (None, r["db_port"])) else f"  DRIFT→{r['materialized_port']}"
        print(
            f"  {r['address']:32} port={r['db_port']}  pw_set={r['password_set']}{drift}  [{r['group']}]"
        )


def cat_config():
    print("[config] email-imap DB port vs materialized container.json:")
    any_drift = False
    for r in email_config_rows():
        consistent = r["materialized_port"] in (None, r["db_port"])
        any_drift = any_drift or not consistent
        print(
            f"  {'OK ' if consistent else 'DRIFT'}  {r['address']:32} db={r['db_port']} materialized={r['materialized_port']}"
        )
    print("  → No drift = the running config matches the DB." if not any_drift else "  → DRIFT: next spawn will change the port.")


def cat_containers():
    print("[containers] running agent containers + image tags:")
    try:
        r = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"],
            capture_output=True, text=True, timeout=15,
        )
        lines = [ln for ln in r.stdout.splitlines() if "nanoclaw" in ln]
        print("\n".join("  " + ln for ln in lines) if lines else "  (no nanoclaw containers running)")
    except Exception as e:  # noqa: BLE001
        print(f"  (docker unavailable: {type(e).__name__}: {e})")


def _git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, timeout=15).stdout.strip()


def cat_git(path=None):
    print("[git] recent commits (refutes 'the system reset/changed X'):")
    print("\n".join("  " + ln for ln in _git("log", "--oneline", "-8").splitlines()))
    changes = _git("status", "--short")
    print("\n[git] working-tree changes:")
    print("\n".join("  " + ln for ln in changes.splitlines()) if changes else "  (clean)")
    if path:
        print(f"\n[git] history of {path}:")
        hist = _git("log", "--oneline", "-5", "--", path)
        print("\n".join("  " + ln for ln in hist.splitlines()) if hist else "  (no commits touch it)")
        full = os.path.join(REPO, path)
        if os.path.exists(full):
            mt = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(full)))
            print(f"  file mtime: {mt}")


def cat_egress():
    print("[egress] does the container spawn path impose firewall/egress rules?")
    runner = os.path.join(REPO, "src", "container-runner.ts")
    hits = []
    if os.path.exists(runner):
        for i, line in enumerate(open(runner), 1):
            if any(k in line for k in ("iptables", "NET_ADMIN", "cap-add", "--network ", "egress")):
                hits.append(f"  line {i}: {line.strip()}")
    if hits:
        print("\n".join(hits))
    else:
        print("  NONE — containers use the default bridge, no egress/firewall rules.")
        print("  → 'the restart firewalled the network' has no basis in the spawn code.")


def main():
    args = sys.argv[1:]
    print(f"=== nanoclaw-doctor — read-only ground truth @ {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} ===")
    if not args or args[0] == "all":
        cat_email(); print(); cat_containers(); print(); cat_egress(); print(); cat_git()
    elif args[0] == "net" and len(args) == 3:
        cat_net(args[1], args[2])
    elif args[0] == "email":
        cat_email()
    elif args[0] == "config":
        cat_config()
    elif args[0] == "containers":
        cat_containers()
    elif args[0] == "git":
        cat_git(args[1] if len(args) > 1 else None)
    elif args[0] == "egress":
        cat_egress()
    else:
        print(__doc__); sys.exit(2)
    print("\nAll of the above is MEASURED, read-only ground truth. No state was changed.")


if __name__ == "__main__":
    main()
