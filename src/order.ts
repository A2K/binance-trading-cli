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
        if ((state.balances[symbol] || 0) < Math.abs(quantity)) {
            const amountToUnstake = marketCeil(symbol, Math.abs(quantity) - (state.balances[symbol] || 0));
            try {
                await redeemFlexibleProduct(symbol, amountToUnstake);
            } catch (e) {
                addLogMessage(`🚫 ${timestampStr()} FAILED TO REDEEM ${amountToUnstake} ${symbol}`)
            }
        }
    } else {
        if (state.balances[Settings.stableCoin] < quantity) {
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeil(symbol, quantity - state.balances[Settings.stableCoin]));
            } catch (e) {
                addLogMessage(`🚫 ${timestampStr()} FAILED TO REDEEM ${quantity - state.balances[Settings.stableCoin]} ${Settings.stableCoin}`);
            }
        }
    }

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

    state.assets[symbol].showTradeFrames = 10;

    if (quantity > 0 && state.assets[symbol].staking) {
        await subscribeFlexibleProductAllFree(symbol);
    }

    return true;
}
