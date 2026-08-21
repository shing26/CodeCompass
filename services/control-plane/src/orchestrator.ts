import { randomUUID } from 'node:crypto';
import type { Task, TaskStatus } from '../../../packages/contracts/src/index';
import type { Repos } from './repos';

export type TaskAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'approve'
  | 'reject';

export class Orchestrator {
  constructor(private repos: Repos) {}

  createTask(args: {
    workspaceId: string;
    type: Task['type'];
    input: Task['input'];
    requiresApproval?: boolean;
  }): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      workspaceId: args.workspaceId,
      type: args.type,
      status: 'pending',
      input: args.input,
      requiresApproval: args.requiresApproval ?? false,
      createdAt: now,
      updatedAt: now,
      tokenUsage: { input: 0, output: 0 }
    };
    this.repos.insertTask(task);
    return task;
  }

  private patch(
    taskId: string,
    patch: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>
  ): Task | null {
    const current = this.repos.getTask(taskId);
    if (!current) return null;
    const next: Task = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.repos.updateTask(next);
    return next;
  }

  assign(taskId: string, harnessId: string) {
    return this.patch(taskId, { status: 'assigned', assignedHarnessId: harnessId });
  }

  run(taskId: string, harnessId?: string) {
    const task = this.patch(taskId, { status: 'running', assignedHarnessId: harnessId });
    return task;
  }

  pause(taskId: string) {
    return this.patch(taskId, { status: 'paused' });
  }

  resume(taskId: string) {
    return this.patch(taskId, { status: 'running' });
  }

  approve(taskId: string, approved: boolean) {
    const next: TaskStatus = approved ? 'running' : 'cancelled';
    return this.patch(taskId, { status: next });
  }

  complete(taskId: string, output: Task['output'], tokenUsage: { input: number; output: number }, durationMs: number) {
    const task = this.patch(taskId, {
      status: 'done',
      output,
      tokenUsage,
      durationMs,
    });
    return task;
  }

  fail(taskId: string, output?: Task['output']) {
    return this.patch(taskId, { status: 'failed', output });
  }

  cancel(taskId: string) {
    return this.patch(taskId, { status: 'cancelled' });
  }

  async action(
    taskId: string,
    action: TaskAction,
    approved?: boolean
  ) {
    switch (action) {
      case 'pause':
        return this.pause(taskId);
      case 'resume':
        return this.resume(taskId);
      case 'cancel':
        return this.cancel(taskId);
      case 'approve':
        return this.approve(taskId, approved ?? true);
      case 'reject':
        return this.approve(taskId, false);
    }
  }
}
