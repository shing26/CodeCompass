import type { Harness, HarnessStatus } from './types';
import type { Storage } from './storage';

export class HarnessRegistry {
  constructor(private storage: Storage) {}

  register(harness: Omit<Harness, 'id'> & { id?: string }): Harness {
    const record = this.storage.addHarness(harness);
    return record;
  }

  setStatus(id: string, status: HarnessStatus) {
    const harnesses = this.storage.listHarnesses();
    const target = harnesses.find((h) => h.id === id);
    if (!target) return null;
    const updated = { ...target, status };
    return this.storage.addHarness(updated);
  }

  list() {
    return this.storage.listHarnesses();
  }

  get(id: string) {
    return this.storage.listHarnesses().find((h) => h.id === id) || null;
  }
}
