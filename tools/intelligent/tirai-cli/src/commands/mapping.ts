import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';

type MappingPlatform = 'api' | 'database';
type Mapping = { id?: string; method?: string; endpoint?: string; query?: string; readOnly?: boolean; approved?: boolean };

export async function runMappingValidate(opts: { cwd: string; inputPath: string; platform?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const platform = opts.platform as MappingPlatform | undefined;
  if (platform !== 'api' && platform !== 'database') throw new CliError('INVALID_TARGET', 'Use --platform api or --platform database.');
  const inputPath = path.resolve(opts.cwd, opts.inputPath);
  if (!fs.existsSync(inputPath)) throw new CliError('SOURCE_NOT_FOUND', `Mapping not found: ${inputPath}`);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch (error) { throw new CliError('CONFIG_INVALID', `Mapping is not valid JSON: ${String(error)}`); }
  const items = Array.isArray(raw) ? raw as Mapping[] : (raw as { mappings?: Mapping[] }).mappings;
  if (!Array.isArray(items) || items.length === 0) throw new CliError('CONFIG_INVALID', 'Mapping must contain a non-empty mappings array.');
  const errors: string[] = [];
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const label = `mappings[${index}]`;
    if (!item.id || ids.has(item.id)) errors.push(`${label}.id must be unique and non-empty`); else ids.add(item.id);
    if (platform === 'api') {
      if (!item.method || !item.endpoint) errors.push(`${label} requires method and endpoint`);
      if (item.endpoint && !/^https?:\/\//.test(item.endpoint) && !item.endpoint.startsWith('/')) errors.push(`${label}.endpoint must be an http(s) URL or path`);
    } else {
      if (!item.query || !item.readOnly) errors.push(`${label} requires a read-only query`);
      if (item.query && /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(item.query)) errors.push(`${label}.query contains a mutating SQL keyword`);
      if (item.approved !== true) errors.push(`${label}.approved must be true before database execution`);
    }
  });
  const result = { valid: errors.length === 0, platform, mappingPath: inputPath, count: items.length, errors };
  if (!result.valid) throw new CliError('CONFIG_INVALID', errors.join('; '));
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Mapping valid: ${items.length} ${platform} operation(s)`);
}
