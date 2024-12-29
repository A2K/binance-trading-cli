
import chalk from 'chalk';
import state from './state';
import { printStats } from './ui';
import { lerp, timestampStr } from './utils';
import { addLogMessage } from './ui';
import { order } from './order';
import { readProfits } from './transactions';

export async function tick(time: number, symbol: string): Promise<void> {
    if (!(symbol in state.symbols)) {
        return;
    }

    const duration: number = time - (state.lastTickTime[symbol] || 0);
    state.lastTickTime[symbol] = time;

    if (Math.abs(duration) < 100) {
        return;
    }

    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    if (isSelected && state.candles.data.length) {
        state.candles.data[state.candles.data.length - 1].update(new Date(time), state.symbols[symbol].price);
        state.symbols[symbol].updateIndicators();
    }

    const currentPrice: number = state.symbols[symbol].price;
    const targetAmount: number = state.currencies[symbol];
    const balance: number = state.balances[symbol];

    const usd: number = balance * currentPrice;

    const delta: number = targetAmount - usd;

    state.velocities[symbol] = lerp(
        (state.velocities[symbol] || (currentPrice - state.lastPrice[symbol]) / currentPrice),
        (currentPrice - state.lastPrice[symbol]) / currentPrice,
        state.symbols[symbol].interpSpeed * duration);

    const deltaPrice: number = currentPrice - state.lastPrice[symbol];
    state.lastPrice[symbol] = currentPrice;

    let quantity: number = delta / currentPrice;
    quantity = Math.round(quantity / state.symbols[symbol].stepSize) * state.symbols[symbol].stepSize;
    const deltaUsd: number = quantity * currentPrice;
    state.deltas[symbol] = deltaUsd;

    printStats(symbol, deltaPrice);

    const velocity: number = state.velocities[symbol];
    const forceTrade: boolean = state.symbols[symbol].forceTrade;
    state.symbols[symbol].forceTrade = false;
    if (forceTrade || ((deltaUsd < 0 ? (velocity < 0.1) : (velocity > -0.1))
        && (((deltaUsd > state.symbols[symbol].buyThreshold) && state.enableBuy && state.symbols[symbol].enableBuy) || deltaUsd < -state.symbols[symbol].sellThreshold && state.symbols[symbol].enableSell && state.enableSell))) {
        try {
            if ('BNB' in state.symbols) {
                if (quantity > 0) {
                    const todayProfits: number = await readProfits(symbol);
                    if ((todayProfits - quantity * state.symbols[symbol].price) < -state.symbols[symbol].maxDailyLoss && !forceTrade) {
                        quantity = Math.max(0, state.symbols[symbol].maxDailyLoss + todayProfits) / state.symbols[symbol].price;
                        quantity = Math.round(quantity / state.symbols[symbol].stepSize) * state.symbols[symbol].stepSize;
                    }
                }

                if (Math.abs(quantity * state.symbols[symbol].price) > state.symbols[symbol].minNotional
                    && Math.abs(quantity) > state.symbols[symbol].minQty) {

                    if (process.argv.includes('--dry-run')) {
                        addLogMessage(
                            `🚀 ${quantity} ${symbol} ` +
                            ` -> ${(quantity * state.symbols[symbol].price).toFixed(2)} USDT ` +
                            `min ${-(targetAmount * 0.00125)} ` +
                            `max ${(targetAmount * 0.00625)}`
                        );
                        return;
                    }

                    await order(symbol, currentPrice, quantity);
                    state.deltas[symbol] = 0;
                } else if (forceTrade) {
                    if (Math.abs(quantity * state.symbols[symbol].price) < state.symbols[symbol].minNotional) {
                        addLogMessage(`🚫 ${timestampStr()} CAN'T BUY ${chalk.yellowBright(Math.abs(quantity).toPrecision(6))} ` +
                            `${chalk.whiteBright(symbol)} at ${chalk.whiteBright(currentPrice.toPrecision(6))} ` +
                            `for ${chalk.yellowBright(Math.abs(quantity * currentPrice).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
                            `because ${chalk.bold('total')} (${Math.abs(quantity * state.symbols[symbol].price).toFixed(2)} ${chalk.whiteBright('USDT')}) ` +
                            `is less than ${chalk.whiteBright(state.symbols[symbol].minNotional.toFixed(2))} ${chalk.whiteBright('USDT')} (${chalk.bold('minNotional')})`);
                    } else {
                        addLogMessage(`🚫 ${timestampStr()} CAN'T BUY ${Math.abs(quantity)} ${symbol} at ${currentPrice} ` +
                            `for ${chalk.yellowBright(Math.abs(quantity * currentPrice).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
                            `because ${chalk.bold('quantity')} (${Math.abs(quantity).toPrecision(6)} ${chalk.whiteBright(symbol)}) ` +
                            `is less than ${chalk.whiteBright(state.symbols[symbol].minNotional.toPrecision(6))} ${chalk.whiteBright(symbol)} (${chalk.bold('minQty')})`);
                    }
                }
            }
        } catch (e) {
            addLogMessage('🚫 TRADE FAILED: ' + quantity + ' of ' + symbol + ' at ' + currentPrice + ': ', e);
        }
    }
}

export default tick;
