import Binance from 'binance-api-node';
import cache from 'memory-cache';
import dotenv from 'dotenv';
import state from './state';
import { addLogMessage, printSymbol, printTrades } from './ui';
import { readTransactionLog, updateTransactionsForAllSymbols } from './transactions';
import Symbol from './symbol';
import tick from './tick';
import readline from 'readline';
import 'source-map-support/register';
import registerInputHandlers from './input';
import Settings from './settings';

dotenv.config();

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

async function getAllTimePNL(symbol: string): Promise<number> {
    const cacheKey: string = `all_time_pnl_${symbol}`;
    const cached: number | null = cache.get(cacheKey);
    if (cached || cached === 0) {
        return cached + state.balances[symbol] * state.symbols[symbol].price;
    }

    const orders: any[] = await binance.allOrders({
        symbol: `${symbol}${Settings.stableCoin}`,
    });

    const total: number = orders.reduce((acc: number, order: any) =>
        acc + (order.side === 'BUY' ? -1 : 1) * parseFloat(order.cummulativeQuoteQty), 0);

    cache.put(cacheKey, total, 1 * 60 * 60 * 1000);

    const result: number = total + state.balances[symbol] * state.symbols[symbol].price;

    return result;
}

process.stdout.write('\u001B[?25l');

async function updateStepSize(symbol: string): Promise<void> {
    const info1: any = await binance.exchangeInfo({ symbol: `${symbol}${Settings.stableCoin}` });
    for (const s of info1.symbols) {
        if (!s.symbol.endsWith(Settings.stableCoin)) {
            continue;
        }
        const symbol: string = s.symbol.replace(Settings.stableCoin, '');
        if (!(symbol in state.currencies)) {
            continue;
        }
        const lotSizeFilter: any = s.filters.find((f: { filterType: string; }) => f.filterType === 'LOT_SIZE');
        const stepSize: number = parseFloat(lotSizeFilter.stepSize);
        const minQty: number = parseFloat(lotSizeFilter.minQty);
        if (symbol in state.symbols) {
            state.symbols[symbol].stepSize = stepSize;
            state.symbols[symbol].minQty = minQty;
        }

        const minNotionalFilter: any = s.filters.find((f: { filterType: string; }) => f.filterType === 'NOTIONAL');
        if (minNotionalFilter) {
            const minNotional: number = parseFloat(minNotionalFilter.minNotional);
            if (symbol in state.symbols) {
                state.symbols[symbol].minNotional = minNotional;
            }
        }
    }
}

binance.accountInfo().then(async info => {

    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    const allSymbols: string[] = info.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .filter(a => a !== 'USDT');

    for (const balance of info.balances) {
        const value: number = parseFloat(balance.free) + parseFloat(balance.locked);
        if (value > 0) {
            state.balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            if (balance.asset in state.currencies && balance.asset in state.symbols) {
                printSymbol(balance.asset);
            }
        }
    }

    binance.ws.user(async msg => {
        if (msg.eventType === 'outboundAccountPosition') {
            for (const balance of msg.balances) {
                state.balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            }
        }
    });

    readTransactionLog(undefined, (process.stdout.rows || 120) - Object.keys(state.currencies).length - 1).then(trades => {
        for (const trade of trades) {
            addLogMessage(trade.toString());
        }
    });

    registerInputHandlers();

    updateTransactionsForAllSymbols();

    binance.ws.ticker([...allSymbols.sort()].map(k => `${k}${Settings.stableCoin}`), async priceInfo => {
        const symbol: string = priceInfo.symbol.replace(Settings.stableCoin, '');
        if (symbol === Settings.stableCoin) return;

        if (!(symbol in state.symbols)) {
            state.symbols[symbol] = new Symbol(symbol, priceInfo);
            updateStepSize(symbol).catch(e => addLogMessage(`Failed to update step size for ${symbol}`));
        } else {
            state.symbols[symbol].update(priceInfo);
        }

        if (!(symbol in state.currencies)) {
            state.currencies[symbol] = state.balances[symbol] * state.symbols[symbol].price;
            printTrades();
        }

        if (symbol in state.currencies) {
            await tick(priceInfo.eventTime, symbol);
        }
    });
});

process.on('exit', () => {
    readline.cursorTo(process.stdout, 0, process.stdout.rows! - 1);
    readline.clearScreenDown(process.stdout);
    process.stdout.write('\u001B[?25h');
    console.log('Exiting...');
    process.exit();
});
