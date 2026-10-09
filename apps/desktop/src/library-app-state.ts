import { navigationBlocked } from './library-write-guard.ts';

export class LibraryNavigation {
  private generation = 0;
  accept(busy: boolean, synchronousBusy: boolean, pending: unknown, completedWrite = false): number | null {
    if (!completedWrite && navigationBlocked(busy, synchronousBusy, pending)) return null;
    return ++this.generation;
  }
}
export class LatestProfileRefresh {
  private sequence = 0;
  invalidate() { this.sequence++; }
  async run<T>(profile: string, identity: () => string, load: () => Promise<T>, apply: (value: T) => void, fail: (error: Error) => void) {
    const sequence = ++this.sequence;
    const current = () => identity() === profile && sequence === this.sequence;
    try {
      const value = await load();
      if (current()) apply(value);
    } catch (error) {
      if (current()) fail(error as Error);
    }
  }
}
