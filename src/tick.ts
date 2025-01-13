
import chalk from 'chalk';
import state from './state';
import { formatDeltaQuantity, printStats } from './ui';
import { formatAssetPrice, getAssetBallance, lerp, marketRound, timestampStr } from './utils';
import { log } from './ui';
import { order } from './optimized-order';
import { readProfits } from './transactions';
import { Ticker } from 'binance-api-node';
import binance from './binance-ext/throttled-binance-api';
import { getCandles } from './candles';
import { getStakedQuantity } from './autostaking';
import Settings from './settings';

var __calculatingIndicators = false;
export async function tick(priceInfo: Ticker): Promise<void> {
    const symbol = priceInfo.symbol.replace(/USD[CT]$/, '');
    const time = priceInfo.eventTime;

    if (!(symbol in state.assets)) {
        return;
    }

    const duration: number = time - (state.lastTickTime[symbol] || 0);
    state.lastTickTime[symbol] = time;

    const isSelected: boolean = Object.keys(state.currencies).sort().indexOf(symbol) === state.selectedRow;

    if (isSelected && state.candles.data?.length) {
        state.candles.data.data[state.candles.data?.length - 1].update(new Date(time), state.assets[symbol].price);
        if (!__calculatingIndicators) {
            __calculatingIndicators = true;
            state.assets[symbol].updateIndicators().then(() => __calculatingIndicators = false);
        }
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

    let quantity: number = marketRound(symbol, delta / currentPrice);
    const deltaUsd: number = quantity * currentPrice;
    state.deltas[symbol] = deltaUsd;

    printStats(symbol, deltaPrice);

    if (!binance.canStakeOrRedeem || (!state.enableBuy && !state.enableSell)) {
        return;
    }

    if (state.assets[symbol].currentOrder) {
        if (state.assets[symbol].orderCreationInProgress) {
            return;
        }
        try {
            state.assets[symbol].orderCreationInProgress = true;
            const currentMarketPriceStr = formatAssetPrice(symbol, currentPrice);
            const currentMarketPrice = parseFloat(currentMarketPriceStr);
            const orderMarketPriceStr = formatAssetPrice(symbol, state.assets[symbol].currentOrder!.price);
            const orderMarketPrice = parseFloat(orderMarketPriceStr);
            /*if (Math.sign(state.assets[symbol].currentOrder!.quantity) !== Math.sign(quantity)) {
                log.warn(`CANCELING ORDER: ${symbol} at ${orderMarketPriceStr} -> ${orderMarketPriceStr}`);
                await state.assets[symbol].currentOrder!.cancel();
                state.assets[symbol].currentOrder = undefined;
            } else*/
            if ((quantity > 0 && currentMarketPrice < orderMarketPrice) ||
                (quantity < 0 && currentMarketPrice > orderMarketPrice)) {
                log.notice(`📝 ${chalk.yellow(state.assets[symbol].currentOrder?.order?.orderId)} ${formatDeltaQuantity(symbol, quantity)} ${chalk.whiteBright(symbol)} at ${chalk.yellow(orderMarketPriceStr)} -> ${chalk.yellowBright(currentMarketPriceStr)} `);
                await state.assets[symbol].currentOrder!.adjust(quantity, currentPrice);
                // if (!(await state.assets[symbol].currentOrder!.adjust(quantity, currentPrice))) {
                //     if (state.assets[symbol].currentOrder) {
                //         await state.assets[symbol].currentOrder!.cancel();
                //         state.assets[symbol].currentOrder = undefined;
                //     }
                // }
            }
        } catch (e) {
            log.err('Failed to adjust order: ' + quantity + ' ' + symbol + ' at ' + currentPrice + ': ', e);
        }

        state.assets[symbol].orderCreationInProgress = false;
        return;
    }

    if (state.assets[symbol].stopLossPrice > 0 &&
        state.assets[symbol].price < state.assets[symbol].stopLossPrice) {
        log.warn(`STOP LOSS HIT: ${symbol} at ${currentPrice} -> ${deltaUsd}`);
        state.currencies[symbol] = 0;
        state.assets[symbol].forceTrade = true;
    } else if (state.assets[symbol].takeProfitPrice > 0 &&
        state.assets[symbol].price > state.assets[symbol].takeProfitPrice) {
        log.warn(`TAKE PROFIT HIT: ${symbol} at ${currentPrice} -> ${deltaUsd}`);
        state.currencies[symbol] = 0;
        state.assets[symbol].forceTrade = true;
    }

    const forceTrade: boolean = state.assets[symbol].forceTrade;
    state.assets[symbol].forceTrade = false;
    if (forceTrade
        || (((deltaUsd > state.assets[symbol].buyThreshold) && state.enableBuy && state.assets[symbol].enableBuy)
        || deltaUsd < -state.assets[symbol].sellThreshold && state.assets[symbol].enableSell && state.enableSell)) {
        try {
            if ('BNB' in state.assets) {
                if (quantity > 0) {
                    const todayProfits: number = await readProfits(symbol);
                    if ((todayProfits - quantity * state.assets[symbol].price) < -state.assets[symbol].maxDailyLoss && !forceTrade) {
                        quantity = marketRound(symbol,
                            Math.max(0, state.assets[symbol].maxDailyLoss + todayProfits) / state.assets[symbol].price);
                    }
                }

                if (Math.abs(quantity * state.assets[symbol].price) > state.assets[symbol].minNotional
                    && Math.abs(quantity) > state.assets[symbol].minQty) {

                    if (quantity > 0 && deltaUsd > await state.wallet.total(Settings.stableCoin) + await getStakedQuantity(Settings.stableCoin)) {
                        // not enough for buying
                        return;
                    }

                    if (process.argv.includes('--dry-run')) {
                        log(
                            `🚀 ${quantity} ${symbol} ` +
                            ` -> ${(quantity * state.assets[symbol].price).toFixed(2)} USDT ` +
                            `min ${-(targetAmount * 0.00125)} ` +
                            `max ${(targetAmount * 0.00625)}`
                        );
                        return;
                    }

                    (async () => {
                        if (state.assets[symbol].orderCreationInProgress) {
                            return;
                        }
                        state.assets[symbol].orderCreationInProgress = true;
                        try {
                            await order(symbol, quantity);
                        } catch (e) {
                            log.err('TRADE FAILED: ' + quantity + ' of ' + symbol + ' at ' + currentPrice + ': ', e);
                            if (state.assets[symbol].currentOrder) {
                                state.assets[symbol].currentOrder?.cancel()
                                delete state.assets[symbol].currentOrder;
                            }
                        }
                        state.assets[symbol].orderCreationInProgress = false;
                    })();

                } else if (forceTrade) {
                    if (Math.abs(quantity * state.assets[symbol].price) < state.assets[symbol].minNotional) {
                        log.err(`CAN'T BUY ${chalk.yellowBright(Math.abs(quantity).toPrecision(6))} ` +
                            `${chalk.whiteBright(symbol)} at ${chalk.whiteBright(currentPrice.toPrecision(6))} ` +
                            `for ${chalk.yellowBright(Math.abs(quantity * currentPrice).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
                            `because ${chalk.bold('total')} (${Math.abs(quantity * state.assets[symbol].price).toFixed(2)} ${chalk.whiteBright('USDT')}) ` +
                            `is less than ${chalk.whiteBright(state.assets[symbol].minNotional.toFixed(2))} ${chalk.whiteBright('USDT')} (${chalk.bold('minNotional')})`);
                    } else {
                        log.err(`CAN'T BUY ${Math.abs(quantity)} ${symbol} at ${currentPrice} ` +
                            `for ${chalk.yellowBright(Math.abs(quantity * currentPrice).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
                            `because ${chalk.bold('quantity')} (${Math.abs(quantity).toPrecision(6)} ${chalk.whiteBright(symbol)}) ` +
                            `is less than ${chalk.whiteBright(state.assets[symbol].minNotional.toPrecision(6))} ${chalk.whiteBright(symbol)} (${chalk.bold('minQty')})`);
                    }
                }
            }
        } catch (e) {
            log.err('TRADE FAILED: ' + quantity + ' of ' + symbol + ' at ' + currentPrice + ': ', e);
        }
    }
}

export default tick;
