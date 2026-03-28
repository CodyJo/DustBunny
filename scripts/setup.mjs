import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { spawnSync } from 'child_process';

const DUSTBUNNY_CONFIG_PATH = resolve(process.env.HOME || '', '.config/dustbunny.json');

function loadExistingConfig() {
  if (!existsSync(DUSTBUNNY_CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(DUSTBUNNY_CONFIG_PATH, 'utf8'));
}

function checkCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    command,
    output: (result.stdout || result.stderr || '').trim(),
  };
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    ok: major >= 18,
    command: 'node',
    output: process.version,
  };
}

function saveConfig(config) {
  mkdirSync(dirname(DUSTBUNNY_CONFIG_PATH), { recursive: true });
  writeFileSync(DUSTBUNNY_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function main() {
  const checks = [
    checkNodeVersion(),
    checkCommand('npm', ['--version']),
    checkCommand('npx', ['--version']),
    checkCommand('git', ['--version']),
    checkCommand('bunny', ['--version']),
  ];

  output.write('DustBunny setup\n\n');
  output.write('Dependency check:\n');
  for (const check of checks) {
    output.write(`- ${check.command}: ${check.ok ? 'ok' : 'missing/unavailable'}${check.output ? ` (${check.output})` : ''}\n`);
  }
  output.write('\n');

  const rl = createInterface({ input, output });
  const existing = loadExistingConfig();
  const current = existing.features?.supportDevelopment === true;
  const answer = await rl.question(`Enable Support Development Mode? ${current ? '[Y/n]' : '[y/N]'} `);
  rl.close();

  const normalized = answer.trim().toLowerCase();
  const enable = normalized
    ? normalized === 'y' || normalized === 'yes'
    : current;

  const nextConfig = {
    ...existing,
    features: {
      ...(existing.features || {}),
      supportDevelopment: enable,
    },
  };

  saveConfig(nextConfig);

  output.write(`\nSaved ${DUSTBUNNY_CONFIG_PATH}\n`);
  output.write(`Support Development Mode: ${enable ? 'enabled' : 'disabled'}\n`);
  output.write('Maintainer approval is still required before any local support-development changes are merged upstream.\n');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
