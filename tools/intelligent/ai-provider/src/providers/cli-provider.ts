import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AIProvider } from '../provider.js';
import type { AIGenerationRequest, AIGenerationResponse, AIProviderCapabilities } from '../models.js';
import { AIProviderError, AIProviderErrorCode } from '../errors.js';

export interface CLIProviderConfig { command: string; model?: string; timeoutMs?: number; artifactDir?: string; }

/** Runs a local AI CLI using a JSON stdin/stdout protocol. */
export class CLIProvider implements AIProvider {
  readonly name = 'cli';
  readonly capabilities: AIProviderCapabilities = { structuredOutput: true, strictStructuredOutput: false, streaming: false };
  constructor(private readonly config: CLIProviderConfig) {
    if (!config.command?.trim()) throw new AIProviderError({ code: AIProviderErrorCode.CONFIG_ERROR, provider: this.name, message: 'CLI provider requires a command.' });
  }
  async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
    const [command, ...rawArgs] = this.config.command.trim().split(/\s+/);
    const stage = request.metadata?.tiraiStage ?? 'unknown-stage';
    const artifactDir = path.join(this.config.artifactDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-ai-')), stage);
    fs.mkdirSync(artifactDir, { recursive: true });
    const inputFile = path.join(artifactDir, 'request.json');
    const outputFile = path.join(artifactDir, 'response.json');
    const payload = JSON.stringify({ ...request, model: request.model ?? this.config.model });
    fs.writeFileSync(inputFile, `${payload}\n`, 'utf8');
    const args = rawArgs.map((arg) => arg.replaceAll('{input}', inputFile).replaceAll('{output}', outputFile));
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; let settled = false;
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new AIProviderError({ code: AIProviderErrorCode.TIMEOUT, provider: this.name, message: 'AI CLI timed out.' })); settled = true; }, this.config.timeoutMs ?? 120_000);
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      child.on('error', (error) => { if (!settled) { clearTimeout(timeout); reject(new AIProviderError({ code: AIProviderErrorCode.PROVIDER_UNAVAILABLE, provider: this.name, message: 'AI CLI could not start.', cause: error })); } });
      child.on('close', (code) => {
        if (settled) return; settled = true; clearTimeout(timeout);
        if (code !== 0) return reject(new AIProviderError({ code: AIProviderErrorCode.PROVIDER_UNAVAILABLE, provider: this.name, message: `AI CLI exited with code ${code}: ${stderr.slice(0, 500)}` }));
        try {
          const responseText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : stdout;
          fs.writeFileSync(path.join(artifactDir, 'result.json'), `${responseText}\n`, 'utf8');
          const data = JSON.parse(responseText) as T;
          resolve({ provider: this.name, model: request.model ?? this.config.model ?? 'cli-model', data, rawText: responseText });
        }
        catch (error) { reject(new AIProviderError({ code: AIProviderErrorCode.RESPONSE_PARSE_ERROR, provider: this.name, message: 'AI CLI returned invalid JSON.', cause: error })); }
      });
      child.stdin.end(payload);
    });
  }
}
