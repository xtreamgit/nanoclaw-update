import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export type MicrosoftClientAnswers = {
  tenantId: string;
  clientId: string;
  mailboxes: string[];
  clientSecret?: string;
  certPath?: string;
  keyPath?: string;
  bind?: string;
  port?: number;
  brokerToken?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function renderMicrosoftEnv(answers: MicrosoftClientAnswers): string {
  const tenantId = oneLine(answers.tenantId, 'tenant id');
  const clientId = oneLine(answers.clientId, 'client id');
  const mailboxes = answers.mailboxes.map((mailbox) => mailbox.trim().toLowerCase()).filter(Boolean);
  if (mailboxes.length === 0) throw new Error('At least one mailbox is required');
  for (const mailbox of mailboxes) {
    if (!EMAIL.test(mailbox)) throw new Error(`Invalid mailbox: ${mailbox}`);
  }
  const token = answers.brokerToken?.trim() || randomBytes(32).toString('hex');
  if (token.length < 16 || /[\r\n]/.test(token)) throw new Error('Local broker token is invalid');

  const lines = [
    envLine('MICROSOFT_MAIL_TENANT_ID', tenantId),
    envLine('MICROSOFT_MAIL_CLIENT_ID', clientId),
    envLine('MICROSOFT_MAIL_TOKEN', token),
    envLine('MICROSOFT_MAIL_MAILBOXES', mailboxes.join(',')),
    envLine('MICROSOFT_MAIL_BIND', answers.bind?.trim() || '127.0.0.1'),
    envLine('MICROSOFT_MAIL_PORT', String(answers.port ?? 10256)),
  ];
  if (answers.certPath?.trim() && answers.keyPath?.trim()) {
    lines.push(envLine('MICROSOFT_MAIL_CERT_PATH', answers.certPath));
    lines.push(envLine('MICROSOFT_MAIL_KEY_PATH', answers.keyPath));
  } else if (answers.clientSecret?.trim()) {
    lines.push(envLine('MICROSOFT_MAIL_CLIENT_SECRET', answers.clientSecret));
  } else {
    throw new Error('A client secret or a certificate and key are required');
  }
  return `${lines.join('\n')}\n`;
}

export function writeMicrosoftEnv(file: string, answers: MicrosoftClientAnswers): void {
  writeFileSync(file, renderMicrosoftEnv(answers), { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function main(): Promise<void> {
  const out = argument('--out') || `${process.env.HOME ?? '.'}/microsoft-mail.env`;
  if (existsSync(out) && argument('--replace') !== 'yes') {
    throw new Error(`${out} already exists. Run again with --replace yes to overwrite it.`);
  }
  const answers = await ask(out);
  writeMicrosoftEnv(out, answers);
  stdout.write(`Wrote ${out} (mode 600).\n`);
  stdout.write('The Microsoft secret and the local token are in that file. They were not printed.\n');
  stdout.write('Next: pnpm run mail-broker\n');
}

async function ask(out: string): Promise<MicrosoftClientAnswers> {
  if (!stdin.isTTY) {
    return {
      tenantId: requiredArg('--tenant'),
      clientId: requiredArg('--client'),
      mailboxes: requiredArg('--mailboxes').split(','),
      clientSecret: process.env.MICROSOFT_MAIL_CLIENT_SECRET,
      certPath: argument('--cert'),
      keyPath: argument('--key'),
      bind: argument('--bind'),
      port: argument('--port') ? Number(argument('--port')) : undefined,
      brokerToken: process.env.MICROSOFT_MAIL_TOKEN,
    };
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`This writes client-specific Microsoft credentials to ${out}.\n`);
    stdout.write("Use the client tenant. Do not reuse another client's app.\n\n");
    const tenantId = (await rl.question('Tenant ID: ')).trim();
    const clientId = (await rl.question('Application (client) ID: ')).trim();
    const mailboxes = (await rl.question('Mailboxes, comma-separated: ')).split(',');
    const method = (await rl.question('Credential: secret or certificate? [secret] ')).trim().toLowerCase();
    if (method === 'certificate') {
      const certPath = (await rl.question('Certificate PEM path: ')).trim();
      const keyPath = (await rl.question('Private key PEM path: ')).trim();
      return { tenantId, clientId, mailboxes, certPath, keyPath };
    }
    rl.close();
    const clientSecret = await hidden('Client secret: ');
    return { tenantId, clientId, mailboxes, clientSecret };
  } finally {
    rl.close();
  }
}

function hidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (text === '\u0003') process.exit(130);
      if (text === '\r' || text === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (text === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };
    stdin.on('data', onData);
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredArg(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required when there is no terminal`);
  return value;
}

function envLine(key: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) throw new Error(`${key} must be a single line`);
  return `${key}="${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function oneLine(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) throw new Error(`${label} must be a single line`);
  return trimmed;
}

if (process.argv[1]?.endsWith('setup.ts') || process.argv[1]?.endsWith('setup.js')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'setup failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
