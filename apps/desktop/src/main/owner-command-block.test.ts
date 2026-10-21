import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { blockOwnerMessages, OwnerCommands } from './owner-commands';

it('rejects new messages while clearing and releases the owner lock after failure', () => {
  const db = AppDb.open(':memory:');
  const commands = new OwnerCommands(db, () => {
    throw new Error('No command may be accepted');
  });
  const unblock = blockOwnerMessages('project', 'chat');
  try {
    expect(() => commands.accept('chat.send', 'project', 'chat', { text: 'continue' })).toThrow(
      'being cleared',
    );
    expect(() => blockOwnerMessages('project', 'chat')).toThrow('being cleared');
    expect(db.commands.pending()).toEqual([]);
  } finally {
    unblock();
    db.close();
  }
  const next = blockOwnerMessages('project', 'chat');
  next();
});
