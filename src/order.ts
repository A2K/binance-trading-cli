import { OrderType } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { formatAssetQuantity, marketCeil, timestampStr } from './utils';
import { log } from './ui';
import Settings from './settings';
import { clearStakingCache, redeemFlexibleProduct, subscribeFlexibleProductAllFree } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';
import { pullNewTransactions, refreshMaterializedViews } from './transactions';
import chalk from 'chalk';

export async function order(symbol: string, quantity: number): Promise<boolean> {
    if (quantity < 0) {
        if (await state.wallet.free(symbol) < Math.abs(quantity)) {
            const amountToUnstake = marketCeil(symbol, Math.abs(quantity) - parseFloat((await state.wallet.get(symbol)).free));
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(symbol, amountToUnstake);
            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(amountToUnstake)} ${chalk.whiteBright(symbol)}:`, e);
            }
        }
    } else {
        if (await state.wallet.free(Settings.stableCoin) < quantity) {
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeil(symbol, quantity - await state.wallet.free(Settings.stableCoin)));
            } catch (e) {
                log.err(`Failed to redeem ${chalk.yellow(quantity - await state.wallet.free(Settings.stableCoin))} ${chalk.whiteBright(Settings.stableCoin)}:`, e);
            }
        }
    }

    state.assets[symbol].stakingInProgress = false;


    const orderQuantity = formatAssetQuantity(symbol, Math.abs(quantity));
    log(`Creating ${chalk.greenBright('MARKET')} order to ${quantity >= 0 ? `🪙 ${chalk.yellowBright('BUY')}` : `💵 ${chalk.greenBright('SELL')}`} ${chalk.yellow(orderQuantity)} ${chalk.whiteBright(symbol)}`);

    const completedOrder = await binance.order({
        symbol: `${symbol}${Settings.stableCoin}`,
        side: quantity >= 0 ? 'BUY' : 'SELL',
        quantity: orderQuantity,
        type: OrderType.MARKET,
    });

    if (!completedOrder || completedOrder.status === 'EXPIRED') {
        log.err(`Fail to ${quantity >= 0 ? `🪙 ${chalk.yellowBright('BUY')}` : `💵 ${chalk.greenBright('SELL')}`} ${chalk.yellow(Math.abs(quantity))} ${chalk.whiteBright(symbol)}`);
        return false;
    }

    state.assets[symbol].showTradeStartTime = new Date();

    if (quantity > 0 && state.assets[symbol].staking) {
        await subscribeFlexibleProductAllFree(symbol);
    }

    await pullNewTransactions(symbol);
    await refreshMaterializedViews();
    clearStakingCache(symbol);

    state.wallet.markOutOfDate(symbol);

    setTimeout(() => {
        clearStakingCache(symbol);
        state.assets[symbol].orderInProgress = false;
        log(`Order completed: ${quantity >= 0 ? `🪙 ${chalk.yellowBright('BUY')}` : `💵 ${chalk.greenBright('SELL')}`} ${chalk.yellow(Math.abs(quantity))} ${chalk.whiteBright(symbol)}`);
    }, 250);

    return true;
}
