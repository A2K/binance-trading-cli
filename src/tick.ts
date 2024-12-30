
import chalk from 'chalk';
import state from './state';
import { printStats } from './ui';
import { getAssetBallance, lerp, timestampStr } from './utils';
import { addLogMessage } from './ui';
import { order } from './order';
import { readProfits } from './transactions';
import { Ticker } from 'binance-api-node';

export async function tick(priceInfo: Ticker): Promise<void> {
    const symbol = priceInfo.symbol.replace(/USD[CT]$/, '');
    const time = priceInfo.eventTime;

    if (!(symbol in state.assets)) {
        return;
    }

    const duration: number = time - (state.lastTickTime[symbol] || 0);
    state.lastTickTime[symbol] = time;

    if (Math.abs(duration) < 100) {
        return;
    }

    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    if (isSelected && state.candles.data.length) {
        state.candles.data[state.candles.data.length - 1].update(new Date(time), state.assets[symbol].price);
        state.assets[symbol].updateIndicators();
    }

    const currentPrice: number = state.assets[symbol].price;
    const targetAmount: number = state.currencies[symbol];
    const balance: number = await getAssetBallance(symbol);

    const usd: number = balance * currentPrice;

    const delta: number = targetAmount - usd;

    state.velocities[symbol] = lerp(
        (state.velocities[symbol] || 0.0),
        (currentPrice - (state.lastPrice[symbol] || currentPrice)) / currentPrice,
        state.assets[symbol].interpSpeed * duration);

    const deltaPrice: number = currentPrice - (state.lastPrice[symbol] || currentPrice);
    state.lastPrice[symbol] = currentPrice;

    let quantity: number = delta / currentPrice;
    quantity = Math.round(quantity / state.assets[symbol].stepSize) * state.assets[symbol].stepSize;
    const deltaUsd: number = quantity * currentPrice;
    state.deltas[symbol] = deltaUsd;

    printStats(symbol, deltaPrice);

    const velocity: number = state.velocities[symbol] || 0;
    const forceTrade: boolean = state.assets[symbol].forceTrade;
    state.assets[symbol].forceTrade = false;
    if (forceTrade || ((deltaUsd < 0 ? (velocity < 0.1) : (velocity > -0.1))
        && (((deltaUsd > state.assets[symbol].buyThreshold) && state.enableBuy && state.assets[symbol].enableBuy) || deltaUsd < -state.assets[symbol].sellThreshold && state.assets[symbol].enableSell && state.enableSell))) {
        try {
            if ('BNB' in state.assets) {
                if (quantity > 0) {
                    const todayProfits: number = await readProfits(symbol);
                    if ((todayProfits - quantity * state.assets[symbol].price) < -state.assets[symbol].maxDailyLoss && !forceTrade) {
                        quantity = Math.max(0, state.assets[symbol].maxDailyLoss + todayProfits) / state.assets[symbol].price;
                        quantity = Math.round(quantity / state.assets[symbol].stepSize) * state.assets[symbol].stepSize;
                    }
                }

                if (state.assets[symbol].orderInProgress) {
                    return;
                }

                if (Math.abs(quantity * state.assets[symbol].price) > state.assets[symbol].minNotional
                    && Math.abs(quantity) > state.assets[symbol].minQty) {

                    if (process.argv.includes('--dry-run')) {
                        addLogMessage(
                            `🚀 ${quantity} ${symbol} ` +
                            ` -> ${(quantity * state.assets[symbol].price).toFixed(2)} USDT ` +
                            `min ${-(targetAmount * 0.00125)} ` +
                            `max ${(targetAmount * 0.00625)}`
                        );
                        return;
                    }

                    state.assets[symbol].orderInProgress = true;
                    try {
                        await order(symbol, currentPrice, quantity);
                    } finally {
                        state.assets[symbol].orderInProgress = false;
                    }

                    state.deltas[symbol] = 0;

                } else if (forceTrade) {
                    if (Math.abs(quantity * state.assets[symbol].price) < state.assets[symbol].minNotional) {
                        addLogMessage(`🚫 ${timestampStr()} CAN'T BUY ${chalk.yellowBright(Math.abs(quantity).toPrecision(6))} ` +
                            `${chalk.whiteBright(symbol)} at ${chalk.whiteBright(currentPrice.toPrecision(6))} ` +
                            `for ${chalk.yellowBright(Math.abs(quantity * currentPrice).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
                            `because ${chalk.bold('total')} (${Math.abs(quantity * state.assets[symbol].price).toFixed(2)} ${chalk.whiteBright('USDT')}) ` +
                            `is less than ${chalk.whiteBright(state.assets[symbol].minNotional.toFixed(2))} ${chalk.whiteBright('USDT')} (${chalk.bold('minNotional')})`);
                    } else {
                        addLogMessage(`🚫 ${timestampStr()} CAN'T BUY ${Math.abs(quantity)} ${symbol} at ${currentPrice} ` +
                            `for ${chalk.yellowBright(Math.abs(quantity * currentPrice).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
                            `because ${chalk.bold('quantity')} (${Math.abs(quantity).toPrecision(6)} ${chalk.whiteBright(symbol)}) ` +
                            `is less than ${chalk.whiteBright(state.assets[symbol].minNotional.toPrecision(6))} ${chalk.whiteBright(symbol)} (${chalk.bold('minQty')})`);
                    }
                }
            }
        } catch (e) {
            addLogMessage('🚫 TRADE FAILED: ' + quantity + ' of ' + symbol + ' at ' + currentPrice + ': ', e);
        }
    }
}

export default tick;
