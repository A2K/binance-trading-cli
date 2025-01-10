
import chalk from 'chalk';
import state from './state';
import Settings from './settings';
import readline from 'readline';
import candles, { Candle, LiveCandleData } from './candles';
import { bgLerp, lerpColor, lerpChalk, clamp, getAssetBallance, progressBarText, verticalBar, trimTrailingZeroes, DelayedExecution, timestampStr, getAvgBuyPrice, formatAssetQuantity, getAssetBallanceFree, remap } from './utils';
import { readProfits, readTransactionLog } from './transactions';
import { CandleChartInterval_LT } from 'binance-api-node';
import { getStakedQuantity, getStakingEffectiveAPR, getStakingEffectiveAPRAverage } from './autostaking';
import { getLiveIndicator, LiveIndicator, LiveOHLCVHistory } from './indicators';
import { sma, ema, rsi, stochasticrsi } from 'trading-indicator';
import Trade from './trade';
import fs from 'fs';

const logFileStream = fs.createWriteStream(__dirname + '/config/log.txt', {flags : 'a', encoding: 'utf-8'});

export var tradeLog: Trade[] = [];
type LogLevel = 'info' | 'notice' | 'warn' | 'error';

export class LogMessage {
    constructor(public message: string, public level: LogLevel = 'info', public time = new Date()) { }
    serialize(): string {
        return this.time.toISOString() + ' ' + this.level + ' ' + this.message + '\n';
    }
    static deserialize(str: string): LogMessage {
        const parts = str.split(' ');
        return new LogMessage(parts.slice(2).join(' '), parts[1] as LogLevel, new Date(parts[0]));
    }
    toString(): string {
        const color = (() => {
            switch (this.level) {
                case 'info': return chalk.white;
                case 'notice': return chalk.blue;
                case 'warn': return chalk.yellow;
                case 'error': return chalk.red;
                default: return chalk.white;
            }
        })();
        const prefix = (() => {
            switch (this.level) {
                case 'info': return '📃';
                case 'notice': return 'ℹ️';
                case 'warn': return '🛎 ';
                case 'error': return '🚨';
                default: return 'ℹ';
            }
        })();
        return prefix + ' ' + timestampStr(this.time) + ' ' + color(this.message.substring(0, Math.min(this.message.length, state.candles.XBase - 23)));
    }

    get length(): number {
        return 1 + ' '.length + timestampStr(this.time).length + ' '.length + strlen(this.message);
    }
}

import CLITable from './ui-clitable';

export var messageLog: LogMessage[] = (() => {
    try {
        const file = fs.openSync(__dirname + '/config/log.txt', 'r');
        const logSize = fs.statSync(__dirname + '/config/log.txt').size;
        const sizeToRead = Math.min(logSize, 10000);
        const buffer = Buffer.alloc(sizeToRead);
        fs.readSync(file, buffer, 0, sizeToRead, logSize - sizeToRead);
        return buffer.toString().split('\n').map(LogMessage.deserialize).filter(m => !isNaN(m.time.getTime()));
        // readLastLines.read('config/log.txt', 10000).then(data => messageLog = data.split('\n').map(LogMessage.deserialize));
        // return fs.readFileSync(__dirname + '/config/log.txt').toString().split('\n').map(LogMessage.deserialize);
    } catch (e) {
        return [];
    }
})();

export const log = (...msgs: any[]): void => {
    messageLog.push(new LogMessage(msgs.map(msg => msg ? msg.toString() : `${msg}`).join(' ')));
    logFileStream.write(messageLog[messageLog.length - 1].serialize());
    printLog();
}

log.notice = (...msgs: any[]): void => {
    messageLog.push(new LogMessage(msgs.map(msg => msg ? msg.toString() : `${msg}`).join(' '), 'notice'));
    logFileStream.write(messageLog[messageLog.length - 1].serialize());
    printLog();
}

log.warn = (...msgs: any[]): void => {
    messageLog.push(new LogMessage(msgs.map(msg => msg ? msg.toString() : `${msg}`).join(' '), 'warn'));
    logFileStream.write(messageLog[messageLog.length - 1].serialize());
    printLog();
}

log.err = (...msgs: any[]): void => {
    messageLog.push(new LogMessage(msgs.map(msg => msg ? msg.toString() : `${msg}`).join(' '), 'error'));
    logFileStream.write(messageLog[messageLog.length - 1].serialize());
    printLog();
}

export const colorizeDeltaUsd = (symbol: string, delta: number, width: number = 10): string => {
    let deltaStr: string = ((delta < 0 ? '-' : '+') + Math.abs(delta).toFixed(2)).padEnd(width);
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

export const colorizeSymbolProfit = async (symbol: string, delta: number, width: number = 10): Promise<string> => {
    const alpha: number = clamp(1.0 - (Date.now() - (state.assets[symbol].showTradeStartTime?.getTime() || 0)) / 10.0);
    const deltaStr: string = ((delta < 0 ? '-' : '+') + Math.abs(delta).toFixed(2)).padEnd(width);
    const maxDeltaProfit: number = Math.max(...await Promise.all(Object.keys(state.currencies).map(c => readProfits(c).then(profit => Math.abs(profit)))));
    const fraction: number = Math.abs(delta / maxDeltaProfit);
    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;
    const colorLeft: number = 100 * (isSelected ? 2 : 1);
    const colorRight: number = 25 * (isSelected ? 2 : 1);
    const coloredDeltaStr = chalk.bgRgb(delta < 0 ? colorLeft : 0, delta >= 0 ? colorLeft : 0, 0)(deltaStr.substring(0, Math.round(fraction * deltaStr.length)))
        + chalk.bgRgb(delta < 0 ? colorRight : 0, delta >= 0 ? colorRight : 0, 0)(deltaStr.substring(Math.round(fraction * deltaStr.length)));
    const m: number = Math.round(225 * (1.0 - alpha) + 255 * alpha);
    return chalk.rgb(m, m, m)(coloredDeltaStr);
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
export function createSymbolTable(): CLITable {
    const symbols: string[] = Object.keys(state.currencies).sort();
    const table = new CLITable(symbols.length, 9);

    table.setColumnWidth(0, 10);
    table.setColumnWidth(1, 13);
    table.setColumnWidth(2, 10);
    table.setColumnWidth(3, 5);
    table.setColumnWidth(4, 10);
    table.setColumnWidth(6, 1);
    table.setColumnWidth(7, 12);
    table.setColumnWidth(8, 8);

    symbols.forEach((symbol, i) => {

        table.setCell(i, 0, async (width) => (state.assets[symbol].currentOrder ? '⌛' : '📈') + ' ' + symbol.padEnd(width - 2));

        table.setCell(i, 1, async (width) => makeVelocitySymbol((state.velocities[symbol] || 0)) +
            colorizeChangedPart(symbol, state.assets[symbol].price - state.assets[symbol].deltaPrice, state.assets[symbol].price, width - 1));

        table.setCell(i, 2, ((symbol: string) => async (width: number) => {

            const targetBalance = state.currencies[symbol] || 0;

            const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;
            const total: number = Object.keys(state.currencies).reduce((acc, s) => acc + (state.currencies[s] || 0), 0);
            const max: number = Object.keys(state.currencies).reduce((acc, s) => Math.max(acc, state.currencies[s] / total), 0);
            const fraction: number = Math.pow(targetBalance / total / max, 1.0 / Math.E);

            return progressBarText({ current: fraction, max: 1.0 }, width, targetBalance.toFixed(0),
                isSelected ? [32, 180, 180] : [10, 120, 120],
                isSelected ? [0, 64, 128] : [0, 32, 32],
                isSelected ? [225, 225, 225] : [192, 192, 192],
                isSelected ? [250, 250, 250] : [210, 210, 210]
            );
        })(symbol));

        table.setCell(i, 3, async (width: number) => {
            const effectiveAPR = await getStakingEffectiveAPR(symbol);
            return lerpChalk([200, 200, 200], [100, 255, 100], remap(effectiveAPR, [0, 0.005]))((effectiveAPR * 100).toFixed(2).padStart(width));
        });

        table.setCell(i, 4, async (width: number) => {
            const deltaUsd: number = state.deltas[symbol] || 0;
            return (deltaUsd < 0 ? (-deltaUsd > state.assets[symbol].sellThreshold ? chalk.greenBright : chalk.green) :
                (deltaUsd > state.assets[symbol].buyThreshold ? chalk.redBright : chalk.red))(colorizeDeltaUsd(symbol, -deltaUsd, width));
        });

        table.setCell(i, 5, async (width: number) => {
            return await colorizeSymbolProfit(symbol, await readProfits(symbol, '1 day'), width);
        });
        table.setCell(i, 6, async (width: number) =>
            (state.assets[symbol].staking ? '💸' : '💰').padStart(width));

        table.setCell(i, 7, async (width: number) => {
            const maxSellThreshold = Math.max(...Object.keys(state.assets).map(s => state.assets[s].sellThreshold));
            var sellThresholdPadding = maxSellThreshold.toFixed(0).length;
            const maxBuyThreshold = Math.max(...Object.keys(state.assets).map(s => state.assets[s].buyThreshold));
            var buyThresholdPadding = maxBuyThreshold.toFixed(0).length;
            const maxDailyLoss = Math.max(...Object.keys(state.assets).map(s => state.assets[s].maxDailyLoss));
            var dailyLossPadding = maxDailyLoss.toFixed(0).length;
            const totalPadding = (sellThresholdPadding + buyThresholdPadding + dailyLossPadding);

            sellThresholdPadding = Math.round(sellThresholdPadding / totalPadding * width);
            buyThresholdPadding = Math.round(buyThresholdPadding / totalPadding * width);
            dailyLossPadding = Math.round(dailyLossPadding / totalPadding * width);

            const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;
            const loss = {
                current: Math.max(0, state.assets[symbol].maxDailyLoss + (await readProfits(symbol))),
                max: state.assets[symbol].maxDailyLoss
            };

            return chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50)(lerpChalk([255, 0, 0], [0, 255, 0], loss.max === 0 ? 0 : loss.current / loss.max)(verticalBar(loss)) + state.assets[symbol].maxDailyLoss.toFixed(0).padEnd(dailyLossPadding)) +
                (state.assets[symbol].enableSell ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(
                    `${state.assets[symbol].enableSell ? '🟢' : '🟥'}` +
                    `${chalk.green(state.assets[symbol].sellThreshold.toFixed(0).padEnd(sellThresholdPadding))}`) +
                (state.assets[symbol].enableBuy ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(`${state.assets[symbol].enableBuy ? '🟢' : '🟥'}` +
                    `${chalk.red('-' + state.assets[symbol].buyThreshold.toFixed(0).padEnd(buyThresholdPadding))}`);
        });

        table.setCell(i, 8, async (width: number) => {
            const PNL: number = (await readProfits(symbol, 'all time') || 0) + await getAssetBallance(symbol) * state.assets[symbol].price;
            return lerpChalk([200, 0, 0], [0, 200, 0], PNL > 0 ? 1 : 0)(PNL.toFixed(2).padStart(width));
        });

    });

    return table;
}

var symbolTable: CLITable|undefined=undefined;
export async function printSymbol(symbol: string): Promise<void> {

    if (!(symbol in state.assets)) {
        return;
    }
    if (symbolTable === undefined) {
        symbolTable = createSymbolTable();
    }
/*
    let deltaPrice: number = state.assets[symbol].deltaPrice || 0;

    const symbolProfit: number = await readProfits(symbol, '1 day');

    const targetBalance = state.currencies[symbol] || 0;
    const staked = await getStakedQuantity(symbol) * (state.assets[symbol].price || 0);

    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;
    const total: number = Object.keys(state.currencies).reduce((acc, s) => acc + (state.currencies[s] || 0), 0);
    const max: number = Object.keys(state.currencies).reduce((acc, s) => Math.max(acc, state.currencies[s] / total), 0);
    const fraction: number = Math.pow(targetBalance / total / max, 1.0 / Math.E);
    const stakedFraction: number = fraction / (await getAssetBallance(symbol)) / (state.assets[symbol].price || 0) * staked; //Math.pow(staked / total / max,  1.0 / Math.E);

    let str: string = progressBarText({ current: fraction, max: 1.0 }, 10, targetBalance.toFixed(0),
        isSelected ? [32, 180, 180] : [10, 120, 120],
        isSelected ? [0, 64, 128] : [0, 32, 32],
        isSelected ? [225, 225, 225] : [192, 192, 192],
        isSelected ? [250, 250, 250] : [210, 210, 210]
    );

    const deltaUsd: number = state.deltas[symbol] || 0;
    const PNL: number = (await readProfits(symbol, 'all time') || 0) + await getAssetBallance(symbol) * state.assets[symbol].price;

    const effectiveAPR = await getStakingEffectiveAPR(symbol);
    const loss = {
        current: Math.max(0, state.assets[symbol].maxDailyLoss + (await readProfits(symbol))),
        max: state.assets[symbol].maxDailyLoss
    };

    const maxSellThreshold = Math.max(...Object.keys(state.assets).map(s => state.assets[s].sellThreshold));
    const sellThresholdPadding = maxSellThreshold.toFixed(0).length;
    const maxBuyThreshold = Math.max(...Object.keys(state.assets).map(s => state.assets[s].buyThreshold));
    const buyThresholdPadding = maxBuyThreshold.toFixed(0).length;
    // const buyPrice = await getAvgBuyPrice(symbol);
    // const buyRatio = clamp((buyPrice - state.assets[symbol].price) / (state.assets[symbol].price * 0.1), -1, 1);
    state.assets[symbol].statusLine = `${state.assets[symbol].orderInProgress?'⌛':'📈'} ${symbol.padEnd(8)} ${makeVelocitySymbol((state.velocities[symbol] || 0))}` +

        `${colorizeChangedPart(symbol, state.assets[symbol].price - deltaPrice, state.assets[symbol].price, 13)}` +
        // `${(buyRatio > 0 ? lerpChalk([200, 200, 200], [255, 200, 200], Math.abs(buyRatio)) : lerpChalk([200, 200, 200], [200, 255, 200], Math.abs(buyRatio)))(formatAssetQuantity(symbol, buyPrice).slice(0, 10).padEnd(13))}` +

        str +
        ` ${lerpChalk([200, 200, 200], [100, 255, 100], remap(effectiveAPR, [0, 0.005]))((effectiveAPR * 100).toFixed(2).padStart(5))}` +

        ` ${(deltaUsd < 0 ? (-deltaUsd > state.assets[symbol].sellThreshold ? chalk.greenBright : chalk.green) :
            (deltaUsd > state.assets[symbol].buyThreshold ? chalk.redBright : chalk.red))(colorizeDeltaUsd(symbol, -deltaUsd))} ` +
        await colorizeSymbolProfit(symbol, symbolProfit) + ' ' +
        (state.assets[symbol].staking ? '💸' : '💰') + ' ' +

        chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50)(lerpChalk([255,0,0],[0,255,0],loss.max === 0 ? 0 : loss.current / loss.max)(verticalBar(loss)) + state.assets[symbol].maxDailyLoss.toFixed(0).padEnd(4)) +
        (state.assets[symbol].enableSell ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(
            `${state.assets[symbol].enableSell ? '🟢' : '🟥'}` +
            `${chalk.green(state.assets[symbol].sellThreshold.toFixed(0).padEnd(sellThresholdPadding))}`) +
            (state.assets[symbol].enableBuy ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(`${state.assets[symbol].enableBuy ? '🟢' : '🟥'}` +
            `${chalk.red('-' + state.assets[symbol].buyThreshold.toFixed(0).padEnd(buyThresholdPadding))}`) +

       lerpChalk([200, 0, 0], [0, 200, 0], PNL > 0 ? 1 : 0)(PNL.toFixed(2).padStart(9));
*/
    const keys: string[] = Object.keys(state.currencies).sort();
    const lineIndex = keys.indexOf(symbol) - state.symbolsScroll;
    const scrollBarChar = scrollBar({
        position: state.symbolsScroll,
        total: Object.keys(state.assets).length,
        height: state.symbolsHeight
    }).split('')[lineIndex];


    if (lineIndex >= 0 && lineIndex < state.symbolsHeight) {
        const str = await symbolTable.renderRow(Object.keys(state.currencies).sort().indexOf(symbol));
        readline.cursorTo(process.stdout, 0, lineIndex);
        if (keys.indexOf(symbol) == state.selectedRow) {
            process.stdout.write(chalk.bgBlackBright(str));
        } else {
            process.stdout.write(str);
        }
    }

    if ((Settings.drawCandles && state.selectedRow >= 0) && Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow) {
        await drawCandles(symbol, Settings.stableCoin);
    }
}

export const printStats = async (symbol: string, deltaPrice?: number): Promise<void> => {
    if (deltaPrice) {
        state.assets[symbol].deltaPrice = deltaPrice;
    } else {
        deltaPrice = symbol in state.assets ? state.assets[symbol].deltaPrice : 0;
    }

    printSymbol(symbol);

    if (Object.keys(state.currencies).length < state.symbolsHeight) {
        for (var i = Object.keys(state.currencies).length; i < state.symbolsHeight; i++) {
            readline.cursorTo(process.stdout, 0, i);
            process.stdout.write(' '.repeat(state.candles.XBase));
        }
    }
    const profits: number = await readProfits();

    const deltaSum: number = Object.keys(state.currencies).reduce((acc, delta) => acc + (state.deltas[delta] || 0), 0);
    const deltaSumStr: string = (deltaSum < 0 ? '+' : '') + (-deltaSum).toFixed(2);
    const profitsStr: string = (profits >= 0 ? '+' : '') + profits.toFixed(2);
    const deltaSumColor: chalk.Chalk = deltaSum <= 0 ? chalk.green : chalk.red;
    const profitsColor: chalk.Chalk = profits >= 0 ? chalk.green : chalk.red;

    const stakedBalance = await getStakedQuantity(Settings.stableCoin);
    const padded: string = `${Math.round(stakedBalance + await state.wallet.total(Settings.stableCoin))} +${('' + state.steps[state.step])} =`;
    const padding: string = ' '.repeat(Math.max(0, 14 - padded.length));

    const avgStakingRate = await getStakingEffectiveAPRAverage();

    const str = `📋 ` + (state.enableSell ? chalk.bgGreen : chalk.bgRed)('F1💵') +
        ' ' + (state.enableBuy ? chalk.bgGreen : chalk.bgRed)('F2🪙') +
        (padding + `${Math.round(await getAssetBallanceFree(Settings.stableCoin))}` +
        ` ${chalk.grey('±')}${('' + state.steps[state.step])}` +
            ` ${chalk.yellow('⇄')} `) +
        `${Math.round(Object.values(state.currencies).reduce((acc, currency) => acc + currency, 0)).toFixed(0).padEnd(10)}` +
        ' ' +
        (avgStakingRate * 100).toFixed(2).padStart(5) + ' ' +

        `${deltaSumColor(deltaSumStr.padEnd(11))}${profitsColor(profitsStr.padEnd(11))}   ` +

        chalk.bgRgb(50, 25, 25)(
            `${chalk.red('↓')}${chalk.whiteBright('<')}${chalk.green('↑')}${chalk.whiteBright('>')}  ` +
            `${chalk.red('↓')}${chalk.whiteBright('-')}${chalk.green('↑')}${chalk.whiteBright('=')}   ` +
            `${chalk.red('↓')}${chalk.whiteBright('[')}${chalk.green('↑')}${chalk.whiteBright(']')} `) + ' '.repeat(10);
    readline.cursorTo(process.stdout, 0, state.symbolsHeight);
    process.stdout.write(chalk.bgRgb(64, 64, 64)(str));


}

var __drawCandlesCallCounter: number = 0;
var __drawCandlesLastCallTime: number = 0;

const indicators: {
    SMA: LiveIndicator[],
    EMA: LiveIndicator[],
    RSI: LiveIndicator[],
    stRSI: LiveIndicator[]
} = {
    SMA: [],
    EMA: [],
    RSI: [],
    stRSI: []
}
var indicatorsSymbol: string = '';

export async function drawCandles(symbol: string, currency: string = 'USDT'): Promise<void> {
    if (Date.now() - __drawCandlesLastCallTime < 100) {
        return;
    }
    __drawCandlesLastCallTime = Date.now();
    const callId = ++__drawCandlesCallCounter;
    const candlesX: number = state.candles.XBase;
    const candlesWidth: number = (process.stdout.columns || 120) - candlesX;
    state.candles.height = Math.round(20 / 80 * candlesWidth);

    const lastCandleTime: Date = state.candles.data?.length
        ? state.candles.data.data[state.candles.data.length - 1].time.open
        : new Date(0);
    if (state.candles.data?.length === 0 ||
        state.candles.scale === 0 ||
        (state.candles.scale === 1 && lastCandleTime.getMinutes() !== new Date().getMinutes()) ||
        (state.candles.scale === 2 && lastCandleTime.getMinutes() !== Math.floor(new Date().getMinutes() / 15) * 15) ||
        (state.candles.scale >= 3 && lastCandleTime.getHours() !== new Date().getHours())
    ) {
        if (state.candles.data) {
            state.candles.data.close();
        }
        state.candles.data = new LiveCandleData(symbol, currency,
            state.candles.scales[state.candles.scale] as CandleChartInterval_LT,
            candlesWidth, false);
        try {
            await state.candles.data.init();
        } catch (e) {
            delete state.candles.data;
            return;
        }
        // state.candles.data = await candles.getCandles(symbol, state.candles.scales[state.candles.scale] as CandleChartInterval_LT, candlesWidth);
        if (callId !== __drawCandlesCallCounter) {
            return;
        }
    }

    const candleData: Candle[] = state.candles.data?.data || [];
    if (candleData.length === 0) {
        return;
    }
    const { rows, min, max } = await candles.renderCandles(candleData, state.candles.height);
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

    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    const indicatorsOffset = 1;
    if (isSelected && state.assets[symbol].indicatorValues.SMAs) {

        const calcRelativeMA = (symbol: string, value: number): number => {
            value = value || 0;
            const current = clamp(state.assets[symbol].price * 0.2 - Math.max(0, value - state.assets[symbol].price * 0.9));
            return clamp(state.assets[symbol].price > 0 ? (current / state.assets[symbol].price * 0.2) : 0);
        }

        const formatIndicator = (symbol: string, value: number): string => {
            if (isNaN(value)) {
                return ' ';
            }
            value = value || 0;
            let diff: number = (value - state.assets[symbol].price) / state.assets[symbol].price * 100;
            diff = Math.min(1.0, Math.max(-1.0, diff / 10));

            const current = clamp(state.assets[symbol].price * 0.2 - Math.max(0, value - state.assets[symbol].price + state.assets[symbol].price * 0.1));
            const ratio = current / (state.assets[symbol].price * 0.2);
            return chalk.bgGray(lerpChalk([255, 0, 0], [0, 255, 0], ratio)(
                verticalBar({ current: current, max: state.assets[symbol].price * 0.2 })));
            return (diff > 0 ? bgLerp([0, 0, 0], [255, 0, 0], diff) : bgLerp([0, 0, 0], [0, 255, 0], -diff))((Math.abs(diff) < 0.5 ? chalk.white : chalk.black)(((value > state.assets[symbol].price ? '+' : '') + ((value - state.assets[symbol].price) / state.assets[symbol].price * 100).toFixed(2) + '%').padStart(7)));
        }

        const formatRsiIndicator = (s: number): string => {
            if (isNaN(s)) {
                return ' '
            }
            return chalk.bgGray(lerpChalk([255, 0, 0], [0, 255, 0], s / 100)(verticalBar({ current: s, max: 100 })));
            verticalBar({ current: s, max: 100 });
            return s ? lerpChalk(lerpColor([200, 200, 200], [255, 125, 125], s / 50), lerpColor([200, 200, 200], [125, 255, 125], (s - 50) / 50), s < 50 ? 0 : 1)(s.toFixed(0).padStart(3)) : '   ';
        }

        const makeSMA = (period: string) => getLiveIndicator('SMA', `${symbol}${Settings.stableCoin}`, period,
            (history: LiveOHLCVHistory): Promise<number> =>
                sma(8, 'close', history.data)
                    .then((res: number[]) => res && res.length ? res[res.length - 1] : NaN));

        const makeEMA = (period: string) => getLiveIndicator('EMA', `${symbol}${Settings.stableCoin}`, period,
            (history: LiveOHLCVHistory): Promise<number> =>
                ema(8, 'close', history.data)
                    .then((res: number[]) => res && res.length ? res[res.length - 1] : NaN));

        const makeRSI = (period: string) => getLiveIndicator('RSI', `${symbol}${Settings.stableCoin}`, period,
            (history: LiveOHLCVHistory): Promise<number> =>
                rsi(8, 'close', history.data)
                    .then((res: number[]) => res && res.length ? res[res.length - 1] : NaN));
        const makeStRSI = (period: string) => getLiveIndicator('stRSI', `${symbol}${Settings.stableCoin}`, period,
            (history: LiveOHLCVHistory): Promise<number> =>
                stochasticrsi(8, 8, 8, 8, 'close', history.data)
                    .then((res: any) => res && res.length ? res[res.length - 1].stochRSI : NaN));

        if (indicatorsSymbol !== symbol) {
            const indicatorPeriods = ['1h', '1d', '1w', '1M'];
            const indicatorsArray = await Promise.all([
                await Promise.all(indicatorPeriods.map(p => makeSMA(p))),
                await Promise.all(indicatorPeriods.map(p => makeEMA(p))),
                await Promise.all(indicatorPeriods.map(p => makeRSI(p))),
                await Promise.all(indicatorPeriods.map(p => makeStRSI(p)))
            ]);
            indicators.SMA = indicatorsArray[0];
            indicators.EMA = indicatorsArray[1];
            indicators.RSI = indicatorsArray[2];
            indicators.stRSI = indicatorsArray[3];
            indicatorsSymbol = symbol;
        }

        readline.cursorTo(process.stdout, candlesX, state.candles.height + indicatorsOffset + 2);
        const avgSMA = indicators.SMA.reduce((acc, x) => acc + (x.value || 0), 0) / indicators.SMA.length;
        const avgSMAcurrent = clamp(state.assets[symbol].price * 0.2 - Math.max(0, avgSMA - state.assets[symbol].price + state.assets[symbol].price * 0.1));
        const SMAratio = avgSMAcurrent / (state.assets[symbol].price * 0.2);
        const SMAsymbol = chalk.bgGray(lerpChalk([255, 0, 0], [0, 255, 0], SMAratio)(verticalBar({
            current: avgSMAcurrent,
            max: state.assets[symbol].price * 0.2
        })));

        const avgEMA = indicators.EMA.reduce((acc, x) => acc + (x.value || 0), 0) / indicators.EMA.length;
        const avgEMAcurrent = clamp(state.assets[symbol].price * 0.2 - Math.max(0, avgEMA - state.assets[symbol].price + state.assets[symbol].price * 0.1));
        const EMAratio = avgEMAcurrent / (state.assets[symbol].price * 0.2);
        const EMAsymbol = chalk.bgGray(lerpChalk([255, 0, 0], [0, 255, 0], EMAratio)(verticalBar({
            current: avgEMAcurrent,
            max: state.assets[symbol].price * 0.2
        })));

        const RSIsymbol = chalk.bgGray(lerpChalk([255, 0, 0], [0, 255, 0], indicators.RSI.reduce((acc, x) => acc + (x.value || 0), 0) / indicators.RSI.length / 100)(verticalBar({
            current: indicators.RSI.reduce((acc, x) => acc + (x.value || 0), 0) / indicators.RSI.length,
            max: 100
        })));

        const stRSIsymbol = chalk.bgGray(lerpChalk([255, 0, 0], [0, 255, 0], indicators.stRSI.reduce((acc, x) => acc + (x.value || 0), 0) / indicators.stRSI.length / 100)(verticalBar({
            current: indicators.stRSI.reduce((acc, x) => acc + (x.value || 0), 0) / indicators.stRSI.length,
            max: 100
        })));

        var str: string[] = [];
        str.push(`${SMAsymbol}${chalk.bgGray(chalk.whiteBright('SMA'))}` +
            `${formatIndicator(symbol, indicators.SMA[0].value)}` +
            `${formatIndicator(symbol, indicators.SMA[1].value)}` +
            `${formatIndicator(symbol, indicators.SMA[2].value)}` +
            `${formatIndicator(symbol, indicators.SMA[3].value)}` +
            ` ${EMAsymbol}${chalk.bgGray(chalk.whiteBright('EMA'))}` +
            `${formatIndicator(symbol, indicators.EMA[0].value)}` +
            `${formatIndicator(symbol, indicators.EMA[1].value)}` +
            `${formatIndicator(symbol, indicators.EMA[2].value)}` +
            `${formatIndicator(symbol, indicators.EMA[3].value)}` +
            ` ${RSIsymbol}${chalk.bgGray(chalk.whiteBright('RSI'))}` +
            `${formatRsiIndicator(indicators.RSI[0].value)}` +
            `${formatRsiIndicator(indicators.RSI[1].value)}` +
            `${formatRsiIndicator(indicators.RSI[2].value)}` +
            `${formatRsiIndicator(indicators.RSI[3].value)}` +
            ` ${stRSIsymbol}${chalk.bgGray(chalk.whiteBright('st'))}` +
            `${formatRsiIndicator(indicators.stRSI[0].value)}` +
            `${formatRsiIndicator(indicators.stRSI[1].value)}` +
            `${formatRsiIndicator(indicators.stRSI[2].value)}` +
            `${formatRsiIndicator(indicators.stRSI[3].value)}`);

        const verdicts = ['SELL', 'SELL', 'HOLD', 'BUY', 'BUY'];
        const alpha = (
            indicators.SMA.reduce((acc, x) => acc - (calcRelativeMA(symbol, x.value) || 0), 0) / indicators.SMA.length +
            indicators.EMA.reduce((acc, x) => acc - (calcRelativeMA(symbol, x.value) || 0), 0) / indicators.EMA.length +
            indicators.RSI.reduce((acc, x) => acc + clamp(x.value / 100 || 0), 0) / indicators.RSI.length +
            indicators.stRSI.reduce((acc, x) => acc + clamp(x.value / 100 || 0), 0) / indicators.stRSI.length) / 4;
        str[0] += ' ' + lerpChalk([255, 125, 125], [125, 255, 125], alpha)(verdicts[Math.min(verdicts.length - 1, Math.max(0, Math.round(alpha * (verdicts.length - 1))))]);
    const buyPrice = await getAvgBuyPrice(symbol);
    const buyRatio = clamp((buyPrice - state.assets[symbol].price) / (state.assets[symbol].price * 0.1), -1, 1);

        str[0] += ` ${(buyRatio > 0 ? lerpChalk([200, 200, 200], [255, 200, 200], Math.abs(buyRatio)) : lerpChalk([200, 200, 200], [200, 255, 200], Math.abs(buyRatio)))(formatAssetQuantity(symbol, buyPrice).slice(0, 10).padEnd(13))}`;
        str[0] += (state.assets[symbol].price > buyPrice ? '+' : '-') + (Math.abs(state.assets[symbol].price - buyPrice) / buyPrice * 100).toFixed(2) + '%';


        // readline.clearLine(process.stdout, 1);

        for (const [index, line] of str.entries()) {
            readline.cursorTo(process.stdout, candlesX, state.candles.height + indicatorsOffset + index);
            process.stdout.write(line);
            readline.clearLine(process.stdout, 1);
        }
    }
    drawCandlesStatusBar(symbol);
}

export async function renderEditableField(value: string, editing: boolean = false, width = 10): Promise<string> {
    return value.padEnd(width);
}

class CLIEditableField {

    public editing: boolean = false;

    constructor(private getter: () => Promise<string>,
        private setter: (value: string) => void,
        public width: number = 10) {
        this.width = width;
    }

    async getValue(): Promise<string> {
        return this.getter();
    }

    set value(value: string) {
        this.setter(value);
    }

    async render(): Promise<string> {
        return (await this.getter()).substring(0, this.width - 1) + (this.editing ? '▏' : '').padEnd(this.width);
    }

}

class CLILimitsWidget {

    STOP: CLIEditableField;
    STOP_REBUY: CLIEditableField;
    TAKE: CLIEditableField;
    TAKE_REBUY: CLIEditableField;

    get editing(): boolean {
        return this.STOP.editing || this.STOP_REBUY.editing || this.TAKE.editing || this.TAKE_REBUY.editing;
    }

    constructor(private symbol: string,
        public width: number = 30) {
        const widgetWidth = (width - ('STOP: '.length + 'REBUY: '.length)) / 2;

        this.STOP = new CLIEditableField(async () => formatAssetQuantity(symbol, state.assets[symbol].stopLossPrice),
            (value: string) => state.assets[symbol].stopLossPrice = parseFloat(value), widgetWidth);
        this.STOP_REBUY = new CLIEditableField(async () => formatAssetQuantity(symbol, state.assets[symbol].stopLossRebuyPrice),
            (value: string) => state.assets[symbol].stopLossRebuyPrice = parseFloat(value), widgetWidth);
        this.TAKE = new CLIEditableField(async () => formatAssetQuantity(symbol, state.assets[symbol].takeProfitPrice),
            (value: string) => state.assets[symbol].takeProfitPrice = parseFloat(value), widgetWidth);
        this.TAKE_REBUY = new CLIEditableField(async () => formatAssetQuantity(symbol, state.assets[symbol].takeProfitRebuyPrice),
            (value: string) => state.assets[symbol].takeProfitRebuyPrice = parseFloat(value), widgetWidth);
    }

    async render(): Promise<string[]> {
        activeLimitsWidget = this;
        const stopStr: string = `STOP: ${await this.STOP.render()}`;
        const stopRebuyStr: string = `REBUY: ${await this.STOP_REBUY.render()}`;
        const takeStr: string = `TAKE: ${await this.TAKE.render()}`;
        const takeRebuyStr: string = `REBUY: ${await this.TAKE_REBUY.render()}`;

        return [
            `${stopStr} ${stopRebuyStr}`,
            `${takeStr} ${takeRebuyStr}`
        ];
    }

    async handleDoubleClick(x: number, y: number): Promise<void> {
        const stopStr: string = `STOP: ${await this.STOP.render()}`;
        const stopRebuyStr: string = `REBUY: ${await this.STOP_REBUY.render()}`;
        const takeStr: string = `TAKE: ${await this.TAKE.render()}`;
        const takeRebuyStr: string = `REBUY: ${await this.TAKE_REBUY.render()}`;

        if (x >= 0 && x < stopStr.length && y === 0) {
            this.STOP.editing = true;
        } else if (x >= stopStr.length + 1 && x < stopStr.length + 1 + stopRebuyStr.length && y === 0) {
            this.STOP_REBUY.editing = true;
        } else if (x >= 0 && x < takeStr.length && y === 1) {
            this.TAKE.editing = true;
        } else if (x >= takeStr.length + 1 && x < takeStr.length + 1 + takeRebuyStr.length && y === 1) {
            this.TAKE_REBUY.editing = true;
        }
    }

    async handleInput(key: string): Promise<void> {
        if (!this.editing) {
            return;
        }
        if (this.STOP.editing) {
            this.STOP.value += key;
        } else if (this.STOP_REBUY.editing) {
            this.STOP_REBUY.value += key;
        }
        else if (this.TAKE.editing) {
            this.TAKE.value += key;
        } else if (this.TAKE_REBUY.editing) {
            this.TAKE_REBUY.value += key;
        }
    }

    async handleEnter(): Promise<void> {
        if (!this.editing) {
            return;
        }
        if (this.STOP.editing) {
            this.STOP.editing = false;
            state.assets[this.symbol].stopLossPrice = parseFloat(await this.STOP.getValue());
        } else if (this.STOP_REBUY.editing) {
            this.STOP_REBUY.editing = false;
            state.assets[this.symbol].stopLossRebuyPrice = parseFloat(await this.STOP_REBUY.getValue());
        } else if (this.TAKE.editing) {
            this.TAKE.editing = false;
            state.assets[this.symbol].takeProfitPrice = parseFloat(await this.TAKE.getValue());
        } else if (this.TAKE_REBUY.editing) {
            this.TAKE_REBUY.editing = false;
            state.assets[this.symbol].takeProfitRebuyPrice = parseFloat(await this.TAKE_REBUY.getValue());
        }
        activeLimitsWidget = undefined;
    }

}
const limitsWidgets: {
    [key: string]: CLILimitsWidget
} = {}
export var activeLimitsWidget: CLILimitsWidget|undefined = undefined;

export async function renderStopLimitWidget(symbol: string): Promise<string[]> {
    const widgets = (symbol in limitsWidgets) ? limitsWidgets[symbol] : (limitsWidgets[symbol] = new CLILimitsWidget(symbol, 30));
    return widgets.render();
}

export async function drawCandlesStatusBar(symbol: string): Promise<void> {
    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    const candlesX: number = state.candles.XBase;
    const candlesWidth: number = (process.stdout.columns || 120) - candlesX;
    state.candles.height = Math.round(20 / 80 * candlesWidth);

    var statusStr: string = "";
    if (isSelected) {
        const width1: number = 20;
        readline.cursorTo(process.stdout, candlesX, state.candles.height);
        const lowHighDelta = state.assets[symbol].highPrice - state.assets[symbol].lowPrice;
        const progress: number = lowHighDelta === 0 ? 0 : clamp((state.assets[symbol].price - state.assets[symbol].lowPrice) / lowHighDelta);

        statusStr +=
            lerpChalk([255, 0, 0], [0, 255, 0], progress)(
                '■'.repeat(Math.floor(progress * width1))
                + ((progress * width1 % 1) >= 0.25 ? '◧' : '□')
            ) +
            chalk.gray('□'.repeat(Math.ceil((1.0 - progress) * width1))) + ' ';


        const width2: number = 20;

        const halfWidth: number = Math.floor(width2 / 2);
        const velocity: number = state.velocities[symbol] || 0;
        const alpha: number = Math.floor(Math.abs(velocity * width2 * 10000));
        var speedStr = '';
        if (state.velocities[symbol] >= 0) {
            speedStr += chalk.white('─'.repeat(halfWidth));
            speedStr += chalk.white('┼');
        } else {
            speedStr += chalk.white('─'.repeat(Math.max(0, halfWidth - alpha)));
        }
        speedStr += (velocity > 0 ? chalk.green : chalk.red)('■'.repeat(Math.min(halfWidth, alpha)));
        if (state.velocities[symbol] < 0) {
            speedStr += chalk.white('┼');
            speedStr += chalk.white('─'.repeat(halfWidth));
        } else {
            speedStr += chalk.white('─'.repeat(Math.max(0, halfWidth - alpha)));
        }
        statusStr += speedStr;


        const delInsStr: string = `DEL⮜ ${state.candles.scales[state.candles.scale]} ⮞INS`;

        statusStr += ' '.repeat(Math.max(0, (process.stdout.columns || 120) - delInsStr.length - 3 - candlesX - width1 - width2));
        statusStr += delInsStr.replace('DEL', chalk.whiteBright('DEL')).replace('INS', chalk.whiteBright('INS')).replace(/⮜ (.*) ⮞/, '⮜ ' + chalk.bgWhite(chalk.black('$1')) + ' ⮞');

        readline.cursorTo(process.stdout, candlesX, state.candles.height);
        process.stdout.write(statusStr);
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 1);
        const stopLimitWidget: string[] = await renderStopLimitWidget(symbol);
        for (const [index, line] of stopLimitWidget.entries()) {
            readline.cursorTo(process.stdout, candlesX, state.candles.height + 1 + index);
            process.stdout.write(line);
        }
    }
}

export function printTrades(): void {

    const maxLines = (Settings.drawCandles && state.selectedRow >= 0)
        ? (process.stdout.rows || 80) - state.candles.height - 3 - 2
        : (process.stdout.rows || 80) - 1;
    state.tradeScroll = Math.min(state.tradeScroll, Math.max(0, tradeLog.length - maxLines));

    const pos = Math.min(Math.max(0, state.tradeScroll), Math.max(0, tradeLog.length - maxLines))
    const lines = tradeLog.slice(pos, pos + maxLines);

    for (var i = 0; i < lines.length; ++i) {
        const line = lines[i];
        readline.cursorTo(process.stdout,
            state.candles.XBase,
            (Settings.drawCandles && state.selectedRow >= 0) ? state.candles.height + 2 + i +2: i);
        process.stdout.write(line.toString() + ' '.repeat((process.stdout.columns || 120) - state.candles.XBase - line.toPlainTextString().length - 2));
    }

    scrollBar({ position: pos, total: tradeLog.length, height: maxLines }).split('').forEach((c, i) => {
        readline.cursorTo(process.stdout,
            process.stdout.columns! - 1,
            (Settings.drawCandles && state.selectedRow >= 0) ? state.candles.height + 2 + i +2: 1 + i);
        process.stdout.write((state.tradesScrollHover ? chalk.whiteBright : chalk.white)(c));
    });

    printLog();
}

function chars(str: string): string[] {
    // return (str.replace(/\x1b\[\??\d+m/, '').split('');
    const res = [];
    for (const c of str.replace(/\x1b\[\??\d+m/, '')) {
        res.push(c);
    }
    return res;
    /*
    const res = [];
    for (const c of str.replace(/\x1b\[\d+;?\w?/, '')) {
        res.push(c);
    }
    return res;
    */
}
function strlen(str: string): number {
    return chars(str).length;
}

function substr(str: string, start?: number, end?: number): string {
    return chars(str).slice(start, end).join('');
}
function strpad(str: string, len: number, char: string = ' ') {
    return str + char.repeat(Math.max(10, len - strlen(str)));
}
export async function printLog() {

    const maxLines = (process.stdout.rows || 80) - state.symbolsHeight - 1;
    state.logScroll = Math.min(state.logScroll, Math.max(0, messageLog.length - maxLines));

    const pos = Math.min(Math.max(0, state.logScroll), Math.max(0, messageLog.length - maxLines))
    const lines = messageLog.slice(0).reverse().slice(pos, pos + maxLines);

    for (var i = 0; i < lines.length; ++i) {
        const line: string = lines[i].toString();//.substring(0, state.candles.XBase - 1);
        readline.cursorTo(process.stdout, 0, state.symbolsHeight + 1 + i);
        process.stdout.write(line + ' '.repeat(Math.max(0, state.candles.XBase - lines[i].length)));
    }

    scrollBar({ position: pos, total: messageLog.length, height: maxLines }).split('').forEach((c, i) => {
        readline.cursorTo(process.stdout, state.candles.XBase - 1, state.symbolsHeight + 1 + i);
        process.stdout.write((state.logScrollHover ? chalk.whiteBright : chalk.white)(c));
    });
}

export async function printTransactions(symbol?: string): Promise<void> {
    tradeLog = await readTransactionLog(symbol, 100);
    state.tradeScroll = 0;
    printTrades();
}
export async function clearTransactions(): Promise<void> {
    if (Settings.drawCandles && state.selectedRow >= 0) {
        for (var i = Object.keys(state.currencies).length + 1; i < (process.stdout.rows || 120); i++) {
            readline.cursorTo(process.stdout, 0, i);
            readline.clearLine(process.stdout, 1);
        }
    } else {
        for (var i = 0; i < (process.stdout.rows || 120); i++) {
            readline.cursorTo(process.stdout, state.candles.XBase, i);
            readline.clearLine(process.stdout, 1);
        }
    }
}
/*
┏┥ ━ ┠┓
┃     ┃
┗ ━ ╋ ┛
*/
/**
│
╽
┃
╿
│
const UP_W: string[] = ['╷', '│', '╽', '┃'];
const DOWN_W: string[] = ['╵', '│', '╿', '┃'];
const UP_B: string[] = [' ', ' ', '╻', '┃'];
const DOWN_B: string[] = [' ', ' ', '╹', '┃'];
 */
function scrollBar(value: { position: number, total: number, height: number }) {

    if (value.total < value.height) {
        return '┃'.repeat(value.height);
    }

    const double = '┃'.repeat(value.height * 2).split('').map((_, i) => {
        const start = i / value.height / 2;
        const end = (i + 1) / value.height / 2;

        if (start <= clamp(value.position / value.total) &&
            clamp(value.position / value.total) <= end) {
            return '┃';
        }
        if (start <= clamp((value.position + value.height) / value.total) &&
            clamp((value.position + value.height) / value.total) <= end) {
            return '┃';
        }
        if (start >= clamp(value.position / value.total) &&
            end <= clamp((value.position + value.height) / value.total)) {
            return '┃';
        }
        if (start <= clamp(value.position / value.total) &&
            end >= clamp((value.position + value.height) / value.total)) {
            return '┃';
        }

        return '│';
    });

    return '┃'.repeat(value.height).split('').map((_, i) => {
        const start = double[i * 2];
        const end = double[i * 2 + 1];
        switch (`${start}${end}`) {
            case '┃│': return '╿';
            case '│┃': return '╽';
            case '││': return '│';
            case '┃┃': return '┃';
        }
        return '│';
    }).join('');
    /*
    for (var i = 0; i < value.height / 2; i++) {

        const start = double[i * 2];
        const end = double[i * 2 + 1];
        switch (`${start}${end}`) {
            case '┃│': double[i * 2] = '┏'; double[i * 2 + 1] = '┓'; break;
            case '│┃': double[i * 2] = '┗'; double[i * 2 + 1] = '┛'; break;
            case '││': double[i * 2] = '┠'; double[i * 2 + 1] = '┨'; break;
            case '┃┃': double[i * 2] = '┠'; double[i * 2 + 1] = '┨'; break;
        }
        const start = i / value.height;
        const end = (i + 1) / value.height;

        if (end > (value.position + value.height) / value.total &&
            ((start + end) / 2) >= (value.position + value.height) / value.total) {
            double[i] = '╿';
        }

        if (start < value.position / value.total &&
            (start + end) / 2 >= value.position / value.total) {
            double[i] = '╽';
        }
    }

    return '┃'.repeat(value.height).split('').map((_, i) => {
        const start = i / value.height;
        const end = (i + 1) / value.height;

        if (end > (value.position + value.height) / value.total &&
        // ((start + end) / 2) >= (value.position + value.height) / value.total) {
            ((start + end) / 2) <= (value.position + value.height) / value.total) {
            // end >= (value.position + value.height) / value.total) {
            return '╿';
        }

        if (start < value.position / value.total &&
            (start + end) / 2 >= value.position / value.total) {
            return '╽';
        }

        if (start >= clamp(value.position / value.total) &&
            end <= clamp((value.position + value.height) / value.total)) {
            return '┃';
        }

        return '│';
    }).join('');
    */
}