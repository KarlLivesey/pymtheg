// SPDX-License-Identifier: MIT
import type { ArchitectureDraft } from "./draft.js";
export interface DraftSnapshot {
  version: number;
  draft: ArchitectureDraft | null;
}
/** One request in flight, one latest queued value. Conflicts block writes but
 * never discard the latest local text. No clock participates in correctness. */
export class DraftWriter {
  private desired: { value: ArchitectureDraft | null } | null = null;
  private task: Promise<void> | null = null;
  private failure: Error | null = null;
  private local: ArchitectureDraft | null;
  constructor(
    private version: number,
    initial: ArchitectureDraft | null,
    private write: (
      version: number,
      draft: ArchitectureDraft | null,
    ) => Promise<DraftSnapshot>,
    private notify: (status: string, error: string) => void = () => {},
  ) {
    this.local = initial;
  }
  get value() {
    return this.local;
  }
  get pending() {
    return this.task !== null;
  }
  get blocked() {
    return this.failure !== null;
  }
  persist(value: ArchitectureDraft | null) {
    this.local = value;
    this.desired = { value };
    if (this.task || this.failure) return;
    this.notify("Saving draft…", "");
    this.task = Promise.resolve().then(() => this.drain());
  }
  private async drain() {
    try {
      while (this.desired && !this.failure) {
        const next = this.desired;
        this.desired = null;
        const saved = await this.write(this.version, next.value);
        this.version = saved.version;
      }
      this.notify("Draft saved for recovery", "");
    } catch (error) {
      this.failure = error instanceof Error ? error : Error(String(error));
      this.notify("Draft not saved", this.failure.message);
    } finally {
      this.task = null;
    }
  }
  async flush() {
    await this.task;
  }
  async clear() {
    if (this.failure)
      throw Error(
        "The recovery draft could not be cleared. Your local content is still available to download.",
      );
    const previous = this.local;
    this.persist(null);
    await this.flush();
    if (this.failure) {
      this.local = previous;
      throw Error(
        "The recovery draft could not be cleared. Your local content is still available to download.",
      );
    }
  }
  /** Called only after the design transaction is confirmed committed.
   * Recovery cleanup failure cannot turn that confirmed save into a failed save.
   * Keep the local copy until a reload successfully adopts current recovery data.
   */
  async finishCommitted(reload: () => void): Promise<string | null> {
    try {
      await this.clear();
      return null;
    } catch {
      reload();
      return "The design was saved, but recovery cleanup could not be confirmed. Review the current recovery data; your saved design remains available.";
    }
  }
}
