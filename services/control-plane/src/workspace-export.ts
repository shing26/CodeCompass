import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '../../../packages/contracts/src/index';
import type { Repos } from './repos';

export function exportWorkspace(
  repos: Repos,
  workspaceId: string,
  outputDir: string
): string {
  const workspace = repos.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);

  const bundleDir = path.join(outputDir, `workspace-${workspaceId}`);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, 'metadata.json'),
    JSON.stringify(
      {
        format: 'mhw-workspace-v1',
        workspace: { ...workspace, rootPath: undefined },
        exportedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(bundleDir, 'tasks.json'),
    JSON.stringify(
      repos.listTasks().filter((task) => task.workspaceId === workspaceId),
      null,
      2
    )
  );
  const lines: string[] = [];
  for (const task of repos.listTasks().filter((t) => t.workspaceId === workspaceId)) {
    for (const log of repos.listLogs(task.id)) {
      lines.push(JSON.stringify(log));
    }
  }
  fs.writeFileSync(path.join(bundleDir, 'logs.jsonl'), lines.join('\n'));
  return bundleDir;
}

export function importWorkspace(
  repos: Repos,
  bundleDir: string
): { workspaceId: string; tasks: number } {
  const metadataPath = path.join(bundleDir, 'metadata.json');
  const tasksPath = path.join(bundleDir, 'tasks.json');
  if (!fs.existsSync(metadataPath) || !fs.existsSync(tasksPath)) {
    throw new Error('Invalid workspace bundle: missing metadata.json or tasks.json');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
    format: string;
    workspace: {
      id: string;
      name: string;
      rootPath: string;
      createdAt: string;
      updatedAt: string;
    };
  };
  if (metadata.format !== 'mhw-workspace-v1') {
    throw new Error(`Unsupported bundle format: ${metadata.format}`);
  }
  const workspace = repos.getWorkspace(metadata.workspace.id);
  if (!workspace) {
    repos.createWorkspace({
      id: metadata.workspace.id,
      name: metadata.workspace.name,
      rootPath: metadata.workspace.rootPath ?? path.join(bundleDir, 'root')
    });
  }
  const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as Array<{
    id: string;
    workspaceId: string;
    type: string;
    status: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    assignedHarnessId?: string;
    createdAt: string;
    updatedAt: string;
    tokenUsage?: { input: number; output: number };
    durationMs?: number;
  }>;
  let imported = 0;
  for (const task of tasks) {
    if (repos.getTask(task.id)) continue;
    repos.insertTask({
      id: task.id,
      workspaceId: metadata.workspace.id,
      type: task.type as 'coding' | 'shell' | 'browser',
      status: task.status as Task['status'],
      input: task.input,
      output: task.output,
      assignedHarnessId: task.assignedHarnessId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      tokenUsage: task.tokenUsage ?? { input: 0, output: 0 },
      durationMs: task.durationMs
    });
    imported += 1;
  }
  return { workspaceId: metadata.workspace.id, tasks: imported };
}
