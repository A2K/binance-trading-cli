import dotenv from 'dotenv';
dotenv.config();
import binance from './throttled-binance-api';
import { WithdrawResponse } from 'binance-api-node';

export async function withdraw(address: string, amount: number, coin = 'USDT', network = 'BSC'): Promise<void> {
    const result = await binance.withdraw({
        coin: coin,
        network: network,
        address: address,
        amount: amount,
        walletType: 0
    });
    console.log(result)
}

