import { safeStorage } from 'electron';
import type { MessageInput } from '../shared/ipc';
import { SecretValues } from './secret-values';

export function sealPrivate(value: unknown): string {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      'The system credential store is unavailable. Reconnect the agent to answer this secret question directly.',
    );
  return safeStorage.encryptString(JSON.stringify(value)).toString('base64');
}
export function openPrivate<T>(value: string): T {
  return JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))) as T;
}
interface PrivateText {
  text: string;
  secrets: string[];
}
/** A resumed secret answer is encrypted in the inbox and removed from Skaro logs/UI events. */
export class SessionSecrets extends SecretValues {
  input(input: MessageInput): MessageInput {
    if (!input.privateText) return input;
    const decoded = openPrivate<PrivateText>(input.privateText);
    this.remember(decoded.secrets);
    return { ...input, text: decoded.text, privateText: undefined };
  }
}
