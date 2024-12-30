import Binance, { OrderType } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { formatAssetQuantity, marketCeil, timestampStr } from './utils';
import { addLogMessage } from './ui';
import Settings from './settings';
import { redeemFlexibleProduct, subscribeFlexibleProductAllFree } from './autostaking';
dotenv.config();

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

export async function order(asset: string, price: number, quantity: number): Promise<boolean> {
    return await _order(asset, price, quantity);
}
async function _order(asset: string, price: number, quantity: number): Promise<boolean> {

    if (quantity < 0) {
        if ((state.balances[asset] || 0) < Math.abs(quantity)) {
            const amountToUnstake = marketCeil(asset, Math.abs(quantity) - (state.balances[asset] || 0));
            try {
                await redeemFlexibleProduct(asset, amountToUnstake);
            } catch (e) {
                addLogMessage(`🚫 ${timestampStr()} FAILED TO REDEEM ${amountToUnstake} ${asset}`)
                return false;
            }
        }
    } else {
        if (state.balances[Settings.stableCoin] < price * quantity) {
            try {
                await redeemFlexibleProduct(Settings.stableCoin, marketCeil(asset, price * quantity - state.balances[Settings.stableCoin]));
            } catch (e) {
                addLogMessage(`🚫 ${timestampStr()} FAILED TO REDEEM ${price * quantity - state.balances[Settings.stableCoin]} ${Settings.stableCoin}`);
                return false;
            }
        }
    }

    const completedOrder = await binance.order({
        symbol: `${asset}${Settings.stableCoin}`,
        side: quantity >= 0 ? 'BUY' : 'SELL',
        quantity: formatAssetQuantity(asset, Math.abs(quantity)),
        type: OrderType.MARKET,
    });

    if (!completedOrder || completedOrder.status === 'EXPIRED') {
        addLogMessage(`🚫 ${timestampStr()} FAILED TO ${quantity >= 0 ? '🪙 BUY' : '💵 SELL'} ${Math.abs(quantity)} ${asset} at ${price}`);
        return false;
    }

    state.assets[asset].showTradeFrames = 10;

    if (quantity > 0) {
        subscribeFlexibleProductAllFree(asset);
    }

    return true;
}
