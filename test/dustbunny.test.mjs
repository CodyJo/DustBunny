import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  applyAppSpec,
  buildAppSpec,
  parseEnvText,
  parseImageRef,
  runCli,
  syncEnv,
  waitForApp,
} from '../bin/dustbunny.mjs';

function createApp(overrides = {}) {
  return {
    id: 'app_123',
    name: 'demo-web',
    status: 'deploying',
    runtimeType: 'shared',
    autoScaling: { min: 1, max: 3 },
    displayEndpoint: { address: 'demo-web.bunnyapp.io' },
    regionSettings: { requiredRegionIds: ['de'] },
    containerInstances: [{ id: 'instance-1' }],
    containerTemplates: [{
      id: 'tpl_1',
      name: 'app',
      packageId: 'pkg_1',
      imageNamespace: 'acme',
      imageName: 'demo',
      imageTag: 'v1',
      imageRegistryId: 'registry_1',
      imagePullPolicy: 'always',
      environmentVariables: [
        { name: 'APP_ENV', value: 'prod' },
        { name: 'OLD_KEY', value: 'legacy' },
      ],
      endpoints: [{
        displayName: 'demo-web-cdn',
        type: 'cdn',
        publicHost: 'demo.example.com',
        cdn: { portMappings: [{ containerPort: 3000 }] },
      }],
    }],
    ...overrides,
  };
}

function createClient(app = createApp()) {
  const patches = [];
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  return {
    stdout,
    patches,
    async get(path) {
      assert.equal(path, '/mc/apps/app_123');
      return app;
    },
    async patch(path, body) {
      assert.equal(path, '/mc/apps/app_123');
      patches.push(body);
      return { displayEndpoint: { address: 'demo.example.com' } };
    },
    async post() {
      return null;
    },
    async put() {
      return null;
    },
    async delete() {
      return null;
    },
  };
}

test('parseEnvText handles comments and quoted values', () => {
  const env = parseEnvText(`
    # comment
    APP_ENV=prod
    API_KEY="abc123"
    NAME='demo web'
  `);

  assert.deepEqual(env, [
    { name: 'APP_ENV', value: 'prod' },
    { name: 'API_KEY', value: 'abc123' },
    { name: 'NAME', value: 'demo web' },
  ]);
});

test('parseImageRef enforces namespace/name:tag', () => {
  assert.deepEqual(parseImageRef('acme/demo:v4'), {
    imageNamespace: 'acme',
    imageName: 'demo',
    imageTag: 'v4',
  });
});

test('syncEnv replaces environment variables in app patch payload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dustbunny-test-'));
  const envFile = join(dir, 'demo.env');
  writeFileSync(envFile, 'APP_ENV=production\nAPI_URL=https://api.example.com\n', 'utf8');

  try {
    const client = createClient();
    await syncEnv(client, 'app_123', envFile, { merge: false });

    assert.equal(client.patches.length, 1);
    assert.deepEqual(client.patches[0].containerTemplates[0].environmentVariables, [
      { name: 'API_URL', value: 'https://api.example.com' },
      { name: 'APP_ENV', value: 'production' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyAppSpec patches image, scale, env, and endpoints from exported spec', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dustbunny-spec-'));
  const specFile = join(dir, 'demo-spec.json');
  const spec = buildAppSpec(createApp({ status: 'running' }));
  spec.autoScaling = { min: 2, max: 5 };
  spec.containerTemplate.image = 'acme/demo:v9';
  spec.containerTemplate.environmentVariables = [{ name: 'APP_ENV', value: 'preview' }];
  spec.containerTemplate.endpoints = [{
    displayName: 'preview-cdn',
    type: 'cdn',
    cdn: { portMappings: [{ containerPort: 4000 }] },
  }];
  writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

  try {
    const client = createClient();
    await applyAppSpec(client, 'app_123', specFile);

    const patch = client.patches[0];
    assert.deepEqual(patch.autoScaling, { min: 2, max: 5 });
    assert.equal(patch.containerTemplates[0].imageTag, 'v9');
    assert.deepEqual(patch.containerTemplates[0].environmentVariables, [{ name: 'APP_ENV', value: 'preview' }]);
    assert.deepEqual(patch.containerTemplates[0].endpoints, [{
      displayName: 'preview-cdn',
      type: 'cdn',
      cdn: { portMappings: [{ containerPort: 4000 }] },
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('waitForApp exits when app reaches healthy running state', async () => {
  const app = createApp({ status: 'running' });
  const client = createClient(app);
  await waitForApp(client, 'app_123', '5', '1', {
    sleep: async () => {},
    fetchImpl: async () => ({
      status: 200,
      async text() {
        return 'ok';
      },
    }),
  });

  assert.match(client.stdout.chunks.join(''), /App demo-web is ready/);
});

test('runCli shows help for empty argv', async () => {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const exitCode = await runCli([], { stdout });
  assert.equal(exitCode, 0);
  assert.match(stdout.chunks.join(''), /DustBunny/);
});
