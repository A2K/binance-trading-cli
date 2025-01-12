import { ExecutionReport, ExecutionType, Order, OrderType, TimeInForce } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { formatAssetPrice, formatAssetQuantity, marketCeilPrice, marketCeilQuantity, timestampStr } from './utils';
import { log } from './ui';
import Settings from './settings';
import { clearStakingCache, redeemFlexibleProduct, subscribeFlexibleProductAllFree } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';
import { pullNewTransactions, refreshMaterializedViews } from './transactions';
import chalk from 'chalk';
import { getCandles } from './candles';

const BUY = 'BUY';
const SELL = 'SELL';
export class OptimizedOrder {

    order?: Order;

    public quantity: number = 0;
    public price: number = 0;

    constructor(public symbol: string) { }

    async create(quantity: number, price: number): Promise<boolean> {
        this.quantity = quantity;
        this.price = price;
        try {
            const maxPriceDelta = state.assets[this.symbol].tickSize * Settings.stopPriceOffsetMultiplier;
            const tradePrice = marketCeilPrice(this.symbol, this.price + Math.sign(quantity) * maxPriceDelta);
            const tradeQuantity = marketCeilQuantity(this.symbol, Math.abs(quantity) * this.price / tradePrice);

            this.order = await binance.order({
                symbol: `${this.symbol}${Settings.stableCoin}`,
                side: this.quantity > 0 ? BUY : SELL,
                quantity: formatAssetQuantity(this.symbol, tradeQuantity),
                type: 'STOP_LOSS',
                stopPrice: `${formatAssetPrice(this.symbol, tradePrice)}`
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

    get maxPriceDelta(): number {
        return state.assets[this.symbol].tickSize * Settings.stopPriceOffsetMultiplier;
    }

    async adjust(quantity: number, minPrice: number): Promise<boolean> {
        if (!this.order) {
            return this.create(quantity, minPrice);
        }

        this.quantity = quantity;
        this.price = minPrice;
        try {
            const maxPriceDelta = state.assets[this.symbol].tickSize * Settings.stopPriceOffsetMultiplier;
            const tradePrice = marketCeilPrice(this.symbol, this.price + Math.sign(quantity) * maxPriceDelta);
            const tradeQuantity = marketCeilQuantity(this.symbol, Math.abs(quantity) * this.price / tradePrice);
            this.order = await binance.cancelReplace({
                symbol: this.order.symbol,
                cancelOrderId: this.order.orderId,
                side: this.quantity > 0 ? BUY : SELL,
                quantity: formatAssetQuantity(this.symbol, tradeQuantity),
                type: 'STOP_LOSS',
                stopPrice: `${formatAssetPrice(this.symbol, tradePrice)}`,
                cancelReplaceMode: 'STOP_ON_FAILURE'
            });
        } catch (e) {
            log.warn('Failed to adjust order:', e);
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

    if (state.assets[symbol].currentOrder) {
        return false;
    }

    if (quantity < 0) {
        if ((await state.wallet.total(symbol)) < Math.abs(quantity)) {
            state.assets[symbol].stakingInProgress = true;
            const amountToUnstake = marketCeilPrice(symbol, Math.abs(quantity) - (await state.wallet.total(symbol)));
            try {
                await redeemFlexibleProduct(symbol, amountToUnstake);
            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(amountToUnstake)} ${chalk.whiteBright(symbol)}:`, e);
            }
        }
    } else {
        if (await state.wallet.free(Settings.stableCoin) < quantity * state.assets[symbol].price) {
            state.assets[symbol].stakingInProgress = true;
            const amountToUnstake = marketCeilPrice(symbol, quantity * state.assets[symbol].price
                - (await state.wallet.free(Settings.stableCoin)) / state.assets[symbol].price);
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeilPrice(symbol, amountToUnstake));
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

    if (state.assets[symbol].currentOrder) {
        return false;
    }

    state.assets[symbol].currentOrder = new OptimizedOrder(symbol);

    const orderCreated = await state.assets[symbol].currentOrder!.adjust(quantity, state.assets[symbol].price);

    if (!orderCreated) {
        log.err('Failed to create order', symbol, quantity);
        state.assets[symbol].currentOrder?.cancel();
        delete state.assets[symbol].currentOrder;
    }

    return orderCreated;
}
