import Binance from 'binance-api-node';
import cache from 'memory-cache';
import dotenv from 'dotenv';
import state from './state';
import { addLogMessage, printSymbol, printTrades } from './ui';
import { pullNewTransactions, readTransactionLog, updateTransactionsForAllSymbols } from './transactions';
import Symbol from './symbol';
import tick from './tick';
import readline from 'readline';
import 'source-map-support/register';
import registerInputHandlers from './input';
import Settings from './settings';
import { RateLimiter } from 'limiter';
import { getStakedAssets, getStakingAccount } from './autostaking';

dotenv.config();

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

process.stdout.write('\u001B[?25l');

const __stepSizeRateLimiter = new RateLimiter({ tokensPerInterval: 1, interval: 100 });
async function updateStepSize(symbol: string): Promise<void> {
    await __stepSizeRateLimiter.removeTokens(1);
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
        if (symbol in state.assets) {
            state.assets[symbol].stepSize = stepSize;
            state.assets[symbol].minQty = minQty;
        }

        const minNotionalFilter: any = s.filters.find((f: { filterType: string; }) => f.filterType === 'NOTIONAL');
        if (minNotionalFilter) {
            const minNotional: number = parseFloat(minNotionalFilter.minNotional);
            if (symbol in state.assets) {
                state.assets[symbol].minNotional = minNotional;
            }
        }
    }
}

binance.accountInfo().then(async accountInfo => {

    const allSymbols: string[] = [...new Set(accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .concat((await getStakingAccount())!.rows.map(r => r.asset))
        .filter(a => a !== Settings.stableCoin)
        .filter(s => !s.startsWith('LD') || s === 'LDO'))
    ];//.filter(s => !s.startsWith('LD') || s === 'LDO');

    for (const balance of accountInfo.balances) {
        const value: number = parseFloat(balance.free) + parseFloat(balance.locked);
        if (value > 0) {
            state.balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            if (balance.asset in state.currencies && balance.asset in state.assets) {
                printSymbol(balance.asset);
            }
        }
    }

    binance.ws.user(async msg => {
        if (msg.eventType === 'outboundAccountPosition') {
            for (const balance of msg.balances) {
                state.balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
                pullNewTransactions(balance.asset).then(() => {
                    readTransactionLog(undefined, (process.stdout.rows || 120) - Object.keys(state.currencies).length - 1).then(trades => {
                        for (const trade of trades.reverse()) {
                            addLogMessage(trade.toString());
                        }
                    });
                })
                .catch(e => addLogMessage(`Failed to pull new transactions for ${balance.asset}`));
                cache.del(`staked-${balance.asset}`);
                cache.del(`staking-account-${balance.asset}`);
                cache.del(`staking-account-all`);
            }
        }
    });

    registerInputHandlers();

    updateTransactionsForAllSymbols(accountInfo).then(() => {
        readTransactionLog(undefined, (process.stdout.rows || 120) - Object.keys(state.currencies).length - 1).then(trades => {
            for (const trade of trades.reverse()) {
                addLogMessage(trade.toString());
            }
        });
    });

    binance.ws.ticker([...allSymbols.sort()].map(k => `${k}${Settings.stableCoin}`), async priceInfo => {
        const symbol: string = priceInfo.symbol.replace(Settings.stableCoin, '');
        if (symbol === Settings.stableCoin) return;

        if (!(symbol in state.assets)) {
            state.assets[symbol] = new Symbol(symbol, priceInfo);
            updateStepSize(symbol).catch(e => addLogMessage(`Failed to update step size for ${symbol}`));
        } else {
            state.assets[symbol].update(priceInfo);
        }

        if (symbol === 'BNSOL') {
            return;
        }

        if (!(symbol in state.currencies)) {
            state.currencies[symbol] = state.balances[symbol] * state.assets[symbol].price;
            printTrades();
        }

        if (symbol in state.currencies) {
            await tick(priceInfo);
        }
    });
});

process.on('exit', () => {
    readline.cursorTo(process.stdout, 0, process.stdout.rows! - 1);
    readline.clearScreenDown(process.stdout);
    // process.stdout.write('\u001B[?25h');
    console.log('Exiting...');
    process.exit();
});
