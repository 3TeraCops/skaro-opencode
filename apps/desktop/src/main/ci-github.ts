import { execFile } from 'node:child_process';
import { git } from '@skaro/core';

export interface GithubRun {
  id: number;
  status: string;
  conclusion: string | null;
  run_attempt: number;
  html_url: string;
  head_sha: string;
}

export function gh(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { cwd: root, windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    );
  });
}

/** Only the project's actual origin, never an arbitrary repository supplied by a tool caller. */
export async function githubRepository(root: string): Promise<string> {
  const origin = (await git(root, ['remote', 'get-url', 'origin'])).stdout.trim();
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
      origin,
    );
  if (!match) throw new Error('CI tracking requires a github.com origin and authenticated gh CLI');
  return match[1]!;
}

export async function githubRun(
  root: string,
  repository: string,
  runId: number,
): Promise<GithubRun> {
  const result = JSON.parse(
    await gh(root, ['api', `repos/${repository}/actions/runs/${runId}`]),
  ) as GithubRun;
  if (result.id !== runId || !result.head_sha || !Number.isSafeInteger(result.run_attempt))
    throw new Error('GitHub returned an invalid workflow run');
  return {
    id: result.id,
    status: result.status,
    conclusion: result.conclusion,
    run_attempt: result.run_attempt,
    html_url: result.html_url,
    head_sha: result.head_sha,
  };
}
