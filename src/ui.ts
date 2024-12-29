
import chalk from 'chalk';
import state from './state';
import Settings from './settings';
import readline from 'readline';
import candles from './candles';
import { bgLerp, lerpColor, lerpChalk, clamp, formatFloat } from './utils';
import { readProfits } from './transactions';
import { CandleChartInterval_LT } from 'binance-api-node';

var logMessages: string[] = [];

export const addLogMessage = (...msgs: any[]): void => {
    logMessages.push(msgs.map(msg => msg ? msg.toString() : '' + msg).join(' '));
    while (logMessages.length > (process.stdout.rows || 80) - Object.keys(state.currencies).length - 1) {
        logMessages.shift();
    }
    printTrades();
}

export const colorizeDeltaUsd = (symbol: string, delta: number): string => {
    let deltaStr: string = ((delta < 0 ? '-' : '+') + Math.abs(delta).toFixed(2)).padEnd(10);
    const fraction: number = Math.abs(state.deltas[symbol] || 0) / Object.keys(state.currencies).map(c => state.deltas[c] || 0).reduce((acc, d) => Math.max(acc, Math.abs(d)), 0);
    const c1: number = state.selectedRow === Object.keys(state.currencies).sort().indexOf(symbol) ? 150 : 100;
    const c2: number = state.selectedRow === Object.keys(state.currencies).sort().indexOf(symbol) ? 100 : (delta > 0 ? 50 : 25);
    deltaStr = chalk.bgRgb(delta < 0 ? c1 : 0, delta >= 0 ? c1 : 0, 0)(deltaStr.substring(0, Math.round(fraction * deltaStr.length)))
        + chalk.bgRgb(delta < 0 ? c2 : 0, delta >= 0 ? c2 : 0, 0)(deltaStr.substring(Math.round(fraction * deltaStr.length)));

    return chalk.white(deltaStr.padEnd(10));
}

export const makeVelocitySymbol = (velocity: number): string => {
    velocity = velocity * 10000;
    if (Math.abs(velocity) < 0.1) {
        return chalk.white(' ⡇');
    }
    const positive: string[] = ['⠈', '⠘', '⠸', '⢸', '⢸'];
    const positiveNeg: string[] = ['⡆', '⡄', '⡀', ' ', ' '];
    const negative: string[] = ['⡀', '⡄', '⡆', '⡇', '⡇'];
    const negativePos: string[] = ['⠸', '⠘', '⠈', ' ', ' '];

    const index: number = Math.min(Math.floor(Math.abs(velocity)), positive.length - 2);
    if (velocity < 0) {
        return chalk.white(velocity >= 0 ? positiveNeg[index] : negativePos[index])
            + (velocity >= 0.0 ? chalk.green : chalk.red)(velocity >= 0 ? positive[index] : negative[index]);
    }
    return (velocity >= 0.0 ? chalk.green : chalk.red)(velocity >= 0 ? positive[index] : negative[index])
        + chalk.white(velocity >= 0 ? positiveNeg[index] : negativePos[index]);
}

export const colorizeSymbolProfit = async (symbol: string, delta: number): Promise<string> => {
    const alpha: number = 'showTradeFrames' in state.symbols[symbol] ? state.symbols[symbol].showTradeFrames / 10 : 0;

    let deltaStr: string = ((delta < 0 ? '-' : '+') + (Math.abs(delta).toFixed(2))).padEnd(10);
    const maxDeltaProfit: number = (await Promise.all(Object.keys(state.currencies).map(async c => readProfits(c)))).reduce((acc, profit) => Math.max(acc, Math.abs(profit)), 0);
    const fraction: number = Math.abs(delta / maxDeltaProfit);
    const colors = {
        active: 100,
        inactive: 25
    };
    const colorLeft: number = colors.active * (Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow ? 2 : 1.0);
    const colorRight: number = colors.inactive * (Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow ? 2 : 1.0);
    deltaStr = chalk.bgRgb(delta < 0 ? colorLeft : 0, delta >= 0 ? colorLeft : 0, 0)(deltaStr.substring(0, Math.round(fraction * deltaStr.length)))
        + chalk.bgRgb(delta < 0 ? colorRight : 0, delta >= 0 ? colorRight : 0, 0)(deltaStr.substring(Math.round(fraction * deltaStr.length)));

    const m: number = Math.round(225 * (1.0 - alpha) + 255 * alpha);
    return chalk.rgb(m, m, m)(deltaStr);
}

function colorizeChangedPart(symbol: string, prev: number, next: number, padding: number = 14): string {
    let fullDigits: number = Math.ceil(Math.log10(Math.ceil(next)));
    if (fullDigits <= 0) {
        fullDigits = 1;
    }

    const precision: number = padding - 1;
    const prevStr = parseFloat(prev.toPrecision(precision)).toPrecision(precision).padEnd(padding - 1, '0');
    var nextStr = parseFloat(next.toPrecision(precision)).toPrecision(precision).padEnd(padding - 1, '0');
    let diffIndex: number = -1;
    for (let i = 0; i < Math.min(prevStr.length, nextStr.length); i++) {
        if (prevStr[i] !== nextStr[i]) {
            diffIndex = i;
            break;
        }
    }

    nextStr = nextStr.substring(0, Math.max(nextStr.replace(/(\.\d+)(?<!0)0+/, '$1').length, diffIndex + 1));

    let v: number = (state.velocities[symbol] || 0) * 10000.0 * 0.25;
    let colorIdle: number[] = [185, 185, 185];
    let color: number[] = v === 0 ? colorIdle
        : (v > 0 ? lerpColor(colorIdle, [0, 255, 0], v) : lerpColor(colorIdle, [255, 0, 0], -v));

    const c: chalk.Chalk = v === 0 ? chalk.white : chalk.rgb(color[0], color[1], color[2]);

    if (prevStr === nextStr || diffIndex === -1) {
        return c(nextStr) + ' '.repeat(Math.max(0, padding - nextStr.length));
    }

    return c(nextStr.substring(0, diffIndex)) +
        (prevStr < nextStr ? chalk.greenBright(nextStr[diffIndex]) : chalk.redBright(nextStr[diffIndex])) +
        (prevStr < nextStr ? chalk.green(nextStr.substring(diffIndex + 1)) :
            chalk.red(nextStr.substring(diffIndex + 1))) + ' '.repeat(Math.max(0, padding - nextStr.length));
}

export async function printSymbol(symbol: string): Promise<void> {

    if (!(symbol in state.symbols)) {
        return;
    }

    const timestamp: string = new Date().toLocaleDateString("uk-UA", {
        year: 'numeric',
        month: 'numeric',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    let deltaPrice: number = state.symbols[symbol].deltaPrice || 0;
    const relativeDeltaPrice: number = deltaPrice / (state.symbols[symbol].price || 1);

    const symbolProfit: number = await readProfits(`${symbol}${Settings.stableCoin}`, '1 week');

    const relativePriceColor: chalk.Chalk = chalk.rgb(relativeDeltaPrice < 0 ?
        Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, relativeDeltaPrice * 500)) || 0)) :
        0,
        relativeDeltaPrice < 0 ? 0 :
            Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, -relativeDeltaPrice * 500)) || 0)),
        0);

    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;
    const total: number = Object.keys(state.currencies).reduce((acc, symbol) => acc + state.currencies[symbol], 0);
    const max: number = Object.keys(state.currencies).reduce((acc, symbol) => Math.max(acc, state.currencies[symbol] / total), 0);
    const fraction: number = Math.pow(state.currencies[symbol] / total / max, 1.0 / Math.E);

    let str: string = `${(Math.round(state.currencies[symbol]) + '').padEnd(10)}`;
    const m: number = isSelected ? 2 : 1;
    str = chalk.bgRgb(10 * m, 50 * m, 120 * m)(chalk.rgb(210, 210, 210)(str.substring(0, Math.round(fraction * str.length)))) +
        chalk.bgRgb(0 * m, 0 * m, 25 * m)(str.substring(Math.round(fraction * str.length)));

    const deltaUsd: number = state.deltas[symbol] || 0;
    const PNL: number = await readProfits(`${symbol}${Settings.stableCoin}`) + state.balances[symbol] * state.symbols[symbol].price;
    //   state.symbols[symbol].pnl = PNL;
    state.symbols[symbol].statusLine = `📈 ${Settings.showTime ? timestamp : ''} ${symbol.padEnd(8)} ${makeVelocitySymbol((state.velocities[symbol] || 0))}` +

        `${colorizeChangedPart(symbol, state.symbols[symbol].price - deltaPrice, state.symbols[symbol].price, 14)}` +

        str +

        ` ${(deltaUsd < 0 ? (-deltaUsd > state.symbols[symbol].sellThreshold ? chalk.greenBright : chalk.green) :
            (deltaUsd > state.symbols[symbol].buyThreshold ? chalk.redBright : chalk.red))(colorizeDeltaUsd(symbol, -deltaUsd))} ` +
        await colorizeSymbolProfit(symbol, symbolProfit) + ' ' +
        (state.symbols[symbol].enableSell ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(
            `${state.symbols[symbol].enableSell ? '🟢' : '🟥'}` +
            `${chalk.green(state.symbols[symbol].sellThreshold.toFixed(0).padEnd(4))}` +
            `${state.symbols[symbol].enableBuy ? '🟢' : '🟥'}` +
            `${chalk.red('-' + state.symbols[symbol].buyThreshold.toFixed(0).padEnd(4))}`) +
       lerpChalk([200, 0, 0], [0, 200, 0], PNL > 0 ? 1 : 0)(PNL.toFixed(2).padStart(10));

    const keys: string[] = Object.keys(state.currencies).sort();
    readline.cursorTo(process.stdout, 0, keys.indexOf(symbol));
    if (keys.indexOf(symbol) == state.selectedRow) {
        process.stdout.write(chalk.bgBlackBright(state.symbols[symbol].statusLine));
    } else {
        process.stdout.write(state.symbols[symbol].statusLine);
    }

    if (Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow) {
        await drawCandles(symbol);
    }
}

export const printStats = async (symbol: string, deltaPrice?: number): Promise<void> => {
    if (deltaPrice) {
        state.symbols[symbol].deltaPrice = deltaPrice;
    } else {
        deltaPrice = symbol in state.symbols ? state.symbols[symbol].deltaPrice : 0;
    }

    printSymbol(symbol);

    const profits: number = await readProfits();
    // readline.cursorTo(process.stdout, (process.stdout.columns || 120) - 50, (process.stdout.rows || 80) - 1);
    // process.stdout.write(`${(await readProfits(undefined, '-1000 years')).toFixed(2)}`.padStart(50));
    const deltaSum: number = Object.keys(state.currencies).reduce((acc, delta) => acc + (state.deltas[delta] || 0), 0);
    const deltaSumStr: string = (deltaSum < 0 ? '+' : '') + formatFloat(-deltaSum);
    const profitsStr: string = (profits >= 0 ? '+' : '') + formatFloat(profits);
    const deltaSumColor: chalk.Chalk = deltaSum <= 0 ? chalk.green : chalk.red;
    const profitsColor: chalk.Chalk = profits >= 0 ? chalk.green : chalk.red;
    readline.cursorTo(process.stdout, 0, Object.keys(state.currencies).length);

    process.stdout.write(`📋 ${chalk.whiteBright('F1')}${state.enableSell ? '🟢' : '🟥'}💵`);
    process.stdout.write(` ${chalk.whiteBright('F2')}${state.enableBuy ? '🟢' : '🟥'}🪙`);
    readline.cursorTo(process.stdout, '                       '.length, Object.keys(state.currencies).length);

    readline.cursorTo(process.stdout, Settings.showTime ? 35 : 15, Object.keys(state.currencies).length);
    const padded: string = `${Math.round(state.deltas.USDT)} +${('' + state.steps[state.step])} =`;
    const padding: string = ' '.repeat(Math.max(0, 13 - padded.length));
    process.stdout.write((padding + `${Math.round(state.deltas.USDT)}` +
        ` ${chalk.grey('±')}${('' + state.steps[state.step])}` +
        ` ${chalk.yellow('⇄')}`));

    readline.cursorTo(process.stdout, Settings.showTime ? 49 : 29, Object.keys(state.currencies).length);
    process.stdout.write(`${`${Math.round(Object.values(state.currencies).reduce((acc, currency) => acc + currency, 0))}`.padEnd(11)}`);

    readline.cursorTo(process.stdout, Settings.showTime ? 60 : 40, Object.keys(state.currencies).length);
    process.stdout.write(`${deltaSumColor(deltaSumStr.padEnd(11))}${profitsColor(profitsStr.padEnd(11))}`);
    readline.cursorTo(process.stdout, Settings.showTime ? 82 : 62, Object.keys(state.currencies).length);
    process.stdout.write(chalk.bgRgb(50, 25, 25)(` ` +
        `${chalk.red('↓')}${chalk.whiteBright('-')}${chalk.green('↑')}${chalk.whiteBright('=')}   ` +
        `${chalk.red('↓')}${chalk.whiteBright('[')}${chalk.green('↑')}${chalk.whiteBright(']')} `));
}

export async function drawCandles(symbol: string): Promise<void> {
    const candlesX: number = Settings.showTime ? state.candles.XBase + 10 : state.candles.XBase - 10;
    const candlesWidth: number = (process.stdout.columns || 120) - candlesX - 1;
    state.candles.height = Math.round(20 / 80 * candlesWidth);

    if (state.candles.data.length === 0 ||
        (state.candles.scale === 0 ||
            (state.candles.scale === 1 && new Date(state.candles.time.open).getMinutes() !== new Date().getMinutes()) ||
            (state.candles.scale === 2 && new Date(state.candles.time.open).getHours() !== new Date().getHours()) ||
            (state.candles.scale === 3 && new Date(state.candles.time.open).getDay() !== new Date().getDay()))) {
        state.candles.data = await candles.getCandles(symbol, state.candles.scales[state.candles.scale] as CandleChartInterval_LT, candlesWidth);
    }

    const { rows, min, max } = await candles.renderCandles(state.candles.data, state.candles.height);
    const minValue: number = min;
    const maxValue: number = max;
    rows.forEach((row: string, i: number) => {
        readline.cursorTo(process.stdout, candlesX, i);
        process.stdout.write(chalk.bgRgb(25, 25, 25)(row));
        readline.clearLine(process.stdout, 1);
    });
    readline.cursorTo(process.stdout, candlesX, 0);
    process.stdout.write(chalk.bgRgb(25, 25, 25)(`${maxValue}`));
    readline.cursorTo(process.stdout, candlesX, rows.length - 1);
    process.stdout.write(chalk.bgRgb(25, 25, 25)(`${minValue}`));

    const delInsStr: string = `DEL⮜ ${state.candles.scales[state.candles.scale]} ⮞INS`;
    readline.cursorTo(process.stdout, (process.stdout.columns || 120) - delInsStr.length - 1, rows.length);

    process.stdout.write(delInsStr.replace('DEL', chalk.whiteBright('DEL')).replace('INS', chalk.whiteBright('INS')).replace(/⮜ (.*) ⮞/, '⮜ ' + chalk.bgWhite(chalk.black('$1')) + ' ⮞'));

    readline.clearLine(process.stdout, 1);
    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    if (isSelected && state.symbols[symbol].indicatorValues.SMAs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 1);
        process.stdout.write(`     SMA ${state.symbols[symbol].indicatorValues.SMAs.map(s => {
            if (isNaN(s)) return '';
            let diff: number = (s - state.symbols[symbol].price) / state.symbols[symbol].price * 100;
            diff = Math.min(1.0, Math.max(-1.0, diff));
            return (diff > 0 ? bgLerp([0, 0, 0], [255, 0, 0], diff) : bgLerp([0, 0, 0], [0, 255, 0], -diff))((Math.abs(diff) < 0.5 ? chalk.white : chalk.black)(s ? s.toPrecision(8) : s));
        }).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }

    if (isSelected && state.symbols[symbol].indicatorValues.EMAs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 2);
        process.stdout.write(`     EMA ${state.symbols[symbol].indicatorValues.EMAs.map(s => {
            if (isNaN(s)) return '';
            let diff: number = (s - state.symbols[symbol].price) / state.symbols[symbol].price * 100;
            diff = Math.min(1.0, Math.max(-1.0, diff));
            return (diff > 0 ? bgLerp([0, 0, 0], [255, 0, 0], diff) : bgLerp([0, 0, 0], [0, 255, 0], -diff))((Math.abs(diff) < 0.5 ? chalk.white : chalk.black)(s ? s.toPrecision(8) : s));
        }).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }
    if (isSelected && state.symbols[symbol].indicatorValues.RSIs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 3);
        process.stdout.write(`     RSI ${state.symbols[symbol].indicatorValues.RSIs.filter(isFinite)
            .map(s =>
                lerpChalk(lerpColor([200, 200, 200], [255, 125, 125], s / 50), lerpColor([200, 200, 200], [125, 255, 125], (s - 50) / 50), s < 50 ? 0 : 1)
                    (('' + Math.round(s)).padStart(3))).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }
    if (isSelected && state.symbols[symbol].indicatorValues.StochasticRSIs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 4);
        process.stdout.write(`   stRSI ${state.symbols[symbol].indicatorValues.StochasticRSIs.filter(isFinite).map(s =>
            lerpChalk(lerpColor([200, 200, 200], [255, 125, 125], s / 50), lerpColor([200, 200, 200], [125, 255, 125], (s - 50) / 50), s < 50 ? 0 : 1)
                (('' + Math.round(s)).padStart(3))).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }
    if (isSelected) {
        const width: number = 30;
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 5);
        readline.clearLine(process.stdout, 1);
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 6);
        process.stdout.write('    ' + 'min');
        readline.cursorTo(process.stdout, candlesX + width * 0.5 + '    '.length, state.candles.height + 6);
        process.stdout.write('max'.padStart(width * 0.5));
        readline.cursorTo(process.stdout, candlesX + width * 0.5 - 1 + '    '.length, state.candles.height + 6);
        process.stdout.write('24h');
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 7);
        const progress: number = clamp((state.symbols[symbol].price - state.symbols[symbol].lowPrice) / (state.symbols[symbol].highPrice - state.symbols[symbol].lowPrice));

        process.stdout.write('    ' + lerpChalk([255, 0, 0], [0, 255, 0], progress)('■'.repeat(Math.round(progress * width))) +
            chalk.gray('□'.repeat(Math.round((1.0 - progress) * width))));
    }
    if (isSelected) {
        const width: number = 26;
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 10);
        readline.clearLine(process.stdout, 1);

        const halfWidth: number = Math.floor(width / 2);
        const velocity: number = state.velocities[symbol] || 0;
        const alpha: number = Math.floor(Math.abs(velocity * width * 10000));
        process.stdout.write('      ');
        if (state.velocities[symbol] > 0) {
            process.stdout.write(chalk.white('─'.repeat(halfWidth)));
            process.stdout.write(chalk.white('┼'));
        } else {
            process.stdout.write(chalk.white('─'.repeat(Math.max(0, halfWidth - alpha))));
        }
        process.stdout.write((velocity > 0 ? chalk.green : chalk.red)('■'.repeat(Math.min(halfWidth, alpha))));
        if (state.velocities[symbol] < 0) {
            process.stdout.write(chalk.white('┼'));
            process.stdout.write(chalk.white('─'.repeat(halfWidth)));
        } else {
            process.stdout.write(chalk.white('─'.repeat(Math.max(0, halfWidth - alpha))));
        }
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 11);
    }
}

export function printTrades(): void {
    while (logMessages.length > (process.stdout.rows || 80) - Object.keys(state.currencies).length - 1) {
        logMessages.shift();
    }

    for (let i = 0; i < logMessages.length; i++) {
        readline.cursorTo(process.stdout, 0, Object.keys(state.currencies).length + (logMessages.length - i));
        readline.clearLine(process.stdout, 0);
        process.stdout.write(logMessages[i]);
        readline.clearLine(process.stdout, 1);
    }
}