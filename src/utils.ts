
import chalk from 'chalk';

export const clamp = (value: number, min: number = 0.0, max: number = 1.0): number => Math.min(max, Math.max(min, value));
export const lerp = (from: number, to: number, alpha: number): number => Math.round(from * (1.0 - clamp(alpha)) + to * clamp(alpha));
export const lerpColor = (from: number[], to: number[], alpha: number): number[] => [0, 1, 2].map(i => lerp(from[i], to[i], clamp(alpha)));
export const lerpChalk = (from: number[], to: number[], alpha: number): chalk.Chalk => { const v = lerpColor(from, to, alpha); return chalk.rgb(v[0], v[1], v[2]); };
export const bgLerp = (from: number[], to: number[], alpha: number): chalk.Chalk => { const v = lerpColor(from, to, alpha); return chalk.bgRgb(v[0], v[1], v[2]); };

export function timestampStr(): string {
  return new Date().toLocaleDateString("uk-UA", {
      year: 'numeric',
      month: 'numeric',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
}

export function formatFloat(number: number, n: number = 2): number {
  return parseFloat(number.toFixed(n));
}

export class DelayedExecution {
  private timeout?: NodeJS.Timer;

  constructor(private readonly delay: number, private readonly callback: () => void) { }

  public execute(): void {
      if (this.timeout) {
          clearTimeout(this.timeout);
      }
      this.timeout = setTimeout(this.callback, this.delay);
  }
}