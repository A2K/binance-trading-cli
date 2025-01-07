
import chalk from 'chalk';
import state from './state';
import { getStakedQuantity } from './autostaking';
import cache from 'memory-cache';
import { readTransactionLog } from './transactions';

export const clamp = (value: number, min: number = 0.0, max: number = 1.0): number => Math.min(max, Math.max(min, value));
export const lerp = (from: number, to: number, alpha: number): number => from * (1.0 - clamp(alpha)) + to * clamp(alpha);
export const lerpColor = (from: number[], to: number[], alpha: number): number[] => [0, 1, 2].map(i => lerp(from[i], to[i], clamp(alpha)));
export const lerpChalk = (from: number[], to: number[], alpha: number): chalk.Chalk => { const v = lerpColor(from, to, alpha); return chalk.rgb(v[0], v[1], v[2]); };
export const bgLerp = (from: number[], to: number[], alpha: number): chalk.Chalk => { const v = lerpColor(from, to, alpha); return chalk.bgRgb(v[0], v[1], v[2]); };

export function timestampStr(date: Date = new Date()): string {
  return date.toLocaleDateString("uk-UA", {
      year: 'numeric',
      month: 'numeric',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone
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
    return await state.wallet.total(asset) + stakedQuantity * coef;
  }
  return await state.wallet.total(asset) + stakedQuantity;
}

export function formatAssetQuantity(asset: string, quantity: number): string {
  const precision = 10; /*(asset in state.assets)
    ? clamp(Math.ceil(Math.log10(1.0 / state.assets[asset].stepSize)), 0, 8)
    : 8 /* default */;
  const step1 = trimTrailingZeroes((quantity || 0).toFixed(precision + 1).slice(0, -2));
  if (step1.endsWith('9999')) {
    const lastDigit = step1.replace(/^.*\..*([^9])9+$/, "$1");
    const firstPart = step1.replace(/^(.*\..*)[^9]9+$/, "$1");
    return firstPart + parseInt(lastDigit) + 1;
  }
  return step1.replace(/\.0$/, '');
}

export function marketCeil(asset: string, quantity: number): number {
  const { stepSize, minNotional } = state.assets[asset];
  return Math.max(minNotional, Math.ceil(quantity / stepSize) * stepSize);
}

export function marketRound(asset: string, quantity: number): number {
  const { stepSize } = state.assets[asset];
  return Math.round(quantity / stepSize) * stepSize;
}

export function limitIndicator(width: number, value: number) {
  const index = Math.floor(value * width);
  return '▁▂▃▄▅▆▇█'[index] + '_'.repeat(width - index - 1);
}

export function progressBar(limit: { current: number, max: number }, width: number = 10, fgColor=[0, 255, 0], bgColor=[0, 100, 0]): string {
  const symbols = ['▉', '▊', '▋', '▌', '▍', '▎', '▏', ' '];
  const fraction = limit.current / limit.max;
  const fg = chalk.rgb(fgColor[0], fgColor[1], fgColor[2]);
  const fgbg = chalk.bgRgb(fgColor[0], fgColor[1], fgColor[2]);
  const bg = chalk.bgRgb(bgColor[0], bgColor[1], bgColor[2]);
  return fg(fgbg(symbols[0].repeat(Math.floor(fraction * width)))) +
      fg(bg(fraction >= 1.0 ? '' : symbols[Math.round((1.0 - width * fraction % 1) * (symbols.length - 1))])) +
      bg(symbols[symbols.length - 1].repeat(Math.max(0, width - 1 - Math.floor(fraction * width))));
}

export function verticalBar(limit: { current: number, max: number }): string {
  const symbols = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return symbols[limit.max === 0 ? 0 : Math.floor(clamp(limit.current / limit.max) * (symbols.length - 1))];
}

export function progressBarText(limit: { current: number, max: number }, width: number = 10, text: string, color=[255, 255, 255], bgColor=[100, 100, 100], textColor=[255, 255, 255], invTextColor=[0, 0, 0]) {
  const symbols = ['▉', '▊', '▋', '▌', '▍', '▎', '▏', ' '];
  const fraction = clamp(limit.current / limit.max);
  const fg = chalk.rgb(color[0], color[1], color[2]);
  const fgbg = chalk.bgRgb(color[0], color[1], color[2]);
  const bg = chalk.bgRgb(bgColor[0], bgColor[1], bgColor[2]);

  const fgText = chalk.rgb(textColor[0], textColor[1], textColor[2]);
  const fgTextInv = chalk.rgb(invTextColor[0], invTextColor[1], invTextColor[2]);

  if (text.length < width * fraction) {
      return fgTextInv(fgbg(text)) + fg(fgbg(symbols[0].repeat(Math.floor(fraction * width) - text.length))) +
          fg(bg(fraction >= 1.0 ? '' : symbols[Math.round((1.0 - width * fraction % 1) * (symbols.length - 1))])) +
          bg(symbols[symbols.length - 1].repeat(Math.max(0, width - 1 - Math.floor(fraction * width))));
  }

  return fgTextInv(fgbg(text.slice(0, Math.round(width * fraction)))) + fgText(bg(text.slice(Math.round(width * fraction))))
      + bg(symbols[symbols.length - 1].repeat(Math.max(0, width - text.length)));
}
export function trimTrailingZeroes(value: string): string {
  return value.replace(/(\.\d+)(?<!0)0+/, '$1').replace(/(.*\.0)0+$/, "$1");
}

export function circleIndicator(limit = { current: 0, max: 1 }, colorA = [255, 0, 0], colorB = [0, 255, 0]): string {
  const symbols = ['○', '◔', '◑', '◕', '●'];
  const fraction = clamp(limit.current / limit.max);
  return lerpChalk(colorA, colorB, fraction)(symbols[Math.round((symbols.length - 1) * fraction)]);
}

export const getAvgBuyPrice = async (symbol: string): Promise<number> => {
  const transactions = (await readTransactionLog(symbol, undefined)).reverse();
  var currentAvg = 0;
  var currentSum = 0;
  for (const transaction of transactions) {
      if (transaction.isBuyer) {
          const ratio = clamp(Math.abs(transaction.quantity) / (Math.abs(currentSum) + Math.abs(transaction.quantity)));
          currentAvg = currentAvg * (1.0 - ratio) + parseFloat(transaction.price) * ratio;
          currentSum += transaction.quantity;
      } else {
          currentSum -= transaction.quantity;
      }
  }
  return currentAvg;
}
