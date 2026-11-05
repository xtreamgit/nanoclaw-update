#!/usr/bin/env node
// Ground-truth self-check — MEASURE, don't guess.
//
// Runs inside the agent container (Node/Bun runtime — the container has no
// python). Credential-free TCP/TLS reachability: run this before claiming any
// port or host is blocked. A completed handshake proves the port is reachable,
// regardless of local cert trust. IPv4-first (outbound IPv6 SMTP is commonly
// filtered, which would otherwise look like a false "blocked").
//
//   node selfcheck.mjs                 # DNS + Migadu email endpoints
//   node selfcheck.mjs net HOST PORT   # test one TCP/TLS target
//   node selfcheck.mjs email           # SMTP 465/587 + IMAP 993
//
// Exit 0 if every check passed, 1 otherwise.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';

const TIMEOUT = 8000;
const TLS_PORTS = new Set([443, 465, 993, 8443]);

async function addresses(host) {
  const recs = await dns.lookup(host, { all: true });
  recs.sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1)); // IPv4 first
  return recs;
}

function probe(useTls, ip, port, servername) {
  return new Promise((resolve) => {
    const sock = useTls
      ? tls.connect({ host: ip, port, servername, rejectUnauthorized: false })
      : net.connect({ host: ip, port });
    const done = (ok, detail) => {
      sock.destroy();
      resolve([ok, detail]);
    };
    sock.setTimeout(TIMEOUT);
    sock.once(useTls ? 'secureConnect' : 'connect', () =>
      done(true, useTls ? `TLS ${sock.getProtocol()} handshake OK, reachable (${ip})` : `TCP reachable (${ip})`),
    );
    sock.once('timeout', () => done(false, `timeout (${ip})`));
    sock.once('error', (e) => done(false, `${e.code || e.message} (${ip})`));
  });
}

async function reach(host, port, useTls) {
  let recs;
  try {
    recs = await addresses(host);
  } catch (e) {
    return [false, `DNS ${e.code || e.message}`];
  }
  let last = 'no address resolved';
  for (const { address } of recs) {
    const [ok, detail] = await probe(useTls, address, port, host);
    if (ok) return [true, detail];
    last = detail;
  }
  return [false, last];
}

async function check(label, host, port, useTls) {
  const [ok, detail] = await reach(host, port, useTls);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(16)} ${host}:${String(port).padEnd(5)} ${detail}`);
  return ok;
}

async function dnsCheck(host) {
  try {
    const recs = await addresses(host);
    console.log(`  [PASS] DNS ${host.padEnd(22)} -> ${recs.map((r) => r.address).join(', ')}`);
    return true;
  } catch (e) {
    console.log(`  [FAIL] DNS ${host.padEnd(22)} ${e.code || e.message}`);
    return false;
  }
}

async function emailChecks() {
  console.log('Email endpoint reachability (MEASURED from this container, no credentials):');
  const results = [
    await check('SMTP implicit', 'smtp.migadu.com', 465, true),
    await check('SMTP submit', 'smtp.migadu.com', 587, false),
    await check('IMAP', 'imap.migadu.com', 993, true),
  ];
  return results.every(Boolean);
}

const args = process.argv.slice(2);
console.log('=== ground-truth selfcheck — measured facts, not assumptions ===');
let ok = true;
if (args.length === 0) {
  ok = (await dnsCheck('smtp.migadu.com')) && ok;
  ok = (await dnsCheck('api.migadu.com')) && ok;
  ok = (await emailChecks()) && ok;
} else if (args[0] === 'net' && args.length === 3) {
  const host = args[1];
  const port = Number(args[2]);
  ok = (await dnsCheck(host)) && ok;
  ok = (await check('target', host, port, TLS_PORTS.has(port))) && ok;
} else if (args[0] === 'email') {
  ok = await emailChecks();
} else {
  console.log('usage: node selfcheck.mjs [ net HOST PORT | email ]');
  process.exit(2);
}
console.log('\nThese are MEASURED results. Quote them. Do not assert anything you did not measure.');
process.exit(ok ? 0 : 1);
