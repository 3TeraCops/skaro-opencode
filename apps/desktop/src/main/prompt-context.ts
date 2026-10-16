import type { ProjectArtifacts } from '@skaro/core';

export const LANGUAGES: Record<string, string> = { ru: 'Russian', en: 'English' };

/** Skaro's own words in the user's language, as the interface names them (owner decisions). */
const TERMS: Record<string, string> = {
  ru:
    "- Use the terms of Skaro's interface: a milestone is «этап» (never «веха»), a task is " +
    '«задача», a specification is «спецификация», a brief is «бриф», the architecture is ' +
    '«архитектура», an ADR is «ADR».',
};

export function terms(locale: string): string[] {
  const rule = TERMS[locale];
  return rule ? [rule] : [];
}

/** The user's instructions: app-wide ("Настройки") first, then the project's own. */
export function instructionsOf(artifacts: ProjectArtifacts): string {
  const all = [artifacts.config.globalInstructions, artifacts.config.agentInstructions]
    .map((text) => text?.trim())
    .filter(Boolean);
  return all.length ? `## Project instructions\n\n${all.join('\n\n')}` : '';
}
