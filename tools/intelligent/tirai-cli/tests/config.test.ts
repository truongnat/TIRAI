import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.js';
import { validateAIProviderConfig } from '../src/config.js';

describe('AI provider configuration', () => {
  it('accepts an artifact-first CLI command', () => {
    expect(() => validateAIProviderConfig({
      provider: 'cli', command: 'agent --input {input} --output {output}',
    })).not.toThrow();
  });

  it('rejects a CLI command without both artifact placeholders', () => {
    expect(() => validateAIProviderConfig({
      provider: 'cli', command: 'agent --input {input}',
    })).toThrowError(CliError);
    expect(() => validateAIProviderConfig({
      provider: 'cli', command: 'agent --output {output}',
    })).toThrow(/both \{input\} and \{output\}/);
  });
});
