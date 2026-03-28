#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';

const REGISTRY_URL = 'https://registry.npmjs.org/%40bunny.net%2Fcli';
const DOC_PATH = resolve(process.cwd(), 'docs', 'API-MAPPING.md');

const EXPECTED_OFFICIAL_COMMANDS = [
  'login',
  'logout',
  'whoami',
  'config',
  'registries',
  'scripts',
  'db list',
  'db create',
  'db show',
  'db delete',
  'db regions list',
  'db regions add',
  'db regions remove',
  'db regions update',
  'db usage',
  'db quickstart',
  'db shell',
  'db tokens create',
  'db tokens invalidate',
];

function extractOfficialCommands(readme) {
  const commands = new Set();
  const regex = /`bunny ([^`]+)`/g;
  for (const match of readme.matchAll(regex)) {
    commands.add(match[1].trim());
  }
  return [...commands].sort();
}

function loadDocumentedOfficialMappings(markdown) {
  const commands = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/\| `([^`]+)` \| `bunny ([^`]+)` \|/);
    if (match) {
      commands.add(match[2].trim());
    }
  }
  return [...commands].sort();
}

function startsWithExpected(command, expected) {
  return command === expected || command.startsWith(`${expected} `);
}

const response = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
if (!response.ok) {
  console.error(`Failed to fetch ${REGISTRY_URL}: HTTP ${response.status}`);
  process.exit(1);
}

const pkg = await response.json();
const latestVersion = pkg['dist-tags']?.latest;
const latest = pkg.versions?.[latestVersion];
const readme = pkg.readme || latest?.readme;
if (!latestVersion || !readme) {
  console.error('Could not resolve latest official Bunny CLI metadata/readme from npm registry.');
  process.exit(1);
}

const officialCommands = extractOfficialCommands(readme);
const mappingDoc = readFileSync(DOC_PATH, 'utf8');
const documentedMappings = loadDocumentedOfficialMappings(mappingDoc);

const missingFromDocs = EXPECTED_OFFICIAL_COMMANDS.filter((expected) =>
  !documentedMappings.some((command) => startsWithExpected(command, expected)));

console.log(`Official Bunny CLI latest: ${latestVersion}`);
console.log(`Registry package: ${REGISTRY_URL}`);
console.log('');
console.log('Expected official command surface:');
for (const command of EXPECTED_OFFICIAL_COMMANDS) {
  console.log(`- ${command}`);
}
console.log('');
console.log('Documented official mappings in docs/API-MAPPING.md:');
for (const command of documentedMappings) {
  console.log(`- ${command}`);
}
console.log('');

if (missingFromDocs.length > 0) {
  console.error('Missing official mappings in docs/API-MAPPING.md:');
  for (const command of missingFromDocs) {
    console.error(`- ${command}`);
  }
  process.exit(2);
}

console.log('Official Bunny CLI command excerpts found in npm readme:');
for (const command of officialCommands.filter((command) =>
  EXPECTED_OFFICIAL_COMMANDS.some((expected) => startsWithExpected(command, expected)))) {
  console.log(`- ${command}`);
}
console.log('');
console.log('Official parity documentation check passed.');
