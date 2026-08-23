// Config loader — reads and validates project adapter JSON config.
//
// Enforces path safety: config and catalog files must resolve under
// projectRoot. Rejects path traversal attempts.

import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type {
  ProjectAdapterSource,
  ProjectAdapterConfig,
} from './models.js';
import { ProjectAdapterError } from './errors.js';

const SUPPORTED_SCHEMA_VERSIONS = ['1.0'];

export async function loadConfig(
  source: ProjectAdapterSource,
): Promise<{ config: ProjectAdapterConfig; raw: string }> {
  const configPath = resolveConfigPath(source);
  const raw = await readFile(configPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectAdapterError(
      'PROJECT_CONFIG_INVALID',
      `Config file is not valid JSON: ${configPath}`,
      configPath,
    );
  }
  const config = validateConfigShape(parsed, configPath);
  return { config, raw };
}

export function resolveConfigPath(source: ProjectAdapterSource): string {
  const root = source.projectRoot;
  const configRel = source.configPath ?? 'tirai.project.json';
  const fullPath = isAbsolute(configRel) ? configRel : resolve(root, configRel);
  // Ensure the resolved path is within the project root.
  assertWithinRoot(fullPath, root);
  return fullPath;
}

export function assertWithinRoot(filePath: string, root: string): void {
  const resolvedPath = resolve(filePath);
  const rel = relative(root, resolvedPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ProjectAdapterError(
      'PROJECT_PATH_ESCAPE',
      `Path escapes project root: ${filePath}`,
      filePath,
    );
  }
}

export async function safeReadFile(
  filePath: string,
  root: string,
): Promise<string> {
  const resolved = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  assertWithinRoot(resolved, root);
  return readFile(resolved, 'utf-8');
}

function validateConfigShape(raw: unknown, path: string): ProjectAdapterConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectAdapterError(
      'PROJECT_CONFIG_INVALID',
      'Config root must be a JSON object',
      path,
    );
  }
  const obj = raw as Record<string, unknown>;
  // Schema version check.
  const sv = obj['schemaVersion'];
  if (typeof sv !== 'string' || !SUPPORTED_SCHEMA_VERSIONS.includes(sv)) {
    throw new ProjectAdapterError(
      'PROJECT_SCHEMA_UNSUPPORTED',
      `Unsupported schemaVersion: ${String(sv)}`,
      path,
    );
  }
  // Project identity.
  const proj = obj['project'];
  if (typeof proj !== 'object' || proj === null) {
    throw new ProjectAdapterError(
      'PROJECT_CONFIG_INVALID',
      'Missing or invalid "project" object',
      path,
    );
  }
  const p = proj as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || !p['id']) {
    throw new ProjectAdapterError(
      'PROJECT_CONFIG_INVALID',
      'project.id must be a non-empty string',
      path,
    );
  }
  if (typeof p['name'] !== 'string' || !p['name']) {
    throw new ProjectAdapterError(
      'PROJECT_CONFIG_INVALID',
      'project.name must be a non-empty string',
      path,
    );
  }
  return obj as unknown as ProjectAdapterConfig;
}

export function loadCatalogJson(
  raw: string,
  path: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectAdapterError(
      'PROJECT_CATALOG_INVALID',
      `Catalog file is not valid JSON: ${path}`,
      path,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProjectAdapterError(
      'PROJECT_CATALOG_INVALID',
      `Catalog root must be a JSON object: ${path}`,
      path,
    );
  }
  return parsed as Record<string, unknown>;
}
