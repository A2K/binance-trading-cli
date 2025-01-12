import { OrderType } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { formatAssetQuantity, marketCeilPrice, timestampStr } from './utils';
import { log } from './ui';
import Settings from './settings';
import { clearProfitsCache, clearStakingCache, redeemFlexibleProduct, subscribeFlexibleProductAllFree } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';
import { pullNewTransactions, refreshMaterializedViews } from './transactions';
import chalk from 'chalk';

export async function order(symbol: string, quantity: number): Promise<boolean> {
    if (quantity < 0) {
        if (await state.wallet.total(symbol) < Math.abs(quantity)) {
            const amountToUnstake = marketCeilPrice(symbol, Math.abs(quantity) - (await state.wallet.free(symbol)));
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(symbol, amountToUnstake);
            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(amountToUnstake)} ${chalk.whiteBright(symbol)}:`, e);
            }
        }
    } else {
        if (await state.wallet.total(Settings.stableCoin) < quantity) {
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeilPrice(symbol, quantity - await state.wallet.free(Settings.stableCoin)));
            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(quantity - await state.wallet.free(Settings.stableCoin))} ${chalk.whiteBright(Settings.stableCoin)}:`, e);
            }
        }
    }

    if (state.assets[symbol].stakingInProgress) {
        state.assets[symbol].stakingInProgress = false;
        clearStakingCache(symbol);
        state.wallet.markOutOfDate(symbol);
    }

    const orderQuantity = formatAssetQuantity(symbol, Math.abs(quantity));
    log(`Creating order to ${quantity >= 0 ? `🪙 ${chalk.yellowBright('BUY')}` : `💵 ${chalk.greenBright('SELL')}`} ${chalk.yellow(orderQuantity)} ${chalk.whiteBright(symbol)}`);

    const completedOrder = await binance.order({
        symbol: `${symbol}${Settings.stableCoin}`,
        side: quantity >= 0 ? 'BUY' : 'SELL',
        quantity: orderQuantity,
        type: OrderType.MARKET,
    });

    if (!completedOrder || completedOrder.status === 'EXPIRED') {
        log.err(`Fail to ${quantity >= 0 ? `🪙 ${chalk.yellowBright('BUY')}` : `💵 ${chalk.greenBright('SELL')}`} ${chalk.yellow(formatAssetQuantity(symbol, Math.abs(quantity)))} ${chalk.whiteBright(symbol)}`);
        return false;
    }

    state.wallet.markOutOfDate(symbol);
    clearProfitsCache(symbol);

    state.assets[symbol].showTradeStartTime = new Date();

    if (quantity > 0 && state.assets[symbol].staking) {
        await subscribeFlexibleProductAllFree(symbol);
        clearStakingCache(symbol);
        state.wallet.markOutOfDate(symbol);
    }

    return true;
}
