import { expect, it } from 'vitest';
import { runShell } from '@skaro/core';
import { readChecks } from '../../../../packages/core/src/artifacts/checks';
import type { ArtifactProblem } from '@skaro/core';

it('runs real PowerShell variables, pipelines and splatting with UTF-8 output', async () => {
  let output = '';
  await runShell(
    '$templateLintFiles = Get-ChildItem packages/core/src/environment/*.ts | ForEach-Object { $_.Name }; ' +
      "$arguments = @('-e', 'console.log(process.argv.slice(1))') + $templateLintFiles; " +
      "node @arguments; Write-Output 'Проверка оболочки'",
    {
      cwd: process.cwd(),
      shell: 'powershell',
      output: (text) => {
        output = text;
      },
    },
  );
  expect(output).toContain('run.ts');
  expect(output).toContain('check-command.ts');
  expect(output).toContain('Проверка оболочки');
}, 15_000);

it('propagates real native and PowerShell failures instead of accepting exit zero', async () => {
  await expect(
    runShell('node -e "console.error(\'native failure\');process.exit(7)"', {
      cwd: process.cwd(),
      shell: 'powershell',
      label: 'Native check',
    }),
  ).rejects.toThrow('Native check: exit 7\nnative failure');
  await expect(
    runShell("throw 'PowerShell failure'", {
      cwd: process.cwd(),
      shell: 'powershell',
      label: 'Script check',
    }),
  ).rejects.toThrow('PowerShell failure');
}, 15_000);

it('preserves platform-shell commands and their exit codes', async () => {
  let output = '';
  await runShell('node -e "console.log(\'system shell\')"', {
    cwd: process.cwd(),
    output: (text) => {
      output = text;
    },
  });
  expect(output.trim()).toBe('system shell');
  await expect(runShell('node -e "process.exit(9)"', { cwd: process.cwd() })).rejects.toThrow(
    'exit 9',
  );
});

it('preserves explicit shells in project config and rejects unsupported values', () => {
  const problems: ArtifactProblem[] = [];
  const check = { name: 'Ruff', run: '$files = Get-ChildItem *.py', shell: 'powershell' };
  expect(readChecks([check], problems)).toEqual([check]);
  expect(problems).toEqual([]);
  expect(readChecks([{ ...check, shell: 'unknown' }], problems)).toEqual([]);
  expect(problems).toHaveLength(1);
});
