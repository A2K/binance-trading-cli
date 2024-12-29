import Binance, { MyTrade } from 'binance-api-node';
import dotenv from 'dotenv';
import postgres from 'postgres';
import Trade from './trade';
import { addLogMessage } from './ui';
import Settings from './settings';
dotenv.config();

const sql = postgres({
    hostname: process.env.TIMESCALEDB_HOST || 'localhost',
    username: 'postgres',
    password: process.env.TIMESCALEDB_PASSWORD,
    database: 'transactions'
});

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

export async function updateSymbolTransactions(symbol: string) {
    const startTime = 0;
    var trades;
    try {
        trades = await binance.myTrades({
            symbol, startTime
        });
    } catch (e) {
        return;
    }

    while (trades.length) {
        await Promise.all(trades.map(async trade => await sql`INSERT INTO transactions
        (time, id, symbol, "orderId", "orderListId", price, qty, "quoteQty", commission, "commissionAsset", "isBuyer", "isMaker", "isBestMatch")
        VALUES (${new Date(trade.time)}, ${trade.id}, ${trade.symbol}, ${trade.orderId}, ${trade.orderListId}, ${trade.price}, ${trade.qty}, ${trade.quoteQty}, ${trade.commission}, ${trade.commissionAsset}, ${trade.isBuyer}, ${trade.isMaker}, ${trade.isBestMatch})
        ON CONFLICT DO NOTHING
        `));

        const fromId = trades[trades.length - 1].id;
        trades = await binance.myTrades({ symbol, fromId });
        if (trades.length === 1 && trades[0].id === fromId) {
            break;
        }
    }

}

export async function updateTransactions(symbols: string[]): Promise<void> {
    await sql`DELETE FROM transactions WHERE symbol = ANY(${symbols})`;
    await Promise.all(symbols.map(updateSymbolTransactions));
}

export async function pullNewTransactions(symbol: string): Promise<void> {
    const lastTransaction = await readTransactionLog(symbol, 1);
    if (lastTransaction.length === 0) {
        try {
            await updateSymbolTransactions(symbol);
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const fromId = lastTransaction[0].id;
    var trades: MyTrade[] = [];
    try {
        trades = await binance.myTrades({ symbol, fromId });
    } catch (e) {
        console.error(e);
        return;
    }
    if (trades.length === 1 && trades[0].id === fromId) {
        return;
    }

    await Promise.all(trades.map(async trade => await sql`INSERT INTO transactions
        (time, id, symbol, "orderId", "orderListId", price, qty, "quoteQty", commission, "commissionAsset", "isBuyer", "isMaker", "isBestMatch")
        VALUES (${new Date(trade.time)}, ${trade.id}, ${trade.symbol}, ${trade.orderId}, ${trade.orderListId}, ${trade.price}, ${trade.qty}, ${trade.quoteQty}, ${trade.commission}, ${trade.commissionAsset}, ${trade.isBuyer}, ${trade.isMaker}, ${trade.isBestMatch})
        ON CONFLICT DO NOTHING
        `));
}

export async function readProfits(symbol: string | undefined = undefined, interval: string = '1 day'): Promise<number> {
    if (symbol) {
        return (await sql`
            SELECT total
            FROM PNL
            WHERE
                symbol = ${symbol}
                AND bucket = time_bucket(${interval}, now())
        `)[0]?.total || 0;
    }
    return (await sql`
        SELECT SUM(total) as total
        FROM PNL
        WHERE
            bucket = time_bucket(${interval}, now())
    `)[0]?.total || 0;
}

export async function readTransactionLog(symbol?: string, maxItems: number = 100): Promise<Trade[]> {
    const data = symbol
        ? await sql`SELECT * FROM transactions WHERE symbol = ${symbol} ORDER BY time DESC limit ${maxItems}`
        : await sql`SELECT * FROM transactions ORDER BY time DESC limit ${maxItems}`;
    return data.map(row => new Trade(row));
}

export async function fetchDatabase() {
    const accountInfo = await binance.accountInfo();
    const allSymbols: string[] = accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .filter(a => a !== 'USDT');

    await updateTransactions(allSymbols.map(s => s + 'USDT'));
}

export async function updateTransactionsForAllSymbols() {
    const accountInfo = await binance.accountInfo();
    const allSymbols: string[] = accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .filter(a => a !== Settings.stableCoin)
        .map(x => `${x}${Settings.stableCoin}`);
    await Promise.all(allSymbols.map(pullNewTransactions));
    // await pullNewTransactions('LINKUSDT');
    // await readTransactionLog(undefined, 10);
}
