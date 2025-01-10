import { ExecutionReport, ExecutionType, Order, OrderType, TimeInForce } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { formatAssetPrice, formatAssetQuantity, marketCeil, timestampStr } from './utils';
import { log } from './ui';
import Settings from './settings';
import { clearStakingCache, redeemFlexibleProduct, subscribeFlexibleProductAllFree } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';
import { pullNewTransactions, refreshMaterializedViews } from './transactions';
import chalk from 'chalk';
import { getCandles } from './candles';

export class OptimizedOrder {

    order?: Order;

    public quantity: number = 0;
    public price: number = 0;

    constructor(public symbol: string) { }

    async create(quantity: number, price: number): Promise<boolean> {
        this.quantity = quantity;
        this.price = price;
        try {
            const candle = (await getCandles(this.symbol, '1m', 1))[0];
            const maxPriceDelta = Math.max(candle.high - candle.low, Math.abs(candle.open - candle.close));

            this.order = await binance.order({
                symbol: `${this.symbol}${Settings.stableCoin}`,
                side: this.quantity > 0 ? 'BUY' : 'SELL',
                quantity: formatAssetQuantity(this.symbol, Math.abs(this.quantity)),
                type: 'STOP_LOSS',
                stopPrice: `${formatAssetPrice(this.symbol, this.price + Math.sign(quantity) * maxPriceDelta)}`
            });

            return true;
        } catch (e) {
            log.err('Failed to create order:', e);
            if (this.order) {
                try {
                    await this.cancel();
                } catch (e) { }
                delete this.order;
            }
            return false;
        }
    }

    async adjust(quantity: number, minPrice: number): Promise<boolean> {
        if (!this.order) {
            return this.create(quantity, minPrice);
        }

        this.quantity = quantity;
        this.price = minPrice;

        try {

            const candles = await getCandles(this.symbol, '1m', 10);
            // const maxPriceDelta = 0.25 * candles.reduce((acc, candle) => Math.max(acc, candle.high - candle.low), 0);
            const maxPriceDelta = 0.25 * state.assets[this.symbol].tickSize;

            if (this.quantity > 0) {
                const stopPrice = this.price + maxPriceDelta;
                if (stopPrice < parseFloat(this.order.stopPrice || 'inf')) {
                    this.order = await binance.cancelReplace({
                        symbol: this.order.symbol,
                        cancelOrderId: this.order.orderId,
                        side: 'BUY',
                        quantity: formatAssetQuantity(this.symbol, Math.abs(this.quantity)),
                        type: 'STOP_LOSS',
                        stopPrice: `${formatAssetPrice(this.symbol, stopPrice)}`,
                        cancelReplaceMode: 'ALLOW_FAILURE'
                    });
                }
            } else {
                const stopPrice = this.price - maxPriceDelta;
                if (stopPrice > parseFloat(this.order.stopPrice || 'inf')) {
                    this.order = await binance.cancelReplace({
                        symbol: this.order.symbol,
                        cancelOrderId: this.order.orderId,
                        side: 'SELL',
                        quantity: formatAssetQuantity(this.symbol, Math.abs(this.quantity)),
                        type: 'STOP_LOSS',
                        stopPrice: `${formatAssetPrice(this.symbol, stopPrice)}`,
                        cancelReplaceMode: 'ALLOW_FAILURE'
                    });
                }
            }
        } catch (e) {
            log.warn('Failed to adjust order:', e);
            if ((e as Error).message === 'Error: Order cancel-replace partially failed.') {
                // ???
                return true;
            }
            if (this.order) {
                await this.cancel();
                delete this.order;
            }
            return false;
        }

        return true;
    }

    async cancel() {
        if (this.order) {
            try {
                log.notice('Cancelling order:', this.order.orderId);
                await binance.cancelOrder({
                    symbol: this.order.symbol,
                    orderId: this.order.orderId
                })
            } catch (e) { }
            delete this.order;
        }
    }

    async complete(report: ExecutionReport): Promise<boolean> {
        return report.orderId == this.order?.orderId;
    }
}

async function test() {
    const price = (await binance.prices({ symbol: 'BNBUSDT' }))['BNBUSDT'];
    const exchangeInfo = await binance.exchangeInfo({ symbol: 'BNBUSDT' });
    exchangeInfo.symbols[0].filters

    const order = new OptimizedOrder('BNB');
    console.log(await order.adjust(0.01, parseFloat(price) * 1.001 ));
}

// test()

export async function order(symbol: string, quantity: number): Promise<boolean> {
    if (quantity < 0) {
        if (await state.wallet.free(symbol) < Math.abs(quantity)) {
            const amountToUnstake = marketCeil(symbol, Math.abs(quantity) - (await state.wallet.free(symbol)) / state.assets[symbol].price);
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(symbol, amountToUnstake);
                clearStakingCache(symbol);
                state.wallet.markOutOfDate(symbol);
            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(amountToUnstake)} ${chalk.whiteBright(symbol)}:`, e);
            }
        }
    } else {
        if (await state.wallet.free(Settings.stableCoin) < quantity * state.assets[symbol].price) {
            state.assets[symbol].stakingInProgress = true;
            const amountToUnstake = quantity * state.assets[symbol].price - (await state.wallet.free(Settings.stableCoin)) / state.assets[symbol].price;
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeil(symbol, amountToUnstake));

            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(amountToUnstake)} ${chalk.whiteBright(Settings.stableCoin)}:`, e);
            }
        }
    }

    if (state.assets[symbol].stakingInProgress) {
        state.assets[symbol].stakingInProgress = false;
        clearStakingCache(symbol);
        state.wallet.markOutOfDate(symbol);
    }

    try {
        if (state.assets[symbol].currentOrder) {

            const currentMarketPriceStr = formatAssetPrice(symbol, state.assets[symbol].price);
            const currentMarketPrice = parseFloat(currentMarketPriceStr);
            const orderMarketPriceStr = formatAssetPrice(symbol, state.assets[symbol].currentOrder!.price);
            const orderMarketPrice = parseFloat(orderMarketPriceStr);
            if (Math.sign(state.assets[symbol].currentOrder!.quantity) == Math.sign(quantity)) {
                if ((quantity > 0 && (currentMarketPrice > orderMarketPrice)) ||
                    (quantity < 0 && (orderMarketPrice > currentMarketPrice))) {
                    log.notice('Order already in progress with the same sign and better price');
                    return false;
                }
            }
            if (!await state.assets[symbol].currentOrder?.adjust(quantity, parseFloat(state.assets[symbol].bestBid))) {
                log.err('Failed to adjust order, cancelling it');
                await state.assets[symbol].currentOrder?.cancel();
                delete state.assets[symbol].currentOrder;
                return false;
            }
            return true;
        }

        state.assets[symbol].currentOrder = new OptimizedOrder(symbol);

        const orderCreated = await state.assets[symbol].currentOrder!.adjust(quantity, state.assets[symbol].price);

        if (!orderCreated) {
            log.err('Failed to create order', symbol, quantity);
            state.assets[symbol].currentOrder?.cancel();
            delete state.assets[symbol].currentOrder;
        }

        return orderCreated;
    } catch (e) {
        log.err('Failed to create order:', e);
        if (state.assets[symbol].currentOrder) {
            await state.assets[symbol].currentOrder?.cancel();
            delete state.assets[symbol].currentOrder;
        }

        return false;
    }
}
