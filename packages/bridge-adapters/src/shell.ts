import { spawn, type ChildProcess } from 'node:child_process';
import type { HarnessStatus, Task } from '../../contracts/src/index';
import type { AdapterContext, BridgeAdapter } from './types';

interface ShellInput {
  command?: string;
  cwd?: string;
}

export class ShellAdapter implements BridgeAdapter {
  readonly type = 'shell' as const;
  private state: HarnessStatus = 'disconnected';
  private children = new Map<string, ChildProcess>();

  async connect(): Promise<void> {
    this.state = 'ready';
  }

  async disconnect(): Promise<void> {
    for (const child of this.children.values()) child.kill();
    this.children.clear();
    this.state = 'disconnected';
  }

  status(): HarnessStatus {
    return this.state;
  }

  async cancel(taskId: string): Promise<void> {
    const child = this.children.get(taskId);
    if (child) child.kill();
    this.children.delete(taskId);
  }

  async submit(task: Task, ctx: AdapterContext): Promise<void> {
    const input = (task.input ?? {}) as ShellInput;
    if (!input.command) {
      ctx.onFailed('shell task input.command is required');
      return;
    }

    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      env: process.env
    });
    this.children.set(task.id, child);

    child.stdout?.on('data', (chunk: Buffer) => {
      ctx.onLog('stdout', chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      ctx.onLog('stderr', chunk.toString());
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });
    this.children.delete(task.id);
    ctx.onToken(10, 0);
    if (exitCode === 0) {
      ctx.onDone({ exitCode, command: input.command });
    } else {
      ctx.onFailed(`command exited with code ${exitCode ?? 'null'}`);
    }
  }
}
