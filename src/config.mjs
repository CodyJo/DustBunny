import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const CONFIG_PATH = resolve(process.env.HOME || '', '.config/bunnynet.json');
export const API_BASE = 'https://api.bunny.net';
export const DATABASE_API_BASE = 'https://api.bunny.net/database';
export const DATABASE_PRIVATE_SPEC_URL = 'https://api.bunny.net/database/docs/private/api.json';
export const DEFAULT_SPEC_CACHE_PATH = resolve(process.env.HOME || '', '.cache/bunny-cli/bunny-database-private-api.json');

export class CliError extends Error {}

export function fail(message) {
  throw new CliError(message);
}

export function loadConfig(configPath = CONFIG_PATH) {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new CliError(`Failed to parse ${configPath}: ${error.message}`);
  }
}

export function getApiKey({ env = process.env, config = loadConfig() } = {}) {
  return env.BUNNY_API_KEY || config.profiles?.default?.api_key || null;
}

export function getDatabaseAccessKey({ env = process.env, config = loadConfig(), apiKey = getApiKey({ env, config }) } = {}) {
  return env.BUNNY_DB_ACCESS_KEY || config.profiles?.default?.db_access_key || apiKey || null;
}

export function getDatabaseBearerToken({ env = process.env, config = loadConfig() } = {}) {
  return env.BUNNY_DB_BEARER_TOKEN || config.profiles?.default?.db_bearer_token || null;
}

export function getDatabaseSpecCachePath({ env = process.env, config = loadConfig() } = {}) {
  return env.BUNNY_DB_SPEC_CACHE || config.profiles?.default?.db_spec_cache || DEFAULT_SPEC_CACHE_PATH;
}
