import cache from 'memory-cache';
import dotenv from 'dotenv';
import state from './state';
import { formatDeltaQuantity, log, parseAsset, printSymbol, printTrades, printTransactions, splitSymbol } from './ui';
import { refreshMaterializedViews, sql, updateTransactionsForAllSymbols } from './transactions';
import Symbol from './symbol';
import tick from './tick';
import readline from 'readline';
import 'source-map-support/register';
import Settings from './settings';

import { clearProfitsCache, getStakingAccount } from './autostaking';

dotenv.config();
import binance from './binance-ext/throttled-binance-api';
import { bgLerp, circleIndicator, formatAssetPrice, lerpChalk, lerpColor, progressBar, verticalBar } from './utils';
import chalk from 'chalk';
import { ExchangeInfo, SymbolFilter, OrderType_LT, ExecutionReport } from 'binance-api-node';
import { OptimizedOrder } from './optimized-order';
import registerInputHandlers from './input';

async function updateStepSize(symbol: string): Promise<void> {
    const info1: ExchangeInfo = await binance.exchangeInfo({ symbol: `${symbol}${Settings.stableCoin}` });
    for (const s of info1.symbols) {
        if (!s.symbol.endsWith(Settings.stableCoin)) {
            continue;
        }
        const symbol: string = s.symbol.replace(Settings.stableCoin, '');
        if (!(symbol in state.currencies)) {
            continue;
        }

        const lotSizeFilter: any = s.filters.find((f: SymbolFilter) => f.filterType === 'LOT_SIZE');
        const priceFilter:any = s.filters.find((f: SymbolFilter) => f.filterType === 'PRICE_FILTER');
        const stepSize: number = parseFloat(lotSizeFilter.stepSize);
        const tickSize: number = parseFloat(priceFilter.tickSize);
        const minQty: number = parseFloat(lotSizeFilter.minQty);
        if (symbol in state.assets) {
            state.assets[symbol].stepSize = stepSize;
            state.assets[symbol].tickSize = tickSize;
            state.assets[symbol].minQty = minQty;
        }

        const minNotionalFilter: any = s.filters.find((f: SymbolFilter) => f.filterType === 'MIN_NOTIONAL');
        if (minNotionalFilter) {
            const minNotional: number = parseFloat(minNotionalFilter.minNotional);
            if (symbol in state.assets) {
                state.assets[symbol].minNotional = minNotional;
            }
        }
    }
}

function parseOrderPrice(msg: ExecutionReport): string {
    if (parseFloat(msg.price) !== 0) {
        return msg.price;
    } else if (parseFloat(msg.stopPrice) !== 0) {
        return msg.stopPrice;
    } else if (parseFloat(msg.priceLastTrade) !== 0) {
        return msg.priceLastTrade;
    }
    return formatAssetPrice(msg.symbol.replace(/USD[TC]$/, ''),
        parseFloat(msg.totalQuoteTradeQuantity) / parseFloat(msg.quantity));
}

binance.init().then(async () => {

    await getStakingAccount();

    const accountInfo = await binance.accountInfo();

    const allSymbols: string[] = [...new Set([...accountInfo.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .concat((await getStakingAccount()).rows.map(r => r.asset))
        .filter(a => a !== Settings.stableCoin)
        .filter(s => !s.startsWith('LD') || s === 'LDO'), 'BNSOL'])
    ].sort();

    binance.ws.user(async msg => {
        switch (msg.eventType) {
            case 'outboundAccountPosition':
                for (const balance of msg.balances!) {
                    clearProfitsCache(balance.asset);
                    state.wallet.markOutOfDate(balance.asset);
                    printTransactions(state.selectedRow >= 0 ? Object.keys(state.currencies).sort()[state.selectedRow] : undefined);
                    printSymbol(balance.asset);
                }
                break;
            case 'executionReport':
                const asset = msg.symbol.replace(/USD[CT]$/, '');
                const currency = msg.symbol.replace(/.*(USD[TC])$/, "$1");
                if (!(asset in state.assets)) {
                    break;
                }
                switch (msg.orderStatus) {
                    case 'FILLED':
                        log(`✅ ORDER ${chalk.yellowBright(msg.orderId)} ${formatDeltaQuantity(splitSymbol(msg.symbol)[0], msg.quantity)} ${chalk.whiteBright(msg.symbol)} at ${chalk.yellow(formatAssetPrice(splitSymbol(msg.symbol)[0], parseFloat(parseOrderPrice(msg))))}`);
                        if (state.assets[asset].currentOrder) {
                            if (await state.assets[asset].currentOrder?.complete(msg)) {
                                delete state.assets[asset].currentOrder;
                            }
                        }

                        await sql`
                        INSERT INTO transactions
                            (time, id, symbol, currency, "orderId", "orderListId", price, qty, "quoteQty",
                            commission, "commissionAsset", "isBuyer", "isMaker", "isBestMatch")
                        VALUES (${new Date(msg.orderTime)}, ${msg.tradeId},
                            ${asset}, ${currency},
                            ${msg.orderId}, ${msg.orderListId}, ${parseFloat(parseOrderPrice(msg))}, ${msg.quantity},
                            ${msg.totalQuoteTradeQuantity}, ${msg.commission}, ${msg.commissionAsset},
                            ${msg.side === 'BUY'}, ${msg.isBuyerMaker}, FALSE)
                        ON CONFLICT DO NOTHING`;
                        await refreshMaterializedViews();
                        state.wallet.markOutOfDate(asset);
                        state.wallet.markOutOfDate(currency);
                        clearProfitsCache(asset);
                        printSymbol(asset);
                        break;
                    case 'REJECTED':
                    case 'EXPIRED':
                        log(`❌ ORDER ${chalk.yellow(chalk.yellow(msg.orderId))} ${chalk.red(msg.orderStatus)}`);
                    case 'CANCELED':
                    case 'PENDING_CANCEL':
                        if (await state.assets[asset].currentOrder?.complete(msg)) {
                            delete state.assets[asset].currentOrder;
                            clearProfitsCache(asset);
                            printSymbol(asset);
                            state.wallet.markOutOfDate(asset);
                        }
                        break;
                    case 'NEW':
                    case 'PARTIALLY_FILLED':
                        if (msg.orderStatus === 'PARTIALLY_FILLED') {
                            log('📥 ORDER', chalk.yellow(msg.orderId), 'FILLED', Math.round(parseFloat(msg.totalTradeQuantity) / parseFloat(msg.quantity) * 100) + '%');
                        }
                        const order = state.assets[asset].currentOrder?.order;
                        if (order && order.orderId === msg.orderId) {
                            order.orderListId = msg.orderListId || order.orderListId;
                            order.price = msg.price || order.price;
                            order.stopPrice = msg.stopPrice || order.stopPrice;
                            order.side = msg.side || order.side;
                            order.symbol = msg.symbol || order.symbol;
                            order.timeInForce = msg.timeInForce || order.timeInForce;
                            order.clientOrderId = msg.newClientOrderId || order.clientOrderId;
                            order.cummulativeQuoteQty = msg.totalQuoteTradeQuantity || order.cummulativeQuoteQty;
                            order.executedQty = msg.quantity || order.executedQty;
                            order.isWorking = msg.isOrderWorking || order.isWorking;
                            order.origQty = msg.quantity || order.origQty;
                            order.status = msg.orderStatus || order.status;
                            order.time = msg.orderTime || order.time;
                            order.type = (msg.orderType as string) as OrderType_LT || order.type;
                            order.updateTime = msg.eventTime || order.updateTime;
                        } else {
                            log('🆕 ORDER', chalk.yellow(msg.orderId),
                                formatDeltaQuantity(parseAsset(msg.symbol), parseFloat(msg.quantity) * (msg.side === 'BUY' ? 1 : -1)),
                                chalk.whiteBright(msg.symbol), 'at', chalk.yellow(parseOrderPrice(msg)));
                            const newOrder = new OptimizedOrder(asset);
                            newOrder.order = {
                                orderId: msg.orderId,
                                orderListId: msg.orderListId,
                                price: msg.price,
                                stopPrice: msg.stopPrice,
                                side: msg.side,
                                symbol: msg.symbol,
                                timeInForce: msg.timeInForce,
                                clientOrderId: msg.newClientOrderId,
                                cummulativeQuoteQty: msg.totalQuoteTradeQuantity,
                                executedQty: msg.quantity,
                                isWorking: msg.isOrderWorking,
                                origQty: msg.quantity,
                                status: msg.orderStatus,
                                time: msg.orderTime,
                                type: (msg.orderType as string) as OrderType_LT,
                                updateTime: msg.eventTime
                            };

                            newOrder.quantity = parseFloat(msg.quantity);
                            newOrder.price = parseFloat(parseOrderPrice(msg));

                            if (state.assets[asset].currentOrder) {
                                state.assets[asset].currentOrder?.cancel();
                            }
                            state.assets[asset].currentOrder = newOrder;
                        }
                }
                break;
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
            try {
                await updateStepSize(symbol);
            } catch (e) {
                log.err(`Failed to update step size for ${symbol}`);
            }
        } else {
            state.assets[symbol].update(priceInfo);
        }

        if ([ 'BNSOL', 'WBETH' ].includes(symbol)) {
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
