import { spawn, spawnSync } from 'child_process';

import { getApiKey, loadConfig } from './config.mjs';

export function buildOfficialBunnyArgs(argv) {
  const [command, ...args] = argv;
  if (['login', 'logout', 'whoami', 'config', 'registries', 'scripts'].includes(command)) {
    return { args: argv, fallbackToCustom: false, source: 'official' };
  }

  if (command !== 'db') return null;
  if (args.length === 0) return { args: argv, fallbackToCustom: false, source: 'official' };

  if (args[0] === 'list') {
    return { args: ['db', 'list'], fallbackToCustom: true, source: 'official' };
  }
  if (args[0] === 'create' && args[1]) {
    const officialArgs = ['db', 'create', '--name', args[1]];
    if (args[2]) officialArgs.push('--primary', args[2]);
    if (args[3]) officialArgs.push('--storage-region', args[3]);
    if (args[4]) officialArgs.push('--replicas', args[4]);
    return { args: officialArgs, fallbackToCustom: true, source: 'official' };
  }
  if (args[0] === 'delete' && args[1]) {
    return { args: ['db', 'delete', args[1]], fallbackToCustom: true, source: 'official' };
  }
  if (args[0] === 'sql' && args[1] && args[2]) {
    return { args: ['db', 'shell', args[1], '--execute', args[2], '--mode', 'json'], fallbackToCustom: true, source: 'official' };
  }
  if ((args[0] === 'query' || args[0] === 'exec') && args[1] && args[2]) {
    return { args: ['db', 'shell', args[1], '--execute', args[2], '--mode', 'json'], fallbackToCustom: true, source: 'official' };
  }

  return null;
}

export function buildOfficialBunnyEnv(env, config) {
  const resolvedApiKey = getApiKey({ env, config });
  const officialEnv = { ...env };
  if (resolvedApiKey && !officialEnv.BUNNYNET_API_KEY) {
    officialEnv.BUNNYNET_API_KEY = resolvedApiKey;
  }
  return officialEnv;
}

export function resolveOfficialBunnyInvocation(env = process.env) {
  const configuredVersion = env.DUSTBUNNY_OFFICIAL_CLI_VERSION || 'latest';
  const configuredBin = env.DUSTBUNNY_OFFICIAL_CLI_BIN;

  if (configuredBin) {
    return { command: configuredBin, argsPrefix: [], mode: 'configured-bin', version: configuredVersion };
  }

  const bunnyCheck = spawnSync('bunny', ['--version'], { stdio: 'ignore' });
  if (!bunnyCheck.error && bunnyCheck.status === 0) {
    return { command: 'bunny', argsPrefix: [], mode: 'path-bin', version: 'path' };
  }

  return {
    command: 'npx',
    argsPrefix: ['-y', `@bunny.net/cli@${configuredVersion}`],
    mode: 'npx',
    version: configuredVersion,
  };
}

export async function runOfficialBunnyCli(passthrough, { env = process.env, config = loadConfig(), stdout = process.stdout, stderr = process.stderr, officialRunner } = {}) {
  const resolvedEnv = buildOfficialBunnyEnv(env, config);
  const invocation = resolveOfficialBunnyInvocation(resolvedEnv);

  if (officialRunner) {
    return officialRunner(passthrough.args, {
      env: resolvedEnv,
      stdout,
      stderr,
      fallbackToCustom: passthrough.fallbackToCustom,
      source: passthrough.source,
      invocation,
    });
  }

  return new Promise((resolvePromise) => {
    const child = spawn(invocation.command, [...invocation.argsPrefix, ...passthrough.args], {
      env: resolvedEnv,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => stdout.write(chunk));
    child.stderr.on('data', (chunk) => stderr.write(chunk));
    child.on('close', (code) => resolvePromise({ code: code ?? 1, invocation }));
    child.on('error', (error) => resolvePromise({ code: 1, error, invocation }));
  });
}
