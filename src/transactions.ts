import { Account, MyTrade } from 'binance-api-node';
import dotenv from 'dotenv';
import postgres, { PostgresError } from 'postgres';
import Trade from './trade';
import Settings from './settings';
import { addLogMessage } from './ui';
import { clearStakingCache, getStakingAccount } from './autostaking';
import cache from 'memory-cache';

dotenv.config();

const sql = postgres({
    hostname: process.env.TIMESCALEDB_HOST || 'localhost',
    username: 'postgres',
    password: process.env.TIMESCALEDB_PASSWORD,
    database: 'transactions'
});

sql`SET client_min_messages TO WARNING;`

import binance from './binance-ext/throttled-binance-api';

async function getTrades(symbol: string, fromId: number = 0): Promise<MyTrade[]> {
    return binance.myTrades({ symbol, fromId, limit: 1000 });
}

export async function updateSymbolTransactions(symbol: string): Promise<void> {
    var trades;
    try {
        trades = await getTrades(symbol, 0);
    } catch (e) {
        return;
    }

    while (trades.length) {
        await Promise.all(trades.map(async trade => await sql`
            INSERT INTO transactions (
                    time, id,
                    symbol, currency,
                    "orderId", "orderListId",
                    price, qty, "quoteQty",
                    commission, "commissionAsset",
                    "isBuyer", "isMaker", "isBestMatch"
            ) VALUES (
                ${new Date(trade.time)}, ${trade.id},
                ${trade.symbol.replace(/USD[TC]$/, '')}, ${trade.symbol.replace(/.*(USD[TC])$/, "$1")},
                ${trade.orderId}, ${trade.orderListId},
                ${trade.price}, ${trade.qty}, ${trade.quoteQty},
                ${trade.commission}, ${trade.commissionAsset},
                ${trade.isBuyer}, ${trade.isMaker}, ${trade.isBestMatch}
            ) ON CONFLICT DO NOTHING
        `));

        const fromId: number = trades[trades.length - 1].id;
        trades = await getTrades(symbol, fromId);
        if (trades.length === 0 || (trades.length === 1 && trades[0].id === fromId)) {
            break;
        }
    }
}

export async function updateTransactions(symbols: string[]): Promise<void> {
    await sql`DELETE FROM transactions WHERE symbol = ANY(${symbols})`;
    await Promise.all(symbols.map(updateSymbolTransactions));
    refreshMaterializedViews();
}

export async function pullNewTransactions(pair: string): Promise<void> {
    let lastTransaction: Trade[] = [];
    try {
        const sqlData = await sql`SELECT * FROM transactions
        WHERE
            symbol = ${pair.replace(/USD[TC]$/, '')} AND
            currency = ${pair.replace(/.*(USD[TC])$/, "$1")}
        ORDER BY time DESC
        LIMIT 1`;
        lastTransaction = sqlData.map(r => new Trade(r));
    } catch (e) { }

    if (lastTransaction.length === 0) {
        return updateSymbolTransactions(pair);
    }

    const fromId = lastTransaction[0].id;
    var trades: MyTrade[] = [];
    try {
        trades = await getTrades(pair, fromId);
    } catch (e) {
        console.error(e);
        return;
    }

    if (trades.length === 1 && trades[0].id === fromId) {
        return;
    }

    await Promise.all(trades.map(async trade => await sql`
        INSERT INTO transactions
            (time, id, symbol, currency, "orderId", "orderListId", price, qty, "quoteQty",
            commission, "commissionAsset", "isBuyer", "isMaker", "isBestMatch")
        VALUES (${new Date(trade.time)}, ${trade.id}, ${trade.symbol.replace(/USD[TC]$/, '')}, ${trade.symbol.replace(/.*(USD[TC])$/, "$1")},
            ${trade.orderId}, ${trade.orderListId}, ${trade.price}, ${trade.qty},
            ${trade.quoteQty}, ${trade.commission}, ${trade.commissionAsset},
            ${trade.isBuyer}, ${trade.isMaker}, ${trade.isBestMatch})
        ON CONFLICT DO NOTHING
    `));
}

export async function readProfits(symbol: string | undefined = undefined, interval: string = '1 day'): Promise<number> {
    const cacheKey = `readProfits-${symbol}-${interval}`;
    const cachedValue = cache.get(cacheKey);
    if (cachedValue) {
        return cachedValue;
    }

    const view = interval === '1 day'
        ? 'PNL_Day' : interval === '1 week'
            ? 'PNL_Week' : interval === '1 month'
                ? 'PNL_Month' : 'PNL_AllTime';

    if (symbol) {
        symbol = symbol.replace(/USD[TC]$/, '');

        return cache.put(cacheKey, (await (view === 'PNL_AllTime' ? sql`
            SELECT SUM(total) as total
            FROM ${sql(view.toLowerCase())}
            WHERE symbol = ${symbol}
        ` : sql`
            SELECT SUM(total) as total
            FROM ${sql(view.toLowerCase())}
            WHERE
                bucket = time_bucket(${interval}, now())
            AND
                symbol = ${symbol}
        `))[0]?.total || 0);
    }

    return cache.put(cacheKey, (await (view === 'PNL_AllTime' ? sql`
        SELECT
            SUM(total) as total
        FROM
            PNL_AllTime
        ` : sql`
        SELECT
            SUM(total) as total
        FROM
            ${sql(view.toLowerCase())}
        WHERE
            bucket = time_bucket(${interval}, now())
            AND NOT (symbol = 'USDT' OR symbol = 'USDC')
    `))[0]?.total || 0);
}

export async function readTransactionLog(symbol?: string, maxItems: number = 100): Promise<Trade[]> {
    try {
        const data = symbol
            ? await sql`SELECT * FROM transactions WHERE symbol = ${symbol} ORDER BY time DESC limit ${maxItems}`
            : await sql`SELECT * FROM transactions ORDER BY time DESC limit ${maxItems}`;
        return data.map(row => new Trade(row));
    } catch (e: any) {
        addLogMessage('readTransactionLogFailed:', e.toString());
    }
    return [];
}

export async function fetchDatabase() {
    const accountInfo = await binance.accountInfo();
    const allSymbols: string[] = accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .filter(a => a !== 'USDT');

    await updateTransactions(allSymbols.map(s => s + 'USDT'));
}

export async function updateTransactionsForAllSymbols(accountInfo: Account | null = null) {
    if (accountInfo === null) {
        accountInfo = await binance.accountInfo();
    }

    const allSymbols: string[] = [...new Set(accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .concat((await getStakingAccount()).rows.map(r => r.asset))
        .filter(a => a !== Settings.stableCoin)
        .filter(s => !s.startsWith('LD') || s === 'LDO'))
    ].sort();

    const allPairs =
        allSymbols.map(x => `${x}USDT`)
            .concat(allSymbols.map(x => `${x}USDC`));

    await Promise.all(allPairs.map(pullNewTransactions));

    await refreshMaterializedViews();
}

export async function refreshMaterializedViews() {
    await Promise.all([
        sql`CALL refresh_continuous_aggregate('PNL_Day', NULL, NULL);`,
        sql`CALL refresh_continuous_aggregate('PNL_Week', NULL, NULL);`,
        sql`CALL refresh_continuous_aggregate('PNL_Month', NULL, NULL);`,
        sql`CALL refresh_continuous_aggregate('PNL_AllTime', NULL, NULL);`
    ])
}
