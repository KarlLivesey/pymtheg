export interface Runner {
  run(): void;
}
export class Base {
  start(): void {}
}
export class Job extends Base implements Runner {
  run(): void {
    this.start();
  }
}
export function format(value: string): string;
export function format(value: number): string;
export function format(value: string | number): string {
  return String(value);
}
export default function makeJob(): Job {
  return new Job();
}
