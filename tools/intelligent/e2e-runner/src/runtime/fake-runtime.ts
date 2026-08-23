// Runtime managers — abstract project lifecycle (spec §49-51).
//
// FakeProjectRuntimeManager for acceptance testing. Real managed runtime
// requires explicit policy and is not default in v1.

import type { ProjectRuntimeManager, ProjectRuntimeState } from '../models.js';

export class FakeProjectRuntimeManager implements ProjectRuntimeManager {
  private state: ProjectRuntimeState = 'stopped';
  private startShouldFail: boolean;
  private readyDelay: number;

  constructor(opts?: { startShouldFail?: boolean; readyDelay?: number }) {
    this.startShouldFail = opts?.startShouldFail ?? false;
    this.readyDelay = opts?.readyDelay ?? 0;
  }

  async start(): Promise<ProjectRuntimeState> {
    if (this.startShouldFail) {
      this.state = 'error';
      return this.state;
    }
    this.state = 'starting';
    this.state = 'ready';
    return this.state;
  }

  async waitUntilReady(_timeoutMs?: number): Promise<ProjectRuntimeState> {
    return this.state;
  }

  async stop(): Promise<ProjectRuntimeState> {
    this.state = 'stopping';
    this.state = 'stopped';
    return this.state;
  }

  getState(): ProjectRuntimeState {
    return this.state;
  }
}
