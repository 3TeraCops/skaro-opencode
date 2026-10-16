export interface IntegrationCheck {
  name: string;
  run: string;
  shell?: 'system' | 'powershell';
  /** Exact saved command to replace, only in verify_integration. */
  replaces?: string;
}

export function verificationCheckSchema(replacements = false) {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      run: { type: 'string' },
      shell: {
        type: 'string',
        enum: ['system', 'powershell'],
        description:
          'Default system shell is cmd.exe on Windows. Select powershell for PowerShell syntax.',
      },
      ...(replacements
        ? {
            replaces: {
              type: 'string',
              description:
                'Exact saved run command to replace while preserving its behavior coverage and name.',
            },
          }
        : {}),
    },
    required: ['name', 'run'],
    additionalProperties: false,
  };
}

/** Persist executable evidence rather than attempting to parse command names out of prose. */
export function readVerificationPlan(
  value: unknown,
  replacements = false,
): IntegrationCheck[] | string {
  if (!Array.isArray(value) || !value.length) return 'Provide at least one verification command.';
  const checks: IntegrationCheck[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return 'Each verification check needs name and run.';
    const check = raw as Record<string, unknown>;
    if (
      typeof check['name'] !== 'string' ||
      !check['name'].trim() ||
      typeof check['run'] !== 'string' ||
      !check['run'].trim()
    )
      return 'Each verification check needs non-empty name and run.';
    const shell = check['shell'];
    if (shell !== undefined && shell !== 'system' && shell !== 'powershell')
      return 'Check shell must be system or powershell.';
    const replaces = check['replaces'];
    if (
      replaces !== undefined &&
      (!replacements || typeof replaces !== 'string' || !replaces.trim())
    )
      return 'Only verify_integration accepts a non-empty replaces command.';
    checks.push({
      name: check['name'].trim(),
      run: check['run'].trim(),
      ...(shell ? { shell } : {}),
      ...(typeof replaces === 'string' ? { replaces: replaces.trim() } : {}),
    });
  }
  return checks;
}
