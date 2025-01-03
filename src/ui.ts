
import chalk from 'chalk';
import state from './state';
import Settings from './settings';
import readline from 'readline';
import candles, { Candle, LiveCandleData } from './candles';
import { bgLerp, lerpColor, lerpChalk, clamp, formatFloat, getAssetBallance, formatAssetQuantity, progressBarText, verticalBar, trimTrailingZeroes } from './utils';
import { readProfits, readTransactionLog } from './transactions';
import { CandleChartInterval_LT } from 'binance-api-node';
import { getStakedQuantity, getStakingEffectiveAPR, getStakingEffectiveAPRAverage } from './autostaking';
import { getLiveIndicator, LiveOHLCVHistory } from './indicators';
import { sma, ema, rsi, stochasticrsi, getDetachSourceFromOHLCV } from 'trading-indicator';

var logMessages: string[] = [];

export const addLogMessage = (...msgs: any[]): void => {
    logMessages.push(msgs.map(msg => msg ? msg.toString() : `${msg}`).join(' '));
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
    const alpha: number = clamp(1.0 - (Date.now() - (state.assets[symbol].showTradeStartTime?.getTime() || 0)) / 10.0);

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

    if (!(symbol in state.assets)) {
        return;
    }

    let deltaPrice: number = state.assets[symbol].deltaPrice || 0;
    const relativeDeltaPrice: number = deltaPrice / (state.assets[symbol].price || 1);

    const symbolProfit: number = await readProfits(symbol, '1 day');

    const relativePriceColor: chalk.Chalk = chalk.rgb(relativeDeltaPrice < 0 ?
        Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, relativeDeltaPrice * 500)) || 0)) :
        0,
        relativeDeltaPrice < 0 ? 0 :
            Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, -relativeDeltaPrice * 500)) || 0)),
        0);

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
    //   state.symbols[symbol].pnl = PNL;
    const effectiveAPR = await getStakingEffectiveAPR(symbol);
    const loss = {
        current: Math.max(0, state.assets[symbol].maxDailyLoss + (await readProfits(symbol))),
        max: state.assets[symbol].maxDailyLoss
    };

    function remap(a: number, from: number[], to: number[] = [0, 1]): number {
        return (a - from[0]) / (from[1] - from[0]) * (to[1] - to[0]) + to[0];
    }
    state.assets[symbol].statusLine = `${state.assets[symbol].orderInProgress?'⌛':'📈'} ${symbol.padEnd(8)} ${makeVelocitySymbol((state.velocities[symbol] || 0))}` +

        `${colorizeChangedPart(symbol, state.assets[symbol].price - deltaPrice, state.assets[symbol].price, 13)}` +

        str +
        ` ${lerpChalk([200, 200, 200], [100, 255, 100], remap(effectiveAPR, [0, 0.005]))((effectiveAPR * 100).toFixed(2).padStart(5))}` +

        ` ${(deltaUsd < 0 ? (-deltaUsd > state.assets[symbol].sellThreshold ? chalk.greenBright : chalk.green) :
            (deltaUsd > state.assets[symbol].buyThreshold ? chalk.redBright : chalk.red))(colorizeDeltaUsd(symbol, -deltaUsd))} ` +
        await colorizeSymbolProfit(symbol, symbolProfit) + ' ' +
        (state.assets[symbol].staking ? '💸' : '💰') + ' ' +
        chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50)(lerpChalk([255,0,0],[0,255,0],loss.max === 0 ? 0 : loss.current / loss.max)(verticalBar(loss)) + state.assets[symbol].maxDailyLoss.toFixed(0).padEnd(4)) +
        (state.assets[symbol].enableSell ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(
            `${state.assets[symbol].enableSell ? '🟢' : '🟥'}` +
            `${chalk.green(state.assets[symbol].sellThreshold.toFixed(0).padEnd(4))}`) +
            (state.assets[symbol].enableBuy ? chalk.bgRgb(isSelected ? 50 : 25, isSelected ? 100 : 50, isSelected ? 50 : 25) : chalk.bgRgb(isSelected ? 100 : 50, isSelected ? 100 : 50, isSelected ? 100 : 50))(`${state.assets[symbol].enableBuy ? '🟢' : '🟥'}` +
            `${chalk.red('-' + state.assets[symbol].buyThreshold.toFixed(0).padEnd(4))}`) +

       lerpChalk([200, 0, 0], [0, 200, 0], PNL > 0 ? 1 : 0)(PNL.toFixed(2).padStart(9));

    const keys: string[] = Object.keys(state.currencies).sort();
    readline.cursorTo(process.stdout, 0, keys.indexOf(symbol));
    if (keys.indexOf(symbol) == state.selectedRow) {
        process.stdout.write(chalk.bgBlackBright(state.assets[symbol].statusLine));
    } else {
        process.stdout.write(state.assets[symbol].statusLine);
    }
    if (state.selectedRow < 0) {
        readline.clearLine(process.stdout, 1);
    }

    if (Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow) {
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

    const profits: number = await readProfits();

    const deltaSum: number = Object.keys(state.currencies).reduce((acc, delta) => acc + (state.deltas[delta] || 0), 0);
    const deltaSumStr: string = (deltaSum < 0 ? '+' : '') + (-deltaSum).toFixed(2);
    const profitsStr: string = (profits >= 0 ? '+' : '') + profits.toFixed(2);
    const deltaSumColor: chalk.Chalk = deltaSum <= 0 ? chalk.green : chalk.red;
    const profitsColor: chalk.Chalk = profits >= 0 ? chalk.green : chalk.red;

    const stakedBalance = await getAssetBallance(Settings.stableCoin);
    const padded: string = `${Math.round(stakedBalance + state.balances[Settings.stableCoin])} +${('' + state.steps[state.step])} =`;
    const padding: string = ' '.repeat(Math.max(0, 14 - padded.length));

    const avgStakingRate = await getStakingEffectiveAPRAverage();

    const str = `📋 ` + (state.enableSell ? chalk.bgGreen : chalk.bgRed)('F1💵') +
        ' ' + (state.enableBuy ? chalk.bgGreen : chalk.bgRed)('F2🪙') +
        (padding + `${Math.round(stakedBalance + state.balances[Settings.stableCoin])}` +
        ` ${chalk.grey('±')}${('' + state.steps[state.step])}` +
            ` ${chalk.yellow('⇄')} `) +
        `${Math.round(Object.values(state.currencies).reduce((acc, currency) => acc + currency, 0)).toFixed(0).padEnd(10)}` +
        ' ' +
        (avgStakingRate * 100).toFixed(2).padStart(5) + ' ' +

        `${deltaSumColor(deltaSumStr.padEnd(11))}${profitsColor(profitsStr.padEnd(11))}   ` +

        chalk.bgRgb(50, 25, 25)(
            `${chalk.red('↓')}${chalk.whiteBright('<')}${chalk.green('↑')}${chalk.whiteBright('>')}  ` +
            `${chalk.red('↓')}${chalk.whiteBright('-')}${chalk.green('↑')}${chalk.whiteBright('=')}   ` +
            `${chalk.red('↓')}${chalk.whiteBright('[')}${chalk.green('↑')}${chalk.whiteBright(']')} `);
    readline.cursorTo(process.stdout, 0, Object.keys(state.currencies).length);
    process.stdout.write(str);

}

var __drawCandlesCallCounter: number = 0;
export async function drawCandles(symbol: string, currency: string = 'USDT'): Promise<void> {
    const callId = ++__drawCandlesCallCounter;
    const candlesX: number = Settings.showTime ? state.candles.XBase + 10 : state.candles.XBase - 10;
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
        state.candles.data = new LiveCandleData(symbol, currency,
            state.candles.scales[state.candles.scale] as CandleChartInterval_LT,
            candlesWidth, false);
        await state.candles.data.init();
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

    const delInsStr: string = `DEL⮜ ${state.candles.scales[state.candles.scale]} ⮞INS`;
    readline.cursorTo(process.stdout, (process.stdout.columns || 120) - delInsStr.length - 1, rows.length);

    process.stdout.write(delInsStr.replace('DEL', chalk.whiteBright('DEL')).replace('INS', chalk.whiteBright('INS')).replace(/⮜ (.*) ⮞/, '⮜ ' + chalk.bgWhite(chalk.black('$1')) + ' ⮞'));

    readline.clearLine(process.stdout, 1);
    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    const indicatorsOffset = 0;
    if (isSelected && state.assets[symbol].indicatorValues.SMAs) {

        const formatIndicator = (symbol: string, value: number): string => {
            if (isNaN(value)) {
                return ' '.repeat(7);
            }
            value = value || 0;
            let diff: number = (value - state.assets[symbol].price) / state.assets[symbol].price * 100;
            diff = Math.min(1.0, Math.max(-1.0, diff / 10));
            return (diff > 0 ? bgLerp([0, 0, 0], [255, 0, 0], diff) : bgLerp([0, 0, 0], [0, 255, 0], -diff))((Math.abs(diff) < 0.5 ? chalk.white : chalk.black)(((value > state.assets[symbol].price ? '+' : '') + ((value - state.assets[symbol].price) / state.assets[symbol].price * 100).toFixed(2) + '%').padStart(7))) ;
        }

        const formatRsiIndicator = (s: number): string => {
            if (isNaN(s)) {
                return '   '
            }
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

        const indicatorPeriods = ['1h', '1d', '1w', '1M'];
        const indicators = {
            SMA: await Promise.all(indicatorPeriods.map(p => makeSMA(p))),
            EMA: await Promise.all(indicatorPeriods.map(p => makeEMA(p))),
            RSI: await Promise.all(indicatorPeriods.map(p => makeRSI(p))),
            stRSI: await Promise.all(indicatorPeriods.map(p => makeStRSI(p)))
        };

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
        process.stdout.write(`   SMA${SMAsymbol} ` +
            `${formatIndicator(symbol, (await makeSMA('1h')).value)} ` +
            `${formatIndicator(symbol, (await makeSMA('1d')).value)} ` +
            `${formatIndicator(symbol, (await makeSMA('1w')).value)} ` +
            `${formatIndicator(symbol, (await makeSMA('1M')).value)}`);
        readline.clearLine(process.stdout, 1);

        readline.cursorTo(process.stdout, candlesX, state.candles.height + indicatorsOffset + 3);
        process.stdout.write(`   EMA${EMAsymbol} ` +
            `${formatIndicator(symbol, (await makeEMA('1h')).value)} ` +
            `${formatIndicator(symbol, (await makeEMA('1d')).value)} ` +
            `${formatIndicator(symbol, (await makeEMA('1w')).value)} ` +
            `${formatIndicator(symbol, (await makeEMA('1M')).value)}`);
        readline.clearLine(process.stdout, 1);

        readline.cursorTo(process.stdout, candlesX, state.candles.height + indicatorsOffset + 4);
        process.stdout.write(`   RSI${RSIsymbol} ` +
            `${formatRsiIndicator((await makeRSI('1h')).value)} ` +
            `${formatRsiIndicator((await makeRSI('1d')).value)} ` +
            `${formatRsiIndicator((await makeRSI('1w')).value)} ` +
            `${formatRsiIndicator((await makeRSI('1M')).value)}`);
        readline.clearLine(process.stdout, 1);

        readline.cursorTo(process.stdout, candlesX, state.candles.height + indicatorsOffset + 5);
        process.stdout.write(` stRSI${stRSIsymbol} ` +
            `${formatRsiIndicator((await makeStRSI('1h')).value)} ` +
            `${formatRsiIndicator((await makeStRSI('1d')).value)} ` +
            `${formatRsiIndicator((await makeStRSI('1w')).value)} ` +
            `${formatRsiIndicator((await makeStRSI('1M')).value)}`);
        readline.clearLine(process.stdout, 1);

        // process.stdout.write(`     SMA ${state.assets[symbol].indicatorValues.SMAs.map(s => {
        //     if (isNaN(s)) return '';
        //     let diff: number = (s - state.assets[symbol].price) / state.assets[symbol].price * 100;
        //     diff = Math.min(1.0, Math.max(-1.0, diff));
        //     return (diff > 0 ? bgLerp([0, 0, 0], [255, 0, 0], diff) : bgLerp([0, 0, 0], [0, 255, 0], -diff))((Math.abs(diff) < 0.5 ? chalk.white : chalk.black)(s ? s.toPrecision(8) : s));
        // }).join(' ')} `);
    }
/*
    if (isSelected && state.assets[symbol].indicatorValues.EMAs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 2);
        process.stdout.write(`     EMA ${state.assets[symbol].indicatorValues.EMAs.map(s => {
            if (isNaN(s)) return '';
            let diff: number = (s - state.assets[symbol].price) / state.assets[symbol].price * 100;
            diff = Math.min(1.0, Math.max(-1.0, diff));
            return (diff > 0 ? bgLerp([0, 0, 0], [255, 0, 0], diff) : bgLerp([0, 0, 0], [0, 255, 0], -diff))((Math.abs(diff) < 0.5 ? chalk.white : chalk.black)(s ? s.toPrecision(8) : s));
        }).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }
    if (isSelected && state.assets[symbol].indicatorValues.RSIs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 3);
        process.stdout.write(`     RSI ${state.assets[symbol].indicatorValues.RSIs.filter(isFinite)
            .map(s =>
                lerpChalk(lerpColor([200, 200, 200], [255, 125, 125], s / 50), lerpColor([200, 200, 200], [125, 255, 125], (s - 50) / 50), s < 50 ? 0 : 1)
                    (('' + Math.round(s)).padStart(3))).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }
    if (isSelected && state.assets[symbol].indicatorValues.StochasticRSIs) {
        readline.cursorTo(process.stdout, candlesX, state.candles.height + 4);
        process.stdout.write(`   stRSI ${state.assets[symbol].indicatorValues.StochasticRSIs.filter(isFinite).map(s =>
            lerpChalk(lerpColor([200, 200, 200], [255, 125, 125], s / 50), lerpColor([200, 200, 200], [125, 255, 125], (s - 50) / 50), s < 50 ? 0 : 1)
                (('' + Math.round(s)).padStart(3))).join(' ')} `);
        readline.clearLine(process.stdout, 1);
    }
    */

    const indicatorsOffser2 = indicatorsOffset + 6;

    if (isSelected) {
        const width: number = 20;
        readline.cursorTo(process.stdout, candlesX, state.candles.height);
        const progress: number = clamp((state.assets[symbol].price - state.assets[symbol].lowPrice) / (state.assets[symbol].highPrice - state.assets[symbol].lowPrice));

        process.stdout.write('    ' + lerpChalk([255, 0, 0], [0, 255, 0], progress)('■'.repeat(Math.round(progress * width))) +
            chalk.gray('□'.repeat(Math.round((1.0 - progress) * width))));
    }
    if (isSelected) {
        const width: number = 20;
        // readline.cursorTo(process.stdout, candlesX, state.candles.height + indicatorsOffser2 + 4);
        // readline.clearLine(process.stdout, 1);

        const halfWidth: number = Math.floor(width / 2);
        const velocity: number = state.velocities[symbol] || 0;
        const alpha: number = Math.floor(Math.abs(velocity * width * 10000));
        // process.stdout.write('      ');
        var speedStr = '';
        if (state.velocities[symbol] > 0) {
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
        readline.cursorTo(process.stdout, candlesX + 30, state.candles.height);
        process.stdout.write(speedStr);
    }
}

export function printTrades(): void {
    while (logMessages.length > (process.stdout.rows || 80) - Object.keys(state.currencies).length - 1) {
        logMessages.shift();
    }

    for (let i = 0; i < logMessages.length; i++) {
        readline.cursorTo(process.stdout, 0, Object.keys(state.currencies).length + (logMessages.length - i));
        process.stdout.write(logMessages[i]);
        readline.clearLine(process.stdout, 1);
    }
}

export async function printTransactions(symbol?: string): Promise<void> {
    const trades = await readTransactionLog(symbol, (process.stdout.rows || 120) - Object.keys(state.currencies).length - 1);
    // trades.map(trade => trade.toString()).forEach(addLogMessage);
    for (const trade of trades.reverse()) {
        addLogMessage(trade.toString());
    }
}