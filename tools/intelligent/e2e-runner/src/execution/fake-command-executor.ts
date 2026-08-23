// Fake project command executor (spec §44-47).
//
// For v1 acceptance: no real process execution. Validates commands against
// the profile's declared command catalog and returns fake results.

import type {
  ProjectCommandExecutor,
  ProjectCommandDefinition,
  ProjectCommandResult,
  ProjectCommandCatalog,
  RunnerBlocker,
} from '../models.js';

export class FakeProjectCommandExecutor implements ProjectCommandExecutor {
  private catalog: ProjectCommandCatalog;
  private executed: string[] = [];

  constructor(catalog: ProjectCommandCatalog) {
    this.catalog = catalog;
  }

  validate(command: ProjectCommandDefinition): RunnerBlocker | null {
    const found = this.catalog.commands.find((c) => c.id === command.id);
    if (!found) {
      return {
        code: 'RUNNER_RESOURCE_DENIED',
        message: `Command "${command.id}" not declared in project profile`,
        path: `commands.${command.id}`,
      };
    }
    return null;
  }

  async execute(command: ProjectCommandDefinition): Promise<ProjectCommandResult> {
    this.executed.push(command.id);
    return {
      commandId: command.id,
      exitCode: 0,
      stdout: `[fake] ${command.command} ${command.args.join(' ')}`,
      stderr: '',
      durationMs: 0,
    };
  }

  async terminate(): Promise<void> {
    // No-op for fake executor.
  }

  getExecutedCommands(): string[] {
    return [...this.executed];
  }
}
