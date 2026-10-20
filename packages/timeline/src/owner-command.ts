/** Durable owner input shared by the process boundary; contains no native runtime dependencies. */
export interface OwnerCommand {
  id: string;
  owner: string;
  method: string;
  args: unknown[];
  state: 'accepted' | 'delivering' | 'delivered' | 'failed' | 'uncertain' | 'cancelled';
  error?: string;
}
