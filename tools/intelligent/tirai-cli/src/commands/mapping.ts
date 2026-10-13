import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';

type MappingPlatform = 'api' | 'database';
interface Mapping { id?: string; method?: string; endpoint?: string; query?: string; readOnly?: boolean; approved?: boolean }

export function validateMappingItems(items: unknown[], platform: MappingPlatform): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  items.forEach((raw, index) => {
    const item = (raw ?? {}) as Mapping;
    const label = `mappings[${index}]`;
    if (!item.id || ids.has(item.id)) errors.push(`${label}.id must be unique and non-empty`); else ids.add(item.id);
    if (platform === 'api') {
      if (!item.method || !item.endpoint) errors.push(`${label} requires method and endpoint`);
      if (item.endpoint && !/^https?:\/\//.test(item.endpoint) && !item.endpoint.startsWith('/')) errors.push(`${label}.endpoint must be an http(s) URL or path`);
    } else {
      if (!item.query || !item.readOnly) errors.push(`${label} requires a read-only query`);
      if (item.query) {
        const sql = item.query.trim();
        // Fail-closed allowlist: a read-only mapping may only contain a single
        // SELECT-family statement. Anything else (CALL, EXEC, multi-statements,
        // comment smuggling) is rejected rather than keyword-denylisted.
        if (!/^(select|with|explain|values|show)\b/i.test(sql)) errors.push(`${label}.query must be a single read-only SELECT-family statement`);
        else if (/--|\/\*|\*\/|;(?!\s*$)/.test(sql)) errors.push(`${label}.query must be a single statement without comments or chained statements`);
      }
      if (item.approved !== true) errors.push(`${label}.approved must be true before database execution`);
    }
  });
  return errors;
}

export async function runMappingValidate(opts: { cwd: string; inputPath: string; platform?: string; json?: boolean }): Promise<void> {
  requireWorkspace(opts.cwd);
  const platform = opts.platform as MappingPlatform | undefined;
  if (platform !== 'api' && platform !== 'database') throw new CliError('INVALID_TARGET', 'Use --platform api or --platform database.');
  const inputPath = path.resolve(opts.cwd, opts.inputPath);
  if (!fs.existsSync(inputPath)) throw new CliError('SOURCE_NOT_FOUND', `Mapping not found: ${inputPath}`);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch (error) { throw new CliError('CONFIG_INVALID', `Mapping is not valid JSON: ${String(error)}`); }
  const items = Array.isArray(raw) ? raw as Mapping[] : (raw as { mappings?: Mapping[] }).mappings;
  if (!Array.isArray(items) || items.length === 0) throw new CliError('CONFIG_INVALID', 'Mapping must contain a non-empty mappings array.');
  const errors = validateMappingItems(items, platform);
  const result = { valid: errors.length === 0, platform, mappingPath: inputPath, count: items.length, errors };
  if (!result.valid) throw new CliError('CONFIG_INVALID', errors.join('; '));
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Mapping valid: ${items.length} ${platform} operation(s)`);
}
