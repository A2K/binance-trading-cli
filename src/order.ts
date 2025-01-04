import { OrderType } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { formatAssetQuantity, marketCeil, timestampStr } from './utils';
import { addLogMessage } from './ui';
import Settings from './settings';
import { redeemFlexibleProduct, subscribeFlexibleProductAllFree } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';

export async function order(symbol: string, quantity: number): Promise<boolean> {
    if (quantity < 0) {
        if (await state.wallet.free(symbol) < Math.abs(quantity)) {
            const amountToUnstake = marketCeil(symbol, Math.abs(quantity) - parseFloat((await state.wallet.get(symbol)).free));
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(symbol, amountToUnstake);
            } catch (e) {
                addLogMessage(`🚫 ${timestampStr()} FAILED TO REDEEM ${amountToUnstake} ${symbol}`)
            }
        }
    } else {
        if (await state.wallet.free(Settings.stableCoin) < quantity) {
            state.assets[symbol].stakingInProgress = true;
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeil(symbol, quantity - await state.wallet.free(Settings.stableCoin)));
            } catch (e) {
                addLogMessage(`🚫 ${timestampStr()} FAILED TO REDEEM ${quantity - await state.wallet.free(Settings.stableCoin)} ${Settings.stableCoin}`);
            }
        }
    }

    state.assets[symbol].stakingInProgress = false;

    const completedOrder = await binance.order({
        symbol: `${symbol}${Settings.stableCoin}`,
        side: quantity >= 0 ? 'BUY' : 'SELL',
        quantity: formatAssetQuantity(symbol, Math.abs(quantity)),
        type: OrderType.MARKET,
    });

    if (!completedOrder || completedOrder.status === 'EXPIRED') {
        addLogMessage(`🚫 ${timestampStr()} FAILED TO ${quantity >= 0 ? '🪙 BUY' : '💵 SELL'} ${Math.abs(quantity)} ${symbol}`);
        return false;
    }

    state.assets[symbol].showTradeStartTime = new Date();

    if (quantity > 0 && state.assets[symbol].staking) {
        await subscribeFlexibleProductAllFree(symbol);
    }

    state.wallet.markOutOfDate(symbol);
    state.assets[symbol].orderInProgress = false;

    return true;
}
