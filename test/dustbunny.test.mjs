import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  CliError,
  getDatabaseSpecCachePath,
  isSupportDevelopmentEnabled,
} from '../src/config.mjs';
import {
  buildOfficialBunnyArgs,
  buildOfficialBunnyEnv,
  resolveOfficialBunnyInvocation,
  runOfficialBunnyCli,
} from '../src/official-cli.mjs';
import {
  applyAppSpec,
  buildSqlPipelineUrl,
  buildSqlRequests,
  buildAppSpec,
  createApiClient,
  createDatabase,
  createAppFromSpec,
  formatIsoDate,
  generateDatabaseGroupToken,
  generateDatabaseToken,
  readCachedDatabaseSpec,
  refreshDatabaseSpecCache,
  showActiveDatabaseUsage,
  showDatabaseLimits,
  showDatabaseSpecCacheStatus,
  showDatabaseUsage,
  listDatabaseTables,
  mutateReplicaRegion,
  parseEnvText,
  parseImageRef,
  parseRoutingFlags,
  isSupportDevelopmentModeEnabled,
  runDatabaseDoctor,
  runDatabaseSql,
  runCli,
  setDatabaseRegions,
  syncEnv,
  waitForApp,
  buildSupportDevelopmentError,
} from '../src/cli.mjs';

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
      probes: {
        readiness: {
          type: 'http',
          http: { path: '/ready', port: 3000 },
          initialDelaySeconds: 5,
        },
      },
    }],
    ...overrides,
  };
}

function createClient(app = createApp()) {
  const patches = [];
  const dbPatches = [];
  const sqlRequests = [];
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  return {
    stdout,
    patches,
    dbPatches,
    sqlRequests,
    dbBearerToken: 'db-token',
    async get(path) {
      assert.equal(path, '/mc/apps/app_123');
      return app;
    },
    async patch(path, body) {
      assert.equal(path, '/mc/apps/app_123');
      patches.push(body);
      return { displayEndpoint: { address: 'fuel.example.com' } };
    },
    async dbGet(path) {
      if (path === '/v1/config/limits') {
        return { current_databases: 4, max_databases: 50 };
      }
      if (path === '/v2/databases/active_usage') {
        return { stats: [{ db_id: 'db_123', reads: 10 }] };
      }
      if (path === '/v1/config') {
        return {
          primary_regions: [{ id: 'de' }],
          storage_region_available: [{ id: 'de' }],
        };
      }
      if (path === '/v1/databases') {
        return {
          databases: [{
            id: 'db_123',
            name: 'demo-db',
            group_id: 'group_abc',
            url: 'libsql://abc-demo.aws.bunnydb.io',
          }],
        };
      }
      if (path === '/v2/databases/db_123') {
        return {
          db: {
            id: 'db_123',
            name: 'demo-db',
            group_id: 'group_abc',
            url: 'libsql://abc-demo.aws.bunnydb.io',
          },
        };
      }
      if (path === '/v1/groups/group_abc') {
        return {
          group: {
            id: 'group_abc',
            storage_region: 'de',
            primary_regions: ['de'],
            replicas_regions: ['uk'],
          },
        };
      }
      throw new Error(`Unexpected dbGet path: ${path}`);
    },
    async dbPatch(path, body) {
      assert.equal(path, '/v1/groups/group_abc');
      dbPatches.push(body);
      return { group: { id: 'group_abc', ...body } };
    },
    async dbPost(path, body) {
      if (path === '/v2/databases') {
        dbPatches.push({ create: body });
        return { db_id: 'db_123' };
      }
      if (path === '/v1/groups/group_abc/auth/generate') {
        dbPatches.push({ groupToken: body });
        return { token: 'group-token' };
      }
      throw new Error(`Unexpected dbPost path: ${path}`);
    },
    async dbPut(path, body) {
      if (path === '/v2/databases/db_123/auth/generate') {
        dbPatches.push({ token: body });
        return { token: 'generated-token' };
      }
      throw new Error(`Unexpected dbPut path: ${path}`);
    },
    async dbDelete(path) {
      assert.equal(path, '/v2/databases/db_123');
      dbPatches.push({ delete: true });
      return null;
    },
    async fetchImpl(url, init) {
      sqlRequests.push({ url, init });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            results: [{
              response: {
                result: {
                  cols: [{ name: 'id' }, { name: 'name' }],
                  rows: [[{ value: '1' }, { value: 'fuel' }]],
                  affected_row_count: 0,
                  last_insert_rowid: null,
                  replication_index: 'ri_1',
                },
              },
            }],
          });
        },
      };
    },
  };
}

function createOpsClient() {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const calls = {
    get: [],
    post: [],
    put: [],
    patch: [],
    delete: [],
  };

  const app = createApp({
    status: 'running',
    displayEndpoint: { address: 'demo-web.bunnyapp.io' },
    containerInstances: [{ id: 'instance-1' }],
  });

  const zone = {
    Id: 77,
    Domain: 'example.com',
    RecordsCount: 2,
    Records: [
      { Id: 10, Name: 'www', Type: 2, Value: 'target.example.com', Ttl: 300 },
      { Id: 11, Name: 'cdn', Type: 7, PullZoneId: 9001, Ttl: 60 },
    ],
  };

  const pullZone = {
    Id: 9001,
    Name: 'site-assets',
    OriginUrl: 'https://origin.example.com',
    Hostnames: [{ Value: 'cdn.example.com' }],
  };

  return {
    stdout,
    calls,
    dbBearerToken: 'db-token',
    async get(path) {
      calls.get.push(path);
      if (path === '/mc/apps') {
        return { items: [app] };
      }
      if (path === '/mc/apps/app_123') {
        return app;
      }
      if (path === '/dnszone?page=1&perPage=100') {
        return { Items: [zone] };
      }
      if (path === '/dnszone/77') {
        return zone;
      }
      if (path === '/pullzone?page=1&perPage=100') {
        return { Items: [pullZone] };
      }
      if (path === '/pullzone/loadFreeCertificate?hostname=cdn.example.com') {
        return { ok: true };
      }
      throw new Error(`Unexpected get path: ${path}`);
    },
    async post(path, body) {
      calls.post.push({ path, body });
      if (path === '/mc/apps') {
        return {
          id: 'app_new',
          name: body.name,
          status: 'deploying',
          displayEndpoint: { address: 'new.bunnyapp.io' },
          containerTemplates: body.containerTemplates,
        };
      }
      if (path === '/pullzone') {
        return {
          Id: 9002,
          Name: body.Name,
          OriginUrl: body.OriginUrl,
        };
      }
      if (path === '/pullzone/9001') {
        return {
          Id: 9001,
          OriginUrl: body.OriginUrl,
        };
      }
      if (path === '/pullzone/9001/addHostname') {
        return { ok: true };
      }
      if (path === '/pullzone/9001/setForceSSL') {
        return { ok: true };
      }
      if (path === '/pullzone/9001/purgeCache') {
        return { ok: true };
      }
      if (path === '/dnszone/77/records/10') {
        return { ok: true };
      }
      throw new Error(`Unexpected post path: ${path}`);
    },
    async put(path, body) {
      calls.put.push({ path, body });
      if (path === '/dnszone/77/records') {
        return { ok: true };
      }
      throw new Error(`Unexpected put path: ${path}`);
    },
    async patch(path, body) {
      calls.patch.push({ path, body });
      if (path === '/mc/apps/app_123') {
        return { displayEndpoint: { address: 'patched.example.com' } };
      }
      throw new Error(`Unexpected patch path: ${path}`);
    },
    async delete(path) {
      calls.delete.push(path);
      if (path === '/mc/apps/app_123' || path === '/dnszone/77/records/10') {
        return null;
      }
      throw new Error(`Unexpected delete path: ${path}`);
    },
  };
}

function createExperimentalDbClient() {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const calls = {
    dbGet: [],
    dbPost: [],
    dbPatch: [],
    dbDelete: [],
    fetch: [],
  };

  const databases = [
    {
      id: 'db_123',
      name: 'demo-db',
      group_id: 'group_abc',
      url: 'libsql://abc-demo.aws.bunnydb.io',
    },
    {
      id: 'db_456',
      name: 'target-db',
      group_id: 'group_xyz',
      url: 'libsql://xyz-demo.aws.bunnydb.io',
    },
  ];

  return {
    stdout,
    calls,
    dbBearerToken: 'db-token',
    dbSpecCachePath: '/tmp/dustbunny-spec.json',
    async dbGet(path) {
      calls.dbGet.push(path);
      if (path === '/v1/databases') {
        return { databases };
      }
      if (path === '/v2/databases/db_123') {
        return { db: databases[0] };
      }
      if (path === '/v2/databases/db_456') {
        return { db: databases[1] };
      }
      if (path === '/v1/groups/group_abc') {
        return {
          group: {
            id: 'group_abc',
            storage_region: 'de',
            primary_regions: ['de'],
            replicas_regions: ['uk'],
          },
        };
      }
      if (path === '/v1/groups/group_xyz') {
        return {
          group: {
            id: 'group_xyz',
            storage_region: 'us',
            primary_regions: ['us'],
            replicas_regions: [],
          },
        };
      }
      if (path.startsWith('/v2/databases/db_123/statistics?')) {
        return { points: [{ reads: 7 }] };
      }
      if (path.startsWith('/v1/groups/group_abc/stats?')) {
        return { points: [{ cpu: 42 }] };
      }
      if (path === '/v2/databases/active_usage') {
        return { stats: [{ db_id: 'db_123', reads: 2 }] };
      }
      throw new Error(`Unexpected dbGet path: ${path}`);
    },
    async dbPost(path, body) {
      calls.dbPost.push({ path, body });
      if (path === '/v1/databases/db_123/list_versions') {
        return { versions: [{ id: 'v1' }] };
      }
      if (path === '/v1/databases/db_123/fork') {
        return { ok: true, name: body.name };
      }
      if (path === '/v1/databases/db_123/restore') {
        return { ok: true, version: body.version };
      }
      throw new Error(`Unexpected dbPost path: ${path}`);
    },
    async dbPatch(path, body) {
      calls.dbPatch.push({ path, body });
      return { group: { id: path.split('/').at(-1), ...body } };
    },
    async dbDelete(path) {
      calls.dbDelete.push(path);
      return null;
    },
    async fetchImpl(url, init) {
      calls.fetch.push({ url, init });
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            results: [{
              response: {
                result: {
                  cols: [{ name: 'value' }],
                  rows: [[{ value: 'ok' }]],
                  affected_row_count: 0,
                  last_insert_rowid: null,
                  replication_index: 'ri_1',
                },
              },
            }],
          });
        },
      };
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
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-test-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-spec-'));
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
  spec.containerTemplate.probes = {
    readiness: {
      type: 'http',
      http: { path: '/api/health', port: 4000 },
      initialDelaySeconds: 20,
    },
  };
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
    assert.deepEqual(patch.containerTemplates[0].probes, {
      startup: undefined,
      readiness: {
        type: 'http',
        http: { path: '/api/health', port: 4000 },
        initialDelaySeconds: 20,
      },
      liveness: undefined,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildAppSpec includes all container templates for multi-container apps', () => {
  const spec = buildAppSpec(createApp({
    containerTemplates: [
      ...createApp().containerTemplates,
      {
        id: 'tpl_2',
        name: 'worker',
        packageId: 'pkg_2',
        imageNamespace: 'acme',
        imageName: 'demo-worker',
        imageTag: 'v1',
        imageRegistryId: 'registry_1',
        imagePullPolicy: 'always',
        environmentVariables: [{ name: 'WORKER', value: 'true' }],
        endpoints: [],
      },
    ],
  }));

  assert.equal(spec.containerTemplates.length, 2);
  assert.equal(spec.containerTemplates[1].name, 'worker');
  assert.equal(spec.containerTemplates[1].image, 'acme/demo-worker:v1');
});

test('buildAppSpec preserves probes from container templates', () => {
  const spec = buildAppSpec(createApp());
  assert.deepEqual(spec.containerTemplate.probes, {
    startup: undefined,
    readiness: {
      type: 'http',
      http: { path: '/ready', port: 3000 },
      initialDelaySeconds: 5,
    },
    liveness: undefined,
  });
});

test('createAppFromSpec creates a multi-container app from a spec file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-create-spec-'));
  const specFile = join(dir, 'search-spec.json');
  writeFileSync(specFile, `${JSON.stringify({
    name: 'search',
    runtimeType: 'shared',
    autoScaling: { min: 1, max: 1 },
    regionSettings: { requiredRegionIds: ['DE'] },
    containerTemplates: [
      {
        name: 'edge',
        image: 'ghcr.io/codyjo/search-openresty:v1',
        imageRegistryId: '6323',
        environmentVariables: [{ name: 'JWT_SECRET', value: 'secret' }],
        endpoints: [{ displayName: 'search-cdn', type: 'cdn', cdn: { portMappings: [{ containerPort: 8088 }] } }],
        probes: {
          readiness: {
            type: 'http',
            http: { path: '/healthz', port: 8088 },
          },
        },
      },
      {
        name: 'searxng',
        image: 'ghcr.io/codyjo/search-searxng:v1',
        imageRegistryId: '6323',
        environmentVariables: [{ name: 'SEARXNG_SECRET', value: 'another-secret' }],
        endpoints: [],
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const posts = [];
  const client = {
    stdout,
    async post(path, body) {
      assert.equal(path, '/mc/apps');
      posts.push(body);
      return {
        id: 'app_search',
        name: 'search',
        status: 'active',
        displayEndpoint: { address: 'mc-search.bunny.run' },
        containerTemplates: body.containerTemplates,
      };
    },
  };

  try {
    await createAppFromSpec(client, specFile);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].containerTemplates.length, 2);
    assert.equal(posts[0].containerTemplates[0].imageNamespace, 'ghcr.io');
    assert.equal(posts[0].containerTemplates[0].imageName, 'codyjo/search-openresty');
    assert.equal(posts[0].containerTemplates[1].name, 'searxng');
    assert.deepEqual(posts[0].containerTemplates[0].probes, {
      startup: undefined,
      readiness: {
        type: 'http',
        http: { path: '/healthz', port: 8088 },
      },
      liveness: undefined,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyAppSpec can add a second container template from spec', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-multi-spec-'));
  const specFile = join(dir, 'multi-spec.json');
  writeFileSync(specFile, `${JSON.stringify({
    autoScaling: { min: 1, max: 1 },
    containerTemplates: [
      {
        name: 'app',
        image: 'acme/demo:v2',
        environmentVariables: [{ name: 'APP_ENV', value: 'prod' }],
        endpoints: [{ displayName: 'demo-web-cdn', type: 'cdn', cdn: { portMappings: [{ containerPort: 3000 }] } }],
      },
      {
        name: 'worker',
        image: 'acme/demo-worker:v1',
        imageRegistryId: 'registry_1',
        environmentVariables: [{ name: 'WORKER', value: 'true' }],
        endpoints: [],
      },
    ],
  }, null, 2)}\n`, 'utf8');

  try {
    const client = createClient();
    await applyAppSpec(client, 'app_123', specFile);

    assert.equal(client.patches[0].containerTemplates.length, 2);
    assert.equal(client.patches[0].containerTemplates[1].name, 'worker');
    assert.equal(client.patches[0].containerTemplates[1].imageName, 'demo-worker');
    assert.deepEqual(client.patches[0].containerTemplates[1].environmentVariables, [{ name: 'WORKER', value: 'true' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('waitForApp polls until running and healthy', async () => {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  let reads = 0;
  const healthUrls = [];
  const client = {
    stdout,
    async get() {
      reads += 1;
      return createApp({
        status: reads === 1 ? 'deploying' : 'running',
        containerInstances: [{ id: `instance-${reads}` }],
      });
    },
  };

  let now = 0;
  await waitForApp(client, 'app_123', '30', '1', {
    now: () => now,
    sleep: async () => { now += 1000; },
    fetchImpl: async (url) => {
      healthUrls.push(url);
      return {
        status: reads === 1 ? 503 : 200,
        async text() { return ''; },
      };
    },
  });

  assert.match(stdout.chunks.join(''), /App demo-web is ready\./);
  assert.equal(healthUrls.at(-1), 'https://demo-web.bunnyapp.io/ready');
});

test('waitForApp treats active status as ready when health passes', async () => {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const client = {
    stdout,
    async get() {
      return createApp({
        status: 'active',
        containerInstances: [{ id: 'instance-1' }],
      });
    },
  };

  await waitForApp(client, 'app_123', '5', '1', {
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async () => ({
      status: 200,
      async text() { return ''; },
    }),
  });

  assert.match(stdout.chunks.join(''), /App demo-web is ready\./);
});

test('buildSqlPipelineUrl converts libsql URLs to https pipeline endpoints', () => {
  assert.equal(
    buildSqlPipelineUrl('libsql://abc-demo.aws.bunnydb.io'),
    'https://abc-demo.aws.bunnydb.io/v2/pipeline',
  );
});

test('buildSqlRequests encodes SQL args for pipeline execution', () => {
  assert.deepEqual(buildSqlRequests('select ?', '[1,true,"x"]'), [
    {
      type: 'execute',
      stmt: {
        sql: 'select ?',
        args: [
          { type: 'integer', value: '1' },
          { type: 'integer', value: '1' },
          { type: 'text', value: 'x' },
        ],
      },
    },
    { type: 'close' },
  ]);
});

test('createDatabase uses config defaults when regions are omitted', async () => {
  const client = createClient();
  await createDatabase(client, 'preview-db');

  assert.deepEqual(client.dbPatches[0], {
    create: {
      name: 'preview-db',
      primary_regions: ['de'],
      replicas_regions: [],
      storage_region: 'de',
    },
  });
});

test('formatIsoDate normalizes date inputs', () => {
  assert.equal(formatIsoDate('2026-03-27T12:00:00Z'), '2026-03-27T12:00:00.000Z');
});

test('generateDatabaseToken emits a generated token', async () => {
  const client = createClient();
  await generateDatabaseToken(client, 'demo-db', 'read-only');

  assert.deepEqual(client.dbPatches[0], {
    token: { authorization: 'read-only' },
  });
  assert.match(client.stdout.chunks.join(''), /generated-token/);
});

test('generateDatabaseGroupToken emits a generated group token', async () => {
  const client = createClient();
  await generateDatabaseGroupToken(client, 'demo-db', 'full-access');

  assert.deepEqual(client.dbPatches[0], {
    groupToken: { authorization: 'full-access' },
  });
  assert.match(client.stdout.chunks.join(''), /group-token/);
});

test('setDatabaseRegions patches group topology payload', async () => {
  const client = createClient();
  await setDatabaseRegions(client, 'demo-db', 'de,us', 'de', 'uk,sg');

  assert.deepEqual(client.dbPatches[0], {
    primary_regions: ['de', 'us'],
    storage_region: 'de',
    replicas_regions: ['uk', 'sg'],
  });
});

test('mutateReplicaRegion adds and removes replicas from group payload', async () => {
  const addClient = createClient();
  await mutateReplicaRegion(addClient, 'demo-db', 'sg', 'add');
  assert.deepEqual(addClient.dbPatches[0], {
    storage_region: 'de',
    primary_regions: ['de'],
    replicas_regions: ['uk', 'sg'],
  });

  const removeClient = createClient();
  await mutateReplicaRegion(removeClient, 'demo-db', 'uk', 'remove');
  assert.deepEqual(removeClient.dbPatches[0], {
    storage_region: 'de',
    primary_regions: ['de'],
    replicas_regions: [],
  });
});

test('runDatabaseSql posts SQL pipeline request with bearer auth', async () => {
  const client = createClient();
  await runDatabaseSql(client, 'demo-db', 'select * from users where id = ?', '[1]');

  assert.equal(client.sqlRequests[0].url, 'https://abc-demo.aws.bunnydb.io/v2/pipeline');
  assert.equal(client.sqlRequests[0].init.method, 'POST');
  assert.equal(client.sqlRequests[0].init.headers.Authorization, 'Bearer db-token');
  assert.match(client.stdout.chunks.join(''), /"name": "fuel"|"name": "demo"/);
});

test('listDatabaseTables runs sqlite_master table discovery query', async () => {
  const client = createClient();
  await listDatabaseTables(client, 'demo-db');

  const body = JSON.parse(client.sqlRequests[0].init.body);
  assert.match(body.requests[0].stmt.sql, /sqlite_master/);
});

test('runDatabaseDoctor aggregates several SQL checks', async () => {
  const client = createClient();
  await runDatabaseDoctor(client, 'demo-db');

  const report = JSON.parse(client.stdout.chunks.join(''));
  assert.ok(report.integrity_check);
  assert.ok(report.foreign_keys);
  assert.ok(report.tables);
});

test('showDatabaseLimits prints config limits', async () => {
  const client = createClient();
  await showDatabaseLimits(client);
  assert.match(client.stdout.chunks.join(''), /max_databases/);
});

test('showActiveDatabaseUsage prints active stats', async () => {
  const client = createClient();
  await showActiveDatabaseUsage(client);
  assert.match(client.stdout.chunks.join(''), /db_123/);
});

test('getDatabaseSpecCachePath prefers env override', () => {
  assert.equal(
    getDatabaseSpecCachePath({ env: { BUNNY_DB_SPEC_CACHE: '/tmp/custom-spec.json' }, config: {} }),
    '/tmp/custom-spec.json',
  );
});

test('isSupportDevelopmentEnabled prefers env and dustbunny config opt-in', () => {
  assert.equal(
    isSupportDevelopmentEnabled({ env: { DUSTBUNNY_SUPPORT_DEVELOPMENT: '1' }, dustbunnyConfig: {} }),
    true,
  );
  assert.equal(
    isSupportDevelopmentEnabled({ env: {}, dustbunnyConfig: { features: { supportDevelopment: true } } }),
    true,
  );
  assert.equal(
    isSupportDevelopmentEnabled({ env: {}, dustbunnyConfig: {} }),
    false,
  );
});

test('refreshDatabaseSpecCache fetches and persists Bunny DB private spec', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-spec-cache-'));
  const cachePath = join(dir, 'private-api.json');
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const client = {
    stdout,
    dbSpecCachePath: cachePath,
    async fetchImpl(url) {
      assert.equal(url, 'https://api.bunny.net/database/docs/private/api.json');
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            openapi: '3.1.0',
            paths: {
              '/v1/config/limits': {
                get: { operationId: 'limits' },
              },
            },
          });
        },
      };
    },
  };

  try {
    const payload = await refreshDatabaseSpecCache(client);
    const cached = readCachedDatabaseSpec(cachePath);

    assert.equal(payload.spec.paths['/v1/config/limits'].get.operationId, 'limits');
    assert.equal(cached.spec.paths['/v1/config/limits'].get.operationId, 'limits');
    assert.match(stdout.chunks.join(''), /cachePath/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('showDatabaseSpecCacheStatus reports missing cache cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-spec-status-'));
  const cachePath = join(dir, 'missing.json');
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };

  try {
    await showDatabaseSpecCacheStatus({ dbSpecCachePath: cachePath, stdout });
    const status = JSON.parse(stdout.chunks.join(''));
    assert.equal(status.present, false);
    assert.equal(status.cachePath, cachePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('showDatabaseUsage uses encoded ISO date query params', async () => {
  const client = createClient();
  const originalDbGet = client.dbGet;
  client.dbGet = async (path) => {
    if (path === '/v1/databases') {
      return originalDbGet(path);
    }
    assert.match(path, /\/v2\/databases\/db_123\/usage\?from=2026-03-27T00%3A00%3A00.000Z&to=2026-03-28T00%3A00%3A00.000Z/);
    return { ok: true };
  };
  await showDatabaseUsage(client, 'demo-db', '2026-03-27T00:00:00Z', '2026-03-28T00:00:00Z');
  assert.match(client.stdout.chunks.join(''), /"ok": true/);
});

test('runCli executes app scale command without legacy passthrough', async () => {
  const patches = [];
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const client = {
    stdout,
    async get() {
      return createApp({ status: 'running' });
    },
    async patch(_path, body) {
      patches.push(body);
      return {};
    },
  };

  const code = await runCli(['app', 'scale', 'app_123', '2', '4'], {
    client,
    stdout,
    disableLegacyPassthrough: true,
  });

  assert.equal(code, 0);
  assert.deepEqual(patches[0].autoScaling, { min: 2, max: 4 });
});

test('runCli lists apps through native app surface', async () => {
  const client = createOpsClient();
  const code = await runCli(['apps'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });

  assert.equal(code, 0);
  assert.match(client.stdout.chunks.join(''), /demo-web/);
});

test('runCli shows app json through native app surface', async () => {
  const client = createOpsClient();
  const code = await runCli(['app', 'app_123', '--json'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });

  assert.equal(code, 0);
  assert.match(client.stdout.chunks.join(''), /"name": "demo-web"/);
});

test('runCli deletes app through native app surface', async () => {
  const client = createOpsClient();
  const code = await runCli(['app', 'delete', 'app_123'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });

  assert.equal(code, 0);
  assert.deepEqual(client.calls.delete, ['/mc/apps/app_123']);
  assert.match(client.stdout.chunks.join(''), /Deleted demo-web/);
});

test('runCli updates app image through native app surface', async () => {
  const client = createOpsClient();
  const code = await runCli(['app', 'image', 'app_123', 'acme/demo:v9', 'registry_2'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });

  assert.equal(code, 0);
  assert.equal(client.calls.patch[0].body.containerTemplates[0].imageTag, 'v9');
  assert.equal(client.calls.patch[0].body.containerTemplates[0].imageRegistryId, 'registry_2');
});

test('runCli routes endpoint list, add, and remove commands', async () => {
  const listClient = createOpsClient();
  await runCli(['endpoint', 'list', 'app_123'], {
    client: listClient,
    stdout: listClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(listClient.stdout.chunks.join(''), /demo-web-cdn/);

  const addClient = createOpsClient();
  await runCli(['endpoint', 'cdn', 'app_123', '8080', 'edge-cdn'], {
    client: addClient,
    stdout: addClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(addClient.calls.patch[0].body.containerTemplates[0].endpoints.at(-1).displayName, 'edge-cdn');

  const removeClient = createOpsClient();
  await runCli(['endpoint', 'remove', 'app_123', 'demo-web-cdn'], {
    client: removeClient,
    stdout: removeClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(removeClient.calls.patch[0].body.containerTemplates[0].endpoints.length, 0);
});

test('runCli routes dns zone and records commands', async () => {
  const zoneClient = createOpsClient();
  await runCli(['dns', 'zones'], {
    client: zoneClient,
    stdout: zoneClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(zoneClient.stdout.chunks.join(''), /example.com/);

  const showClient = createOpsClient();
  await runCli(['dns', 'zone', '77'], {
    client: showClient,
    stdout: showClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(showClient.stdout.chunks.join(''), /"Domain": "example.com"/);

  const recordsClient = createOpsClient();
  await runCli(['dns', 'records', '77'], {
    client: recordsClient,
    stdout: recordsClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(recordsClient.stdout.chunks.join(''), /Zone: example.com/);
});

test('runCli creates, updates, and deletes dns records', async () => {
  const createClient = createOpsClient();
  await runCli(['dns', 'set', '77', 'api', 'A', '203.0.113.10', '120'], {
    client: createClient,
    stdout: createClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(createClient.calls.put[0].path, '/dnszone/77/records');
  assert.equal(createClient.calls.put[0].body.Type, 0);

  const updateClient = createOpsClient();
  await runCli(['dns', 'set', '77', 'www', 'CNAME', 'new.example.com', '600'], {
    client: updateClient,
    stdout: updateClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(updateClient.calls.post[0].path, '/dnszone/77/records/10');
  assert.equal(updateClient.calls.post[0].body.Name, 'www');

  const pullZoneClient = createOpsClient();
  await runCli(['dns', 'pullzone', '77', 'assets', '9001', '60'], {
    client: pullZoneClient,
    stdout: pullZoneClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(pullZoneClient.calls.put[0].body.Type, 7);

  const deleteClient = createOpsClient();
  await runCli(['dns', 'delete', '77', '10'], {
    client: deleteClient,
    stdout: deleteClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.deepEqual(deleteClient.calls.delete, ['/dnszone/77/records/10']);
});

test('runCli routes pull zone commands', async () => {
  const listClient = createOpsClient();
  await runCli(['pz', 'list'], {
    client: listClient,
    stdout: listClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(listClient.stdout.chunks.join(''), /site-assets/);

  const createClient = createOpsClient();
  await runCli(['pz', 'create', 'media', 'https://origin.example.com'], {
    client: createClient,
    stdout: createClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(createClient.calls.post[0].path, '/pullzone');

  const originClient = createOpsClient();
  await runCli(['pz', 'origin', '9001', 'https://new-origin.example.com'], {
    client: originClient,
    stdout: originClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(originClient.calls.post[0].path, '/pullzone/9001');

  const hostnameClient = createOpsClient();
  await runCli(['pz', 'hostname', '9001', 'assets.example.com'], {
    client: hostnameClient,
    stdout: hostnameClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(hostnameClient.calls.post[0].path, '/pullzone/9001/addHostname');

  const sslClient = createOpsClient();
  await runCli(['pz', 'ssl', '9001', 'cdn.example.com'], {
    client: sslClient,
    stdout: sslClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(sslClient.calls.get.at(-1), '/pullzone/loadFreeCertificate?hostname=cdn.example.com');
  assert.equal(sslClient.calls.post[0].path, '/pullzone/9001/setForceSSL');

  const purgeClient = createOpsClient();
  await runCli(['pz', 'purge', '9001'], {
    client: purgeClient,
    stdout: purgeClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(purgeClient.calls.post[0].path, '/pullzone/9001/purgeCache');
});

test('dns set validates required arguments', async () => {
  const client = createOpsClient();
  await assert.rejects(
    () => runCli(['dns', 'set', '77', 'api', 'A'], {
      client,
      stdout: client.stdout,
      disableLegacyPassthrough: true,
    }),
    /Usage: dns set/,
  );
});

test('dns set creates new record with correct body shape', async () => {
  const client = createOpsClient();
  await runCli(['dns', 'set', '77', 'api', 'A', '203.0.113.10', '120'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });
  const put = client.calls.put[0];
  assert.equal(put.path, '/dnszone/77/records');
  assert.equal(put.body.Type, 0);
  assert.equal(put.body.Name, 'api');
  assert.equal(put.body.Value, '203.0.113.10');
  assert.equal(put.body.Ttl, 120);
  assert.match(client.stdout.chunks.join(''), /Created A api -> 203\.0\.113\.10/);
});

test('dns set updates existing record and writes update message', async () => {
  const client = createOpsClient();
  await runCli(['dns', 'set', '77', 'www', 'CNAME', 'new.example.com', '600'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });
  const post = client.calls.post[0];
  assert.equal(post.path, '/dnszone/77/records/10');
  assert.equal(post.body.Name, 'www');
  assert.equal(post.body.Type, 2);
  assert.equal(post.body.Value, 'new.example.com');
  assert.equal(post.body.Ttl, 600);
  assert.match(client.stdout.chunks.join(''), /Updated CNAME www -> new\.example\.com/);
});

test('dns set uses default ttl of 300', async () => {
  const client = createOpsClient();
  await runCli(['dns', 'set', '77', 'test', 'TXT', 'v=spf1'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(client.calls.put[0].body.Ttl, 300);
});

test('dns delete validates required arguments', async () => {
  const client = createOpsClient();
  await assert.rejects(
    () => runCli(['dns', 'delete', '77'], {
      client,
      stdout: client.stdout,
      disableLegacyPassthrough: true,
    }),
    /Usage: dns delete/,
  );
});

test('dns delete calls correct endpoint and writes confirmation', async () => {
  const client = createOpsClient();
  await runCli(['dns', 'delete', '77', '10'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });
  assert.deepEqual(client.calls.delete, ['/dnszone/77/records/10']);
  assert.match(client.stdout.chunks.join(''), /Deleted DNS record 10 from zone 77/);
});

test('pz ssl calls loadFreeCertificate then setForceSSL', async () => {
  const client = createOpsClient();
  await runCli(['pz', 'ssl', '9001', 'cdn.example.com'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });
  // First call: load free cert
  assert.equal(client.calls.get.at(-1), '/pullzone/loadFreeCertificate?hostname=cdn.example.com');
  // Second call: force SSL
  const sslPost = client.calls.post.find((c) => c.path.includes('setForceSSL'));
  assert.ok(sslPost, 'setForceSSL was called');
  assert.equal(sslPost.path, '/pullzone/9001/setForceSSL');
  assert.equal(sslPost.body.Hostname, 'cdn.example.com');
  assert.equal(sslPost.body.ForceSSL, true);
  assert.match(client.stdout.chunks.join(''), /Activated SSL for cdn\.example\.com on pull zone 9001/);
});

test('pz ssl validates required arguments', async () => {
  const client = createOpsClient();
  await assert.rejects(
    () => runCli(['pz', 'ssl', '9001'], {
      client,
      stdout: client.stdout,
      disableLegacyPassthrough: true,
    }),
    /Usage: pz ssl/,
  );
});

test('runCli health command reports response body and errors', async () => {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const code = await runCli(['health', 'status.example.com'], {
    client: { stdout },
    stdout,
    disableLegacyPassthrough: true,
    fetchImpl: async () => ({
      status: 200,
      async text() {
        return 'ok';
      },
    }),
  });

  assert.equal(code, 0);
  assert.match(stdout.chunks.join(''), /HTTP 200/);

  await assert.rejects(
    runCli(['health', 'status.example.com'], {
      client: { stdout: { write() {} } },
      stdout: { write() {} },
      disableLegacyPassthrough: true,
      fetchImpl: async () => {
        throw new Error('network down');
      },
    }),
    /Health check failed/,
  );
});

test('runCli setup command prints setup guidance', async () => {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const code = await runCli(['setup'], {
    stdout,
    stderr: { write() {} },
  });

  assert.equal(code, 0);
  assert.match(stdout.chunks.join(''), /npm run setup/);
});

test('runCli executes database replica add command without legacy passthrough', async () => {
  const client = createClient();
  const code = await runCli(['--experimental', 'db', 'replica', 'add', 'demo-db', 'sg'], {
    client,
    stdout: client.stdout,
    disableLegacyPassthrough: true,
  });

  assert.equal(code, 0);
  assert.deepEqual(client.dbPatches[0], {
    storage_region: 'de',
    primary_regions: ['de'],
    replicas_regions: ['uk', 'sg'],
  });
});

test('buildOfficialBunnyArgs maps documented official commands', () => {
  assert.deepEqual(buildOfficialBunnyArgs(['login']), {
    args: ['login'],
    fallbackToCustom: false,
    source: 'official',
  });
  assert.deepEqual(buildOfficialBunnyArgs(['db', 'create', 'demo-db', 'DE', 'DE', 'UK,NY']), {
    args: ['db', 'create', '--name', 'demo-db', '--primary', 'DE', '--storage-region', 'DE', '--replicas', 'UK,NY'],
    fallbackToCustom: true,
    source: 'official',
  });
  assert.deepEqual(buildOfficialBunnyArgs(['db', 'sql', 'demo-db', 'select 1']), {
    args: ['db', 'shell', 'demo-db', '--execute', 'select 1', '--mode', 'json'],
    fallbackToCustom: true,
    source: 'official',
  });
  assert.deepEqual(buildOfficialBunnyArgs(['db', 'show', 'demo-db']), {
    args: ['db', 'show', 'demo-db'],
    fallbackToCustom: false,
    source: 'official',
  });
  assert.deepEqual(buildOfficialBunnyArgs(['db', 'regions', 'list', 'demo-db']), {
    args: ['db', 'regions', 'list', 'demo-db'],
    fallbackToCustom: false,
    source: 'official',
  });
  assert.deepEqual(buildOfficialBunnyArgs(['db', 'tokens', 'create', 'demo-db', '--read-only']), {
    args: ['db', 'tokens', 'create', 'demo-db', '--read-only'],
    fallbackToCustom: false,
    source: 'official',
  });
  assert.deepEqual(buildOfficialBunnyArgs(['db', 'usage', '--period', '7d']), {
    args: ['db', 'usage', '--period', '7d'],
    fallbackToCustom: false,
    source: 'official',
  });
});

test('buildOfficialBunnyEnv maps DustBunny auth into official Bunny env names', () => {
  const env = buildOfficialBunnyEnv({ BUNNY_API_KEY: 'abc123' }, {});
  assert.equal(env.BUNNYNET_API_KEY, 'abc123');
});

test('resolveOfficialBunnyInvocation honors pinned version env', () => {
  const invocation = resolveOfficialBunnyInvocation({
    DUSTBUNNY_OFFICIAL_CLI_VERSION: '0.2.1',
  });
  if (invocation.mode === 'npx') {
    assert.deepEqual(invocation.argsPrefix, ['-y', '@bunny.net/cli@0.2.1']);
  } else {
    assert.equal(invocation.version, 'path');
  }
});

test('resolveOfficialBunnyInvocation honors configured binary override', () => {
  const invocation = resolveOfficialBunnyInvocation({
    DUSTBUNNY_OFFICIAL_CLI_BIN: '/tmp/custom-bunny',
    DUSTBUNNY_OFFICIAL_CLI_VERSION: '0.2.1',
  });
  assert.equal(invocation.mode, 'configured-bin');
  assert.equal(invocation.command, '/tmp/custom-bunny');
});

test('parseRoutingFlags strips routing controls from argv', () => {
  assert.deepEqual(parseRoutingFlags(['--prefer-native', '--no-fallback', 'db', 'list']), {
    preferOfficial: false,
    preferNative: true,
    noFallback: true,
    experimental: false,
    supportDevelopment: false,
    argv: ['db', 'list'],
  });
});

test('parseRoutingFlags captures experimental flag', () => {
  assert.deepEqual(parseRoutingFlags(['--experimental', 'db', 'doctor', 'demo-db']), {
    preferOfficial: false,
    preferNative: false,
    noFallback: false,
    experimental: true,
    supportDevelopment: false,
    argv: ['db', 'doctor', 'demo-db'],
  });
});

test('parseRoutingFlags captures support-development flag', () => {
  assert.deepEqual(parseRoutingFlags(['--support-development', 'foo', 'bar']), {
    preferOfficial: false,
    preferNative: false,
    noFallback: false,
    experimental: false,
    supportDevelopment: true,
    argv: ['foo', 'bar'],
  });
});

test('isSupportDevelopmentModeEnabled respects routing and config', () => {
  assert.equal(
    isSupportDevelopmentModeEnabled({ supportDevelopment: true }, {}, {}),
    true,
  );
  assert.equal(
    isSupportDevelopmentModeEnabled({ supportDevelopment: false }, {}, { features: { supportDevelopment: true } }),
    true,
  );
});

test('buildSupportDevelopmentError explains local-first approval flow', () => {
  const message = buildSupportDevelopmentError(['db', 'future-command']);
  assert.match(message, /Support Development Mode/);
  assert.match(message, /maintainer approval/);
  assert.match(message, /docs\/SUPPORT-DEVELOPMENT.md/);
});

test('runOfficialBunnyCli uses injected runner for official passthrough', async () => {
  const calls = [];
  const result = await runOfficialBunnyCli(
    { args: ['db', 'list'], fallbackToCustom: true, source: 'official' },
    {
      env: { BUNNY_API_KEY: 'abc123' },
      config: {},
      stdout: { write() {} },
      stderr: { write() {} },
      officialRunner: async (args, options) => {
        calls.push({ args, options });
        return { code: 0 };
      },
    },
  );

  assert.equal(result.code, 0);
  assert.deepEqual(calls[0].args, ['db', 'list']);
  assert.equal(calls[0].options.env.BUNNYNET_API_KEY, 'abc123');
});

test('runCli prefers official Bunny CLI for supported commands', async () => {
  const officialCalls = [];
  const code = await runCli(['login'], {
    stdout: { write() {} },
    stderr: { write() {} },
    officialRunner: async (args) => {
      officialCalls.push(args);
      return { code: 0 };
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(officialCalls[0], ['login']);
});

test('runCli surfaces official Bunny CLI thrown errors when fallback is not allowed', async () => {
  await assert.rejects(
    runCli(['login'], {
      stdout: { write() {} },
      stderr: { write() {} },
      officialRunner: async () => ({ code: 1, error: new Error('auth failed') }),
    }),
    /Official Bunny CLI failed for login: auth failed/,
  );
});

test('runCli skips official passthrough when --prefer-native is set', async () => {
  const client = createClient();
  const officialCalls = [];
  const code = await runCli(['--prefer-native', 'db', 'list'], {
    client,
    stdout: client.stdout,
    stderr: { write() {} },
    officialRunner: async (args) => {
      officialCalls.push(args);
      return { code: 0 };
    },
  });

  assert.equal(code, 0);
  assert.equal(officialCalls.length, 0);
  assert.match(client.stdout.chunks.join(''), /demo-db/);
});

test('runCli falls back to DustBunny custom implementation when official mapped command fails', async () => {
  const client = createClient();
  const officialCalls = [];
  const stderr = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const code = await runCli(['db', 'list'], {
    client,
    stdout: client.stdout,
    stderr,
    officialRunner: async (args) => {
      officialCalls.push(args);
      return { code: 1 };
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(officialCalls[0], ['db', 'list']);
  assert.match(client.stdout.chunks.join(''), /demo-db/);
  assert.match(stderr.chunks.join(''), /falling back to native implementation/);
});

test('runCli honors --no-fallback for official mapped commands', async () => {
  const client = createClient();
  const code = await runCli(['--no-fallback', 'db', 'list'], {
    client,
    stdout: client.stdout,
    stderr: { write() {} },
    officialRunner: async () => ({ code: 9 }),
  });

  assert.equal(code, 9);
  assert.equal(client.stdout.chunks.length, 0);
});

test('runCli blocks experimental db commands by default', async () => {
  await assert.rejects(
    runCli(['db', 'doctor', 'demo-db'], {
      stdout: { write() {} },
      stderr: { write() {} },
      officialRunner: async () => ({ code: 0 }),
    }),
    /experimental and disabled by default/,
  );
});

test('runCli rejects unsupported commands without support-development mode', async () => {
  await assert.rejects(
    runCli(['future', 'thing'], {
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /Unsupported command: future thing/,
  );
});

test('runCli shows support-development guide command', async () => {
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  const code = await runCli(['support-development'], {
    stdout,
    stderr: { write() {} },
  });

  assert.equal(code, 0);
  assert.match(stdout.chunks.join(''), /Support Development Mode/);
});

test('runCli shows support-development error for unsupported command when enabled', async () => {
  await assert.rejects(
    runCli(['--support-development', 'future', 'thing'], {
      stdout: { write() {} },
      stderr: { write() {} },
      client: createClient(),
    }),
    /maintainer approval/,
  );
});

test('runCli allows experimental db commands with --experimental', async () => {
  const client = createClient();
  const code = await runCli(['--experimental', 'db', 'doctor', 'demo-db'], {
    client,
    stdout: client.stdout,
    stderr: { write() {} },
  });

  assert.equal(code, 0);
  assert.match(client.stdout.chunks.join(''), /integrity_check/);
});

test('runCli refreshes DB spec and appends drift details on DB HTTP failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-cli-spec-drift-'));
  const cachePath = join(dir, 'private-api.json');
  const stdout = { chunks: [], write(chunk) { this.chunks.push(chunk); } };

  writeFileSync(cachePath, `${JSON.stringify({
    fetchedAt: '2026-03-26T00:00:00.000Z',
    specUrl: 'https://api.bunny.net/database/docs/private/api.json',
    hash: 'old',
    spec: {
      paths: {
        '/v1/config/limits': {
          get: { operationId: 'limitsOld' },
        },
      },
    },
  }, null, 2)}\n`, 'utf8');

  const client = {
    stdout,
    dbSpecCachePath: cachePath,
    async dbGet(path) {
      if (path === '/v1/config/limits') {
        throw new Error('This path should not be called directly.');
      }
      throw new Error(`Unexpected path ${path}`);
    },
    async fetchImpl(url) {
      if (url === 'https://api.bunny.net/database/docs/private/api.json') {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              openapi: '3.1.0',
              paths: {},
            });
          },
        };
      }
      throw new Error(`Unexpected fetch url ${url}`);
    },
  };

  client.dbGet = async () => {
    throw new CliError('HTTP 500 GET /v1/config/limits\n{"error":"Internal error"}');
  };

  try {
    await assert.rejects(
      runCli(['--experimental', 'db', 'limits'], {
        client,
        stdout,
        disableLegacyPassthrough: true,
      }),
      (error) => {
        assert.match(error.message, /Checked Bunny DB private API spec/);
        assert.match(error.message, /Current spec no longer exposes path \/v1\/config\/limits/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCli routes experimental db group, spec, and delete commands', async () => {
  const groupClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'group', 'demo-db'], {
    client: groupClient,
    stdout: groupClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(groupClient.stdout.chunks.join(''), /group_abc/);

  const specClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'spec', 'demo-db'], {
    client: specClient,
    stdout: specClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(specClient.stdout.chunks.join(''), /"database"/);
  assert.match(specClient.stdout.chunks.join(''), /"group"/);

  const deleteClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'delete', 'demo-db'], {
    client: deleteClient,
    stdout: deleteClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.deepEqual(deleteClient.calls.dbDelete, ['/v2/databases/db_123']);
});

test('runCli routes experimental db mirror, versions, fork, and restore commands', async () => {
  const mirrorClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'mirror', 'demo-db', 'target-db'], {
    client: mirrorClient,
    stdout: mirrorClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(mirrorClient.calls.dbPatch[0].path, '/v1/groups/group_xyz');

  const versionsClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'versions', 'demo-db', '5'], {
    client: versionsClient,
    stdout: versionsClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(versionsClient.calls.dbPost[0].path, '/v1/databases/db_123/list_versions');

  const forkClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'fork', 'demo-db', 'demo-db-copy'], {
    client: forkClient,
    stdout: forkClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(forkClient.calls.dbPost[0].path, '/v1/databases/db_123/fork');

  const restoreClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'restore', 'demo-db', 'v1'], {
    client: restoreClient,
    stdout: restoreClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.equal(restoreClient.calls.dbPost[0].path, '/v1/databases/db_123/restore');
});

test('runCli routes experimental db sql wrapper commands and stats', async () => {
  const schemaClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'schema', 'demo-db'], {
    client: schemaClient,
    stdout: schemaClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(JSON.parse(schemaClient.calls.fetch[0].init.body).requests[0].stmt.sql, /sqlite_master/);

  const indexClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'indexes', 'demo-db', 'users'], {
    client: indexClient,
    stdout: indexClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(JSON.parse(indexClient.calls.fetch[0].init.body).requests[0].stmt.sql, /tbl_name = \?/);

  const pragmaClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'pragma', 'demo-db', 'journal_mode'], {
    client: pragmaClient,
    stdout: pragmaClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(JSON.parse(pragmaClient.calls.fetch[0].init.body).requests[0].stmt.sql, /pragma journal_mode/);

  const integrityClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'integrity-check', 'demo-db'], {
    client: integrityClient,
    stdout: integrityClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(JSON.parse(integrityClient.calls.fetch[0].init.body).requests[0].stmt.sql, /integrity_check/);

  const fkClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'fk-check', 'demo-db'], {
    client: fkClient,
    stdout: fkClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(JSON.parse(fkClient.calls.fetch[0].init.body).requests[0].stmt.sql, /foreign_key_check/);

  const dumpClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'dump', 'schema', 'demo-db'], {
    client: dumpClient,
    stdout: dumpClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(JSON.parse(dumpClient.calls.fetch[0].init.body).requests[0].stmt.sql, /sql is not null/);

  const statsClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'stats', 'demo-db', '2026-03-01T00:00:00Z', '2026-03-28T00:00:00Z'], {
    client: statsClient,
    stdout: statsClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(statsClient.stdout.chunks.join(''), /"reads": 7/);

  const groupStatsClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'group-stats', 'demo-db', '2026-03-01T00:00:00Z', '2026-03-28T00:00:00Z'], {
    client: groupStatsClient,
    stdout: groupStatsClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(groupStatsClient.stdout.chunks.join(''), /"cpu": 42/);

  const activeUsageClient = createExperimentalDbClient();
  await runCli(['--experimental', 'db', 'active-usage'], {
    client: activeUsageClient,
    stdout: activeUsageClient.stdout,
    disableLegacyPassthrough: true,
  });
  assert.match(activeUsageClient.stdout.chunks.join(''), /db_123/);
});

test('createApiClient fails without Bunny API key', () => {
  assert.throws(
    () => createApiClient({ env: {}, config: {}, fetchImpl: async () => ({}) }),
    /No Bunny API key found/,
  );
});

test('createApiClient parses json, text, and error responses', async () => {
  const requests = [];
  const client = createApiClient({
    env: { BUNNY_API_KEY: 'abc123' },
    config: {},
    stdout: { write() {} },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/json')) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({ ok: true });
          },
        };
      }
      if (url.endsWith('/text')) {
        return {
          ok: true,
          async text() {
            return 'plain text';
          },
        };
      }
      return {
        ok: false,
        status: 500,
        async text() {
          return JSON.stringify({ error: 'boom' });
        },
      };
    },
  });

  const json = await client.get('/json');
  const text = await client.get('/text');
  assert.deepEqual(json, { ok: true });
  assert.equal(text, 'plain text');
  assert.equal(requests[0].init.headers.AccessKey, 'abc123');

  await assert.rejects(
    client.get('/error'),
    /HTTP 500 GET \/error/,
  );
});
