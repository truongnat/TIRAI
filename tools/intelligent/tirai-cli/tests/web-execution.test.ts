import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { executeApprovedWebCases } from '../src/commands/web-execution.js';
import { getWorkspacePaths } from '../src/workspace.js';

describe('approved web execution safety gates', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-web-execution-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects production before inspecting approvals or launching a browser', async () => {
    await expect(
      executeApprovedWebCases({
        paths: getWorkspacePaths(root),
        config: defaultConfig(root),
        environment: 'production',
        environmentConfig: { baseUrl: 'https://app.example.com' },
        testCases: [],
        selectedCaseIds: [],
        dedicatedTestTenantConfirmed: true,
      }),
    ).rejects.toThrow(/production/i);
  });

  it('rejects a production-like hostname even when it is labelled staging', async () => {
    await expect(
      executeApprovedWebCases({
        paths: getWorkspacePaths(root),
        config: defaultConfig(root),
        environment: 'staging',
        environmentConfig: { baseUrl: 'https://production.example.com' },
        testCases: [],
        selectedCaseIds: [],
        dedicatedTestTenantConfirmed: true,
      }),
    ).rejects.toThrow('production-like hostnames');
  });

  it('requires explicit dedicated-test-tenant confirmation before any browser work', async () => {
    await expect(
      executeApprovedWebCases({
        paths: getWorkspacePaths(root),
        config: defaultConfig(root),
        environment: 'staging',
        environmentConfig: { baseUrl: 'https://staging.example.com' },
        testCases: [],
        selectedCaseIds: ['TC-1'],
        dedicatedTestTenantConfirmed: false,
      }),
    ).rejects.toThrow('--confirm-dedicated-test-tenant');
  });
});
