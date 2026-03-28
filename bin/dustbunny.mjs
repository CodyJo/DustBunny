#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const CONFIG_PATH = resolve(process.env.HOME || '', '.config/bunnynet.json');
const API_BASE = 'https://api.bunny.net';

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === __filename;
}

function loadConfig(configPath = CONFIG_PATH) {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new CliError(`Failed to parse ${configPath}: ${error.message}`);
  }
}

function getApiKey({ env = process.env, config = loadConfig() } = {}) {
  return env.BUNNY_API_KEY || config.profiles?.default?.api_key || null;
}

function pad(value, width) {
  return String(value ?? '').padEnd(width);
}

function parseEnvText(text) {
  const variables = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const offset = line.indexOf('=');
    if (offset === -1) fail(`Invalid env line: ${rawLine}`);
    const name = line.slice(0, offset).trim();
    let value = line.slice(offset + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    variables.push({ name, value });
  }
  return variables;
}

function loadEnvFile(file) {
  const content = readFileSync(resolve(file), 'utf8');
  if (file.endsWith('.json')) {
    return Object.entries(JSON.parse(content)).map(([name, value]) => ({ name, value: String(value) }));
  }
  return parseEnvText(content);
}

function dedupeEnvVars(variables) {
  const map = new Map();
  for (const item of variables) {
    map.set(item.name, { name: item.name, value: String(item.value ?? '') });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeEnvVars(existing, incoming) {
  return dedupeEnvVars([...(existing || []), ...(incoming || [])]);
}

function removeEnvVar(existing, key) {
  return (existing || []).filter((item) => item.name !== key);
}

function parseImageRef(value) {
  if (!value) fail('Image reference is required.');
  const slash = value.indexOf('/');
  const colon = value.lastIndexOf(':');
  if (slash === -1 || colon === -1 || colon < slash) {
    fail(`Expected image reference in namespace/name:tag format, got: ${value}`);
  }
  return {
    imageNamespace: value.slice(0, slash),
    imageName: value.slice(slash + 1, colon),
    imageTag: value.slice(colon + 1),
  };
}

function normalizeEndpoints(endpoints) {
  return (endpoints || []).map((endpoint) => {
    const type = String(endpoint.type || '').toLowerCase();
    const normalized = {
      displayName: endpoint.displayName,
      type,
    };

    if (type === 'cdn') {
      normalized.cdn = {
        portMappings: endpoint.cdn?.portMappings || endpoint.portMappings || [],
      };
      if (endpoint.cdn?.stickySessions ?? endpoint.stickySessions) {
        normalized.cdn.stickySessions = endpoint.cdn?.stickySessions || endpoint.stickySessions;
      }
      if (endpoint.cdn?.pullZoneId ?? endpoint.pullZoneId) {
        normalized.cdn.pullZoneId = endpoint.cdn?.pullZoneId || endpoint.pullZoneId;
      }
    } else if (type === 'anycast') {
      normalized.anycast = {
        portMappings: endpoint.anycast?.portMappings || endpoint.portMappings || [],
      };
    } else {
      fail(`Unsupported endpoint type: ${endpoint.type}`);
    }

    return normalized;
  });
}

function buildTemplatePatch(template = {}, overrides = {}) {
  const payload = {
    name: overrides.name ?? template.name,
    imageName: overrides.imageName ?? template.imageName,
    imageNamespace: overrides.imageNamespace ?? template.imageNamespace,
    imageTag: overrides.imageTag ?? template.imageTag,
    imagePullPolicy: overrides.imagePullPolicy ?? template.imagePullPolicy ?? 'always',
    environmentVariables: overrides.environmentVariables ?? dedupeEnvVars(template.environmentVariables || []),
    endpoints: overrides.endpoints ?? normalizeEndpoints(template.endpoints),
  };

  const imageRegistryId = overrides.imageRegistryId ?? template.imageRegistryId;
  const entryPoint = overrides.entryPoint ?? template.entryPoint;
  const volumeMounts = overrides.volumeMounts ?? template.volumeMounts;
  if (template.id) payload.id = template.id;
  if (template.packageId) payload.packageId = template.packageId;
  if (imageRegistryId) payload.imageRegistryId = imageRegistryId;
  if (entryPoint) payload.entryPoint = entryPoint;
  if (volumeMounts) payload.volumeMounts = volumeMounts;

  return payload;
}

function buildAppSpec(app) {
  const templates = (app.containerTemplates || []).map((template) => ({
    id: template.id,
    name: template.name,
    image: `${template.imageNamespace}/${template.imageName}:${template.imageTag}`,
    imageRegistryId: template.imageRegistryId || null,
    imagePullPolicy: template.imagePullPolicy || null,
    entryPoint: template.entryPoint || null,
    volumeMounts: template.volumeMounts || [],
    environmentVariables: dedupeEnvVars(template.environmentVariables || []),
    endpoints: normalizeEndpoints(template.endpoints),
  }));
  const template = templates[0];
  if (!template) fail(`App ${app.id} has no container templates.`);

  return {
    id: app.id,
    name: app.name,
    status: app.status,
    runtimeType: app.runtimeType || 'shared',
    autoScaling: app.autoScaling || null,
    regionSettings: app.regionSettings || null,
    displayEndpoint: app.displayEndpoint?.address || null,
    containerTemplate: template,
    containerTemplates: templates,
  };
}

function formatSpecSummary(spec) {
  return [
    `App:       ${spec.name} (${spec.id})`,
    `Status:    ${spec.status}`,
    `Endpoint:  ${spec.displayEndpoint || 'none'}`,
    `Image:     ${spec.containerTemplate.image}`,
    `Scale:     ${spec.autoScaling?.min ?? '?'}..${spec.autoScaling?.max ?? '?'}`,
    `Env vars:  ${spec.containerTemplate.environmentVariables.length}`,
    `Endpoints: ${spec.containerTemplate.endpoints.length}`,
  ].join('\n');
}

function normalizeDesiredContainerTemplates(desired) {
  if (Array.isArray(desired.containerTemplates) && desired.containerTemplates.length > 0) {
    return desired.containerTemplates;
  }
  if (desired.containerTemplate) {
    return [desired.containerTemplate];
  }
  fail('App spec must include containerTemplates or containerTemplate.');
}

function createApiClient({
  env = process.env,
  config = loadConfig(),
  fetchImpl = fetch,
  stdout = process.stdout,
} = {}) {
  const apiKey = getApiKey({ env, config });
  if (!apiKey) fail('No Bunny API key found. Set BUNNY_API_KEY or configure ~/.config/bunnynet.json');

  async function request(method, path, body) {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        AccessKey: apiKey,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      let details = text;
      try {
        details = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Keep text fallback.
      }
      throw new CliError(`HTTP ${response.status} ${method} ${path}\n${details}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    stdout,
    config,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}

async function getApp(client, id) {
  if (!id) fail('App id is required.');
  return client.get(`/mc/apps/${id}`);
}

async function patchApp(client, appId, payload) {
  return client.patch(`/mc/apps/${appId}`, payload);
}

async function listApps(client) {
  const data = await client.get('/mc/apps');
  const apps = data.items || [];
  if (apps.length === 0) {
    client.stdout.write('No apps found.\n');
    return;
  }

  client.stdout.write('\n');
  for (const app of apps) {
    client.stdout.write(`  ${pad(app.id, 12)} ${pad(app.name, 24)} ${pad(app.status, 12)} ${app.displayEndpoint?.address || ''}\n`);
  }
  client.stdout.write('\n');
}

async function showApp(client, id, { json = false } = {}) {
  const app = await getApp(client, id);
  const spec = buildAppSpec(app);
  if (json) {
    client.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
    return;
  }
  client.stdout.write(`\n${formatSpecSummary(spec)}\n\n`);
}

async function exportAppSpec(client, id) {
  const app = await getApp(client, id);
  client.stdout.write(`${JSON.stringify(buildAppSpec(app), null, 2)}\n`);
}

async function createApp(client, name, imageRef, registryId, port = '3000', envFile) {
  if (!name) fail('Usage: app create <name> <namespace/name:tag> [registryId] [port] [envFile]');
  const image = parseImageRef(imageRef);
  const environmentVariables = envFile ? dedupeEnvVars(loadEnvFile(envFile)) : [];
  const payload = {
    name,
    runtimeType: 'shared',
    autoScaling: { min: 1, max: 3 },
    containerTemplates: [{
      name: 'app',
      imageName: image.imageName,
      imageNamespace: image.imageNamespace,
      imageTag: image.imageTag,
      imageRegistryId: registryId || undefined,
      imagePullPolicy: 'always',
      endpoints: [{
        displayName: `${name}-cdn`,
        type: 'cdn',
        cdn: { portMappings: [{ containerPort: Number(port) }] },
      }],
      environmentVariables,
    }],
  };

  const app = await client.post('/mc/apps', payload);
  client.stdout.write(`${JSON.stringify({
    id: app.id,
    name: app.name,
    status: app.status,
    endpoint: app.displayEndpoint?.address || null,
    envCount: app.containerTemplates?.[0]?.environmentVariables?.length || 0,
  }, null, 2)}\n`);
}

async function createAppFromSpec(client, file) {
  if (!file) fail('Usage: app create-spec <spec.json>');
  const desired = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const desiredTemplates = normalizeDesiredContainerTemplates(desired);
  const payload = {
    name: desired.name,
    runtimeType: desired.runtimeType || 'shared',
    autoScaling: desired.autoScaling || { min: 1, max: 3 },
    containerTemplates: desiredTemplates.map((template) => {
      const image = template.image ? parseImageRef(template.image) : {};
      return buildTemplatePatch({}, {
        name: template.name,
        ...image,
        imageRegistryId: template.imageRegistryId,
        imagePullPolicy: template.imagePullPolicy || 'always',
        entryPoint: template.entryPoint || undefined,
        volumeMounts: template.volumeMounts || undefined,
        environmentVariables: dedupeEnvVars(template.environmentVariables || []),
        endpoints: normalizeEndpoints(template.endpoints || []),
      });
    }),
  };

  if (!payload.name) fail('App spec name is required.');
  if (desired.regionSettings) payload.regionSettings = desired.regionSettings;

  const app = await client.post('/mc/apps', payload);
  client.stdout.write(`${JSON.stringify({
    id: app.id,
    name: app.name,
    status: app.status,
    endpoint: app.displayEndpoint?.address || null,
    containerCount: app.containerTemplates?.length || 0,
  }, null, 2)}\n`);
}

async function deleteApp(client, id) {
  if (!id) fail('Usage: app delete <id>');
  const app = await getApp(client, id);
  await client.delete(`/mc/apps/${id}`);
  client.stdout.write(`Deleted ${app.name} (${id}).\n`);
}

async function updateAppImage(client, id, imageRef, registryId) {
  const app = await getApp(client, id);
  const template = app.containerTemplates?.[0];
  if (!template) fail(`App ${id} has no container templates.`);
  const image = parseImageRef(imageRef);

  await patchApp(client, id, {
    containerTemplates: [buildTemplatePatch(template, { ...image, imageRegistryId: registryId ?? template.imageRegistryId, imagePullPolicy: 'always' })],
  });

  client.stdout.write(`Updated ${app.name} to ${imageRef}. Bunny should redeploy the app.\n`);
}

async function scaleApp(client, id, minInstances, maxInstances) {
  const min = Number(minInstances);
  const max = Number(maxInstances);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    fail('Scale values must be integers and satisfy 0 <= min <= max.');
  }

  const app = await getApp(client, id);
  await patchApp(client, id, {
    autoScaling: { min, max },
  });

  client.stdout.write(`Updated ${app.name} autoscaling to min=${min}, max=${max}.\n`);
}

async function syncEnv(client, id, file, { merge = false } = {}) {
  const incoming = loadEnvFile(file);
  const app = await getApp(client, id);
  const template = app.containerTemplates?.[0];
  if (!template) fail(`App ${id} has no container templates.`);

  const environmentVariables = merge
    ? mergeEnvVars(template.environmentVariables || [], incoming)
    : dedupeEnvVars(incoming);

  await patchApp(client, id, {
    containerTemplates: [buildTemplatePatch(template, { environmentVariables })],
  });

  client.stdout.write(`${merge ? 'Merged' : 'Synced'} ${incoming.length} env vars into ${app.name}. App will redeploy.\n`);
}

async function unsetEnv(client, id, key) {
  const app = await getApp(client, id);
  const template = app.containerTemplates?.[0];
  if (!template) fail(`App ${id} has no container templates.`);

  const environmentVariables = removeEnvVar(template.environmentVariables || [], key);
  await patchApp(client, id, {
    containerTemplates: [buildTemplatePatch(template, { environmentVariables })],
  });

  client.stdout.write(`Removed ${key} from ${app.name}. App will redeploy.\n`);
}

async function listEndpoints(client, id) {
  const app = await getApp(client, id);
  const endpoints = app.containerTemplates?.[0]?.endpoints || [];
  if (endpoints.length === 0) {
    client.stdout.write(`No endpoints found for ${app.name}.\n`);
    return;
  }

  client.stdout.write('\n');
  for (const endpoint of endpoints) {
    const ports = endpoint.cdn?.portMappings || endpoint.anycast?.portMappings || endpoint.portMappings || [];
    const publicHost = endpoint.publicHost || endpoint.publicUrl || '';
    client.stdout.write(`  ${pad(endpoint.displayName, 24)} ${pad(endpoint.type, 8)} ${pad(publicHost, 36)} ${JSON.stringify(ports)}\n`);
  }
  client.stdout.write('\n');
}

async function addCdnEndpoint(client, id, port = '3000', displayName) {
  const app = await getApp(client, id);
  const template = app.containerTemplates?.[0];
  if (!template) fail(`App ${id} has no container templates.`);

  const endpoints = normalizeEndpoints(template.endpoints);
  endpoints.push({
    displayName: displayName || `${app.name}-cdn-${port}`,
    type: 'cdn',
    cdn: { portMappings: [{ containerPort: Number(port) }] },
  });

  const result = await patchApp(client, id, {
    containerTemplates: [buildTemplatePatch(template, { endpoints })],
  });

  client.stdout.write(`Added CDN endpoint to ${app.name}: ${result.displayEndpoint?.address || 'pending'}\n`);
}

async function removeEndpoint(client, id, selector) {
  const app = await getApp(client, id);
  const template = app.containerTemplates?.[0];
  if (!template) fail(`App ${id} has no container templates.`);

  const existing = template.endpoints || [];
  const filtered = existing.filter((endpoint) =>
    endpoint.displayName !== selector
    && endpoint.publicHost !== selector
    && endpoint.publicUrl !== selector,
  );

  if (filtered.length === existing.length) {
    fail(`Endpoint not found: ${selector}`);
  }

  await patchApp(client, id, {
    containerTemplates: [buildTemplatePatch(template, { endpoints: normalizeEndpoints(filtered) })],
  });

  client.stdout.write(`Removed endpoint ${selector} from ${app.name}. App will redeploy.\n`);
}

async function applyAppSpec(client, id, file) {
  const desired = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const app = await getApp(client, id);
  const existingTemplates = app.containerTemplates || [];
  if (existingTemplates.length === 0) fail(`App ${id} has no container templates.`);

  const specTemplates = normalizeDesiredContainerTemplates(desired);
  const templateById = new Map(existingTemplates.filter((template) => template.id).map((template) => [template.id, template]));
  const templateByName = new Map(existingTemplates.filter((template) => template.name).map((template) => [template.name, template]));
  const payload = {
    autoScaling: desired.autoScaling || app.autoScaling,
    containerTemplates: specTemplates.map((specTemplate, index) => {
      const template = templateById.get(specTemplate.id)
        || templateByName.get(specTemplate.name)
        || existingTemplates[index]
        || {};
      const image = specTemplate.image ? parseImageRef(specTemplate.image) : {};
      return buildTemplatePatch(template, {
        name: specTemplate.name ?? template.name,
        ...image,
        imageRegistryId: specTemplate.imageRegistryId ?? template.imageRegistryId,
        imagePullPolicy: specTemplate.imagePullPolicy ?? template.imagePullPolicy,
        entryPoint: specTemplate.entryPoint ?? template.entryPoint,
        volumeMounts: specTemplate.volumeMounts ?? template.volumeMounts,
        environmentVariables: specTemplate.environmentVariables ? dedupeEnvVars(specTemplate.environmentVariables) : dedupeEnvVars(template.environmentVariables || []),
        endpoints: specTemplate.endpoints ? normalizeEndpoints(specTemplate.endpoints) : normalizeEndpoints(template.endpoints),
      });
    }),
  };

  if (desired.regionSettings) {
    payload.regionSettings = desired.regionSettings;
  }

  await patchApp(client, id, payload);
  client.stdout.write(`Applied app spec from ${file} to ${app.name}.\n`);
}

async function waitForApp(client, id, timeoutSeconds = '300', intervalSeconds = '10', opts = {}) {
  const timeoutMs = Number(timeoutSeconds) * 1000;
  const intervalMs = Number(intervalSeconds) * 1000;
  const deadline = (opts.now || Date.now)() + timeoutMs;
  const sleep = opts.sleep || ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  const fetchImpl = opts.fetchImpl || fetch;

  while ((opts.now || Date.now)() <= deadline) {
    const app = await getApp(client, id);
    const endpoint = app.displayEndpoint?.address;
    let health = null;

    if (endpoint) {
      try {
        const response = await fetchImpl(`https://${endpoint}/health`, { signal: AbortSignal.timeout(5000) });
        health = response.status;
      } catch {
        health = null;
      }
    }

    client.stdout.write(`status=${app.status} instances=${app.containerInstances?.length || 0} health=${health ?? 'n/a'}\n`);

    if (['running', 'active'].includes(String(app.status).toLowerCase()) && (!endpoint || (health && health < 400))) {
      client.stdout.write(`App ${app.name} is ready.\n`);
      return;
    }

    await sleep(intervalMs);
  }

  fail(`Timed out waiting for app ${id} to become healthy after ${timeoutSeconds}s.`);
}

async function listZones(client) {
  const data = await client.get('/dnszone?page=1&perPage=100');
  const zones = data.Items || data.items || data || [];
  if (zones.length === 0) {
    client.stdout.write('No DNS zones found.\n');
    return;
  }

  client.stdout.write('\n');
  for (const zone of zones) {
    client.stdout.write(`  ${pad(zone.Id || zone.id, 12)} ${pad(zone.Domain || zone.domain, 32)} records=${zone.RecordsCount ?? zone.recordsCount ?? '?'}\n`);
  }
  client.stdout.write('\n');
}

async function showZone(client, zoneId) {
  if (!zoneId) fail('Usage: dns zone <zoneId>');
  const zone = await client.get(`/dnszone/${zoneId}`);
  client.stdout.write(`${JSON.stringify(zone, null, 2)}\n`);
}

async function getZoneRecords(client, zoneId) {
  if (!zoneId) fail('Usage: dns records <zoneId>');
  const zone = await client.get(`/dnszone/${zoneId}`);
  return {
    zone,
    records: zone.Records || zone.records || [],
  };
}

async function listRecords(client, zoneId) {
  const { zone, records } = await getZoneRecords(client, zoneId);
  const types = {
    0: 'A',
    1: 'AAAA',
    2: 'CNAME',
    3: 'TXT',
    4: 'MX',
    5: 'REDIRECT',
    6: 'FLATTEN',
    7: 'PULLZONE',
    8: 'SRV',
    9: 'CAA',
    12: 'NS',
  };

  client.stdout.write(`\nZone: ${zone.Domain || zone.domain} (${zoneId})\n\n`);
  for (const record of records) {
    const type = types[record.Type ?? record.type] || String(record.Type ?? record.type);
    client.stdout.write(`  ${pad(record.Id || record.id, 12)} ${pad(type, 8)} ${pad(record.Name || record.name || '@', 28)} ${pad((record.Value || record.value || '').slice(0, 60), 60)} ttl=${record.Ttl || record.ttl || ''}\n`);
  }
  client.stdout.write('\n');
}

async function setDnsRecord(client, zoneId, name, type, value, ttl = '300') {
  if (!zoneId || !name || !type || value === undefined) {
    fail('Usage: dns set <zoneId> <name> <type> <value> [ttl]');
  }

  const typeMap = { A: 0, AAAA: 1, CNAME: 2, TXT: 3, MX: 4, REDIRECT: 5, FLATTEN: 6, PULLZONE: 7 };
  const typeNum = typeMap[String(type).toUpperCase()] ?? Number(type);
  if (!Number.isInteger(typeNum)) fail(`Unsupported DNS record type: ${type}`);

  const { records } = await getZoneRecords(client, zoneId);
  const existing = records.find((record) =>
    (record.Name || record.name) === name
    && Number(record.Type ?? record.type) === typeNum,
  );

  const parsedTtl = Number(ttl);
  const body = typeNum === 7
    ? { PullZoneId: Number(value), Ttl: parsedTtl, AutoSslIssuance: true }
    : { Value: value, Ttl: parsedTtl };

  if (existing) {
    const recordId = existing.Id || existing.id;
    await client.post(`/dnszone/${zoneId}/records/${recordId}`, {
      ...body,
      Id: recordId,
      Name: name,
      Type: typeNum,
    });
    client.stdout.write(`Updated ${type} ${name} -> ${value} (ttl=${parsedTtl}).\n`);
    return;
  }

  await client.put(`/dnszone/${zoneId}/records`, {
    Type: typeNum,
    Name: name,
    ...body,
  });
  client.stdout.write(`Created ${type} ${name} -> ${value} (ttl=${parsedTtl}).\n`);
}

async function setPullZoneRecord(client, zoneId, name, pullZoneId, ttl = '60') {
  await setDnsRecord(client, zoneId, name, 'PULLZONE', pullZoneId, ttl);
}

async function deleteDnsRecord(client, zoneId, recordId) {
  if (!zoneId || !recordId) fail('Usage: dns delete <zoneId> <recordId>');
  await client.delete(`/dnszone/${zoneId}/records/${recordId}`);
  client.stdout.write(`Deleted DNS record ${recordId} from zone ${zoneId}.\n`);
}

async function listPullZones(client) {
  const data = await client.get('/pullzone?page=1&perPage=100');
  const zones = data.Items || data.items || data || [];
  if (zones.length === 0) {
    client.stdout.write('No pull zones found.\n');
    return;
  }

  client.stdout.write('\n');
  for (const zone of zones) {
    const hostnames = (zone.Hostnames || zone.hostnames || []).map((host) => host.Value || host.value).join(', ');
    client.stdout.write(`  ${pad(zone.Id || zone.id, 10)} ${pad(zone.Name || zone.name, 24)} ${pad(zone.OriginUrl || zone.originUrl, 42)} ${hostnames}\n`);
  }
  client.stdout.write('\n');
}

async function createPullZone(client, name, originUrl) {
  if (!name || !originUrl) fail('Usage: pz create <name> <originUrl>');
  const zone = await client.post('/pullzone', { Name: name, OriginUrl: originUrl });
  client.stdout.write(`${JSON.stringify({
    id: zone.Id || zone.id,
    name: zone.Name || zone.name,
    originUrl: zone.OriginUrl || zone.originUrl,
  }, null, 2)}\n`);
}

async function updatePullZoneOrigin(client, pullZoneId, originUrl) {
  if (!pullZoneId || !originUrl) fail('Usage: pz origin <pullZoneId> <originUrl>');
  const zone = await client.post(`/pullzone/${pullZoneId}`, { OriginUrl: originUrl });
  client.stdout.write(`Updated pull zone ${zone.Id || zone.id} origin to ${zone.OriginUrl || zone.originUrl}.\n`);
}

async function addPullZoneHostname(client, pullZoneId, hostname) {
  if (!pullZoneId || !hostname) fail('Usage: pz hostname <pullZoneId> <hostname>');
  await client.post(`/pullzone/${pullZoneId}/addHostname`, { Hostname: hostname });
  client.stdout.write(`Added hostname ${hostname} to pull zone ${pullZoneId}.\n`);
}

async function activatePullZoneSsl(client, pullZoneId, hostname) {
  if (!pullZoneId || !hostname) fail('Usage: pz ssl <pullZoneId> <hostname>');
  await client.get(`/pullzone/loadFreeCertificate?hostname=${encodeURIComponent(hostname)}`);
  await client.post(`/pullzone/${pullZoneId}/setForceSSL`, { Hostname: hostname, ForceSSL: true });
  client.stdout.write(`Activated SSL for ${hostname} on pull zone ${pullZoneId}.\n`);
}

async function purgePullZoneCache(client, pullZoneId) {
  if (!pullZoneId) fail('Usage: pz purge <pullZoneId>');
  await client.post(`/pullzone/${pullZoneId}/purgeCache`);
  client.stdout.write(`Purged cache for pull zone ${pullZoneId}.\n`);
}

async function healthCheck(client, url, { fetchImpl = fetch } = {}) {
  if (!url) fail('Usage: health <url>');
  const target = url.startsWith('http') ? url : `https://${url}`;
  const start = Date.now();
  try {
    const response = await fetchImpl(target, { signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    client.stdout.write(`HTTP ${response.status} (${Date.now() - start}ms)\n`);
    client.stdout.write(`${body.slice(0, 200)}\n`);
  } catch (error) {
    fail(`Health check failed for ${target}: ${error.message}`);
  }
}

function showHelp(stdout = process.stdout) {
  stdout.write(`
DustBunny — Bunny.net operator CLI

App commands:
  apps
  app <id>
  app create <name> <namespace/name:tag> [registryId] [port] [envFile]
  app create-spec <spec.json>
  app delete <id>
  app spec <id>
  app image <id> <namespace/name:tag> [registryId]
  app scale <id> <min> <max>
  app apply <id> <spec.json>

Env commands:
  env sync <id> <file>             Replace env vars from .env or .json
  env merge <id> <file>            Merge env vars from .env or .json
  env unset <id> <key>

Endpoint commands:
  endpoint list <id>
  endpoint cdn <id> [port] [name]
  endpoint remove <id> <nameOrHost>

DNS commands:
  dns zones
  dns zone <zoneId>
  dns records <zoneId>
  dns set <zoneId> <name> <type> <value> [ttl]
  dns pullzone <zoneId> <name> <pullZoneId> [ttl]
  dns delete <zoneId> <recordId>

Pull zone commands:
  pz list
  pz create <name> <originUrl>
  pz origin <pullZoneId> <originUrl>
  pz hostname <pullZoneId> <hostname>
  pz ssl <pullZoneId> <hostname>
  pz purge <pullZoneId>

Wait:
  wait <id> [timeoutSec] [intervalSec]

Utility:
  health <url>

Config:
  Set BUNNY_API_KEY or configure ~/.config/bunnynet.json
`);
}

async function runCli(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout || process.stdout;
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    showHelp(stdout);
    return 0;
  }

  const client = options.client || createApiClient({
    env: options.env || process.env,
    config: options.config || loadConfig(),
    fetchImpl: options.fetchImpl || fetch,
    stdout,
  });

  const [command, ...args] = argv;

  if (command === 'apps') {
    await listApps(client);
    return 0;
  }

  if (command === 'app') {
    if (args[0] === 'create') {
      await createApp(client, args[1], args[2], args[3], args[4] || '3000', args[5]);
      return 0;
    }
    if (args[0] === 'create-spec') {
      await createAppFromSpec(client, args[1]);
      return 0;
    }
    if (args[0] === 'delete') {
      await deleteApp(client, args[1]);
      return 0;
    }
    if (args[0] === 'spec') {
      await exportAppSpec(client, args[1]);
      return 0;
    }
    if (args[0] === 'image') {
      await updateAppImage(client, args[1], args[2], args[3]);
      return 0;
    }
    if (args[0] === 'scale') {
      await scaleApp(client, args[1], args[2], args[3]);
      return 0;
    }
    if (args[0] === 'apply') {
      await applyAppSpec(client, args[1], args[2]);
      return 0;
    }
    await showApp(client, args[0], { json: args.includes('--json') });
    return 0;
  }

  if (command === 'env') {
    if (args[0] === 'sync') {
      await syncEnv(client, args[1], args[2], { merge: false });
      return 0;
    }
    if (args[0] === 'merge') {
      await syncEnv(client, args[1], args[2], { merge: true });
      return 0;
    }
    if (args[0] === 'unset') {
      await unsetEnv(client, args[1], args[2]);
      return 0;
    }
  }

  if (command === 'endpoint') {
    if (args[0] === 'list') {
      await listEndpoints(client, args[1]);
      return 0;
    }
    if (args[0] === 'cdn') {
      await addCdnEndpoint(client, args[1], args[2] || '3000', args[3]);
      return 0;
    }
    if (args[0] === 'remove') {
      await removeEndpoint(client, args[1], args[2]);
      return 0;
    }
  }

  if (command === 'wait') {
    await waitForApp(client, args[0], args[1] || '300', args[2] || '10', options.waitOptions);
    return 0;
  }

  if (command === 'dns') {
    if (args[0] === 'zones') {
      await listZones(client);
      return 0;
    }
    if (args[0] === 'zone') {
      await showZone(client, args[1]);
      return 0;
    }
    if (args[0] === 'records') {
      await listRecords(client, args[1]);
      return 0;
    }
    if (args[0] === 'set') {
      await setDnsRecord(client, args[1], args[2], args[3], args[4], args[5] || '300');
      return 0;
    }
    if (args[0] === 'pullzone') {
      await setPullZoneRecord(client, args[1], args[2], args[3], args[4] || '60');
      return 0;
    }
    if (args[0] === 'delete') {
      await deleteDnsRecord(client, args[1], args[2]);
      return 0;
    }
  }

  if (command === 'pz') {
    if (args[0] === 'list') {
      await listPullZones(client);
      return 0;
    }
    if (args[0] === 'create') {
      await createPullZone(client, args[1], args[2]);
      return 0;
    }
    if (args[0] === 'origin') {
      await updatePullZoneOrigin(client, args[1], args[2]);
      return 0;
    }
    if (args[0] === 'hostname') {
      await addPullZoneHostname(client, args[1], args[2]);
      return 0;
    }
    if (args[0] === 'ssl') {
      await activatePullZoneSsl(client, args[1], args[2]);
      return 0;
    }
    if (args[0] === 'purge') {
      await purgePullZoneCache(client, args[1]);
      return 0;
    }
  }

  if (command === 'health') {
    await healthCheck(client, args[0], { fetchImpl: options.fetchImpl || fetch });
    return 0;
  }

  fail(`Unsupported command: ${argv.join(' ')}`);
}

export {
  CliError,
  applyAppSpec,
  buildAppSpec,
  buildTemplatePatch,
  createApiClient,
  createApp,
  createAppFromSpec,
  createPullZone,
  dedupeEnvVars,
  deleteApp,
  healthCheck,
  listApps,
  listEndpoints,
  listPullZones,
  listRecords,
  listZones,
  loadConfig,
  loadEnvFile,
  mergeEnvVars,
  normalizeEndpoints,
  parseEnvText,
  parseImageRef,
  removeEnvVar,
  removeEndpoint,
  runCli,
  scaleApp,
  setDnsRecord,
  setPullZoneRecord,
  syncEnv,
  updateAppImage,
  waitForApp,
};

if (isDirectExecution()) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(error instanceof CliError ? 1 : 1);
  });
}
