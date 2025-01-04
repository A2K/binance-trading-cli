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


async function main() {

    withdraw('0x17C9DDdB264474d7d627867b9f13382e824087A2', 10, 'USDT', 'BSC');
}
main();