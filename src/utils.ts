
import chalk from 'chalk';
import state from './state';
import { getStakedQuantity } from './autostaking';
import cache from 'memory-cache';

export const clamp = (value: number, min: number = 0.0, max: number = 1.0): number => Math.min(max, Math.max(min, value));
export const lerp = (from: number, to: number, alpha: number): number => from * (1.0 - clamp(alpha)) + to * clamp(alpha);
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

export async function getAssetBallance(asset: string): Promise<number> {
  const stakedQuantity = await getStakedQuantity(asset);
  if (asset === 'SOL') {
    const coef = 'BNSOL' in state.assets && 'SOL' in state.assets
      ? state.assets['BNSOL'].price / state.assets['SOL'].price : 1.0;
    return (state.balances[asset] || 0) + stakedQuantity * coef;
  }
  return (state.balances[asset] || 0) + stakedQuantity;
}

export function formatAssetQuantity(asset: string, quantity: number): string {
  return quantity.toFixed(Math.max(0, !(asset in state.assets) || typeof(state.assets[asset].stepSize) !== 'number' || state.assets[asset].stepSize === 0 ? 8 : Math.log10(1.0 / state.assets[asset].stepSize)));
}

export function marketCeil(asset: string, quantity: number): number {
  const { stepSize, minNotional } = state.assets[asset];
  return Math.max(minNotional, Math.ceil(quantity / stepSize) * stepSize);
}

export function marketRound(asset: string, quantity: number): number {
  const { stepSize } = state.assets[asset];
  return Math.round(quantity / stepSize) * stepSize;
}