import cache from 'memory-cache';
import dotenv from 'dotenv';
import state from './state';
import { log, printSymbol, printTrades, printTransactions } from './ui';
import { pullNewTransactions, readTransactionLog, refreshMaterializedViews, updateTransactionsForAllSymbols } from './transactions';
import Symbol from './symbol';
import tick from './tick';
import readline from 'readline';
import 'source-map-support/register';
import registerInputHandlers from './input';
import Settings from './settings';

import { clearStakingCache, getStakingAccount } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';
import { bgLerp, circleIndicator, lerp, lerpChalk, lerpColor, limitIndicator, progressBar, verticalBar } from './utils';
import chalk from 'chalk';

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

binance.init().then(async () => {

    await getStakingAccount();

    const accountInfo = await binance.accountInfo();

    const allSymbols: string[] = [...new Set(accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .concat((await getStakingAccount()).rows.map(r => r.asset))
        .filter(a => a !== Settings.stableCoin)
        .filter(s => !s.startsWith('LD') || s === 'LDO'))
    ].sort();

    binance.ws.user(async msg => {
        if (msg.eventType === 'outboundAccountPosition') {
            for (const balance of msg.balances!) {
                await pullNewTransactions(`${balance.asset}${Settings.stableCoin}`);
                await refreshMaterializedViews();
                clearStakingCache(balance.asset);
                printTransactions(state.selectedRow >= 0 ? Object.keys(state.currencies).sort()[state.selectedRow] : undefined);

                printSymbol(balance.asset);
            }
        }
    });

    registerInputHandlers();

    updateTransactionsForAllSymbols(accountInfo).then(() => {
        cache.keys().filter(k => k.startsWith(`readProfits-`)).forEach(cache.del);
        printTransactions(state.selectedRow >= 0 ? Object.keys(state.currencies).sort()[state.selectedRow] : undefined);
    });

    // process.stdout.write('\u001B[?1000h');
    // ESC[?100Xh
    process.stdout.write('\u001B[?25l');


    binance.ws.ticker(allSymbols.map(k => `${k}${Settings.stableCoin}`), async priceInfo => {
        drawIndicators();
        const symbol: string = priceInfo.symbol.replace(Settings.stableCoin, '');
        if (symbol === Settings.stableCoin) return;

        if (!(symbol in state.assets)) {
            state.assets[symbol] = new Symbol(symbol, priceInfo);
            updateStepSize(symbol).catch(e => log.err(`Failed to update step size for ${symbol}`));
        } else {
            state.assets[symbol].update(priceInfo);
        }

        if (symbol === 'BNSOL') {
            return;
        }

        if (!(symbol in state.currencies)) {
            state.currencies[symbol] = (await state.wallet.total(symbol)) * state.assets[symbol].price;
            printTrades();
        }

        if (symbol in state.currencies) {
            tick(priceInfo);
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

var __drawIndicators_lastCall = 0;
async function drawIndicators() {
    const now = Date.now();
    if (now - __drawIndicators_lastCall < 16) {
        return;
    }
    __drawIndicators_lastCall = now;

    const str = chalk.bgRgb(32, 32, 32)(circleIndicator({
        current: binance.simpleEarn.__flexibleRateLimiter.getTokensRemaining(), max: 1
    }) + ' ' + [
        binance.limits.count.concat(binance.limits.order).map(l => {
            const f = l.current / l.max;
            return lerpChalk([125, 32, 32], [32, 125, 32], f)(bgLerp([150, 0, 0], [0, 150, 0], f)(verticalBar(l)));
        }).join(' '),
        binance.limits.weight.map(l => {
            const f = l.current / l.max;
            return progressBar(l, 4, lerpColor([155, 0, 0], [0, 155, 0], f), lerpColor([50, 0, 0], [0, 50, 0], f));
        }).join(' ')
    ].join(' '));

    readline.cursorTo(process.stdout, process.stdout.columns!-12, process.stdout.rows! - 1);
    process.stdout.write(str);
}
