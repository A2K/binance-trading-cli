import Binance, { OrderType } from 'binance-api-node';
import dotenv from 'dotenv';
import state from './state';
import { timestampStr } from './utils';
import { addLogMessage } from './ui';
import Settings from './settings';
dotenv.config();

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

export async function order(symbol: string, price: number, quantity: number): Promise<boolean> {
    const completedOrder = await binance.order({
        symbol: `${symbol}${Settings.stableCoin}`,
        side: quantity >= 0 ? 'BUY' : 'SELL',
        quantity: Math.abs(quantity).toFixed(Math.max(0, Math.log10(1.0 / state.symbols[symbol].stepSize))),
        type: OrderType.MARKET,
    });


    if (!completedOrder || completedOrder.status === 'EXPIRED') {
        addLogMessage(`🚫 ${timestampStr()} FAILED TO ${quantity >= 0 ? '🪙 BUY' : '💵 SELL'} ${Math.abs(quantity)} ${symbol} at ${price}`);
        return false;
    }

    state.symbols[symbol].showTradeFrames = 10;

    return true;
}
