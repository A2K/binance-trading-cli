const Binance = require('binance-api-node').default;
const { Ticker } = require('binance-api-node');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./transactions.db');
const chalk = require('chalk');
const fs = require('fs');
const cache = require('memory-cache');
require('dotenv').config();

const currencies = (() => {
    try {
        // create currencies.json file with your own currencies
        return require('./currencies.json');
    } catch (e) {
        return {
            PEPE: 1000,
            DOGE: 1000,
            XRP: 1000
        }
    }
})();

const Settings = (() => {
    const Defaults = {
        buyThreshold: 35,
        sellThreshold: 25,
        maxDailyLoss: 0,
        interpSpeed: 0.00025,
        enableTradeByDefault: false,
        enableInputLogging: false
    };
    try {
        // create settings.json file with your own settings
        return Object.assign(Defaults, require('./settings.json'));
    } catch (e) {
        return Defaults;
    }
})();

const thresholds = (() => {
    try {
        // create thresholds.json file with your own thresholds
        return require('./thresholds.json');
    } catch (e) {
        return {
            buy: {},
            sell: {}
        };
    }
})();

const SCHEMA = `CREATE TABLE IF NOT EXISTS transactions (
                    time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    symbol TEXT,
                    amount REAL,
                    price REAL,
                    total REAL,
                    fee REAL
                )`;

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET
});

/**
 * @param {string} symbol
 * @param {number} amount
 * @param {number} price
 * @param {number} total
 * @param {number} fee
 * @returns Promise<Trade>
 */
async function save(symbol, amount, price, total, fee, time) {
    balances[symbol] -= amount;
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                db.run(SCHEMA);

                const stmt = db.prepare("INSERT INTO transactions(time, symbol, amount, price, total, fee) VALUES (?, ?, ?, ?, ?, ?)");
                stmt.run(time.toISOString(), symbol, amount, price, total, fee);
                stmt.finalize((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    cache.del(`${symbol.replace(/USDT$/, '')}_${new Date().getUTCDay()}`);
                    cache.del(`total_${new Date().getUTCDay()}`);
                    resolve(new Trade(symbol, amount, price, total, fee, time));
                    setTimeout(() => {
                        cache.del(`${symbol.replace(/USDT$/, '')}_${new Date().getUTCDay()}`);
                        cache.del(`total_${new Date().getUTCDay()}`);
                    }, 100);
                });

            } catch (e) {
                reject(e);
            }
        });
    });
}

async function readProfits(symbol) {
    const cacheKey = `${symbol ? symbol : 'total'}_${new Date().getUTCDay()}`;
    const cached = cache.get(cacheKey);
    if (cached || cached === 0) {
        return cached;
    }

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            if (symbol) {
                db.each(`SELECT SUM(total) as total FROM transactions ` +
                        `WHERE symbol = '${symbol}USDT' ` +
                        `AND time >= DATETIME('now', 'start of day')`, (err, row) => {
                // db.each(`SELECT SUM(total) as total FROM transactions WHERE symbol = '${symbol}USDT'`, (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    const result = parseFloat(row.total || 0);
                    cache.put(cacheKey, result, 24 * 60 * 60 * 1000);
                    resolve(result);
                });
            } else {
                db.each(`SELECT SUM(total) as total FROM transactions ` +
                        `WHERE time >= DATETIME('now', 'start of day')`, (err, row) => {
                    // db.each(`SELECT SUM(total) as total FROM transactions`, (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    const result = parseFloat(row.total || 0);
                    cache.put(cacheKey, result, 24 * 60 * 60 * 1000);
                    resolve(result);
                });
            }
        });
    });
}

async function readTransactionLog(maxItems = process.stdout.rows - Object.keys(currencies).length - 1) {
    const trades = await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.all(`SELECT * FROM transactions ORDER BY time DESC LIMIT ${maxItems}`, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows.map(row => new Trade(row.symbol, row.amount, row.price, row.total, row.fee, new Date(row.time))));
            });
        });
    });
    trades.reverse().forEach(trade => addLogMessage(trade.toString()));
}

const deltas = {};

class Trade {
    /**
     * @constructor
     * @param {string} symbol
     * @param {number} quantity
     * @param {number} price
     * @param {number} total
     * @param {number} commission
     */
    constructor(symbol, quantity, price, total, commission, time = new Date()) {
        this.time = time || new Date();
        this.symbol = symbol;
        this.quantity = quantity;
        this.price = price;
        this.total = total;
        this.commission = commission;
    }

    /**
     * @returns {string}
     */
    toString() {
        const quantity = this.quantity;
        const tradeTotal = this.total;
        return `${quantity >= 0 ? '🪙' : '💵'}` +
        ` ${this.time.toLocaleDateString("uk-UA", {
            year: 'numeric',
            month: 'numeric',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })} ` +
        `${(quantity >= 0 ? chalk.redBright : chalk.greenBright)((quantity > 0 ? '-' : '+') + Math.abs(tradeTotal).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
        `${(quantity < 0 ? chalk.red : chalk.green)((quantity >= 0 ? '+' : '-') + formatFloat(Math.abs(quantity)))} ${chalk.bold(this.symbol.replace(/USDT$/, ''))} at ${chalk.yellow(formatFloat(this.price, 8))} ` +
        `(fee: ${chalk.yellowBright(formatFloat(this.commission, 4))})`
    }
}

const enabledTrades = (() => {
    try {
        return require('./enableTrade.json');
    } catch (e) {
        return {};
    }
})()

class Symbol
{
    constructor(symbol, data)
    {
        Object.assign(this, data);
        this.symbol = symbol;
        this.startPrice = this.price;
    }

    get buyThreshold() {
        return thresholds.buy[this.symbol] ? thresholds.buy[this.symbol] : Settings.buyThreshold
    }

    get sellThreshold() {
        return thresholds.sell[this.symbol] ? thresholds.sell[this.symbol] : Settings.sellThreshold;
    }

    set buyThreshold(value) {
        thresholds.buy[this.symbol] = value;
        fs.writeFileSync('./thresholds.json', JSON.stringify(thresholds, null, 4));
    }

    set sellThreshold(value) {
        thresholds.sell[this.symbol] = value;
        fs.writeFileSync('./thresholds.json', JSON.stringify(thresholds, null, 4));
    }

    get enableTrade() {
        return enabledTrades[this.symbol] ? true : false;
    }

    set enableTrade(value) {
        enabledTrades[this.symbol] = value;
        fs.writeFileSync('./enableTrade.json', JSON.stringify(enabledTrades, null, 4));
    }

    get price() {
        return ((parseFloat(this.bestAsk) || 0) + (parseFloat(this.bestBid) || 0)) / 2;
    }

    get maxDailyLoss() {
        return this.symbol in maxDailyLosses ? maxDailyLosses[this.symbol] : Settings.maxDailyLoss;
    }

    set maxDailyLoss(value) {
        maxDailyLosses[this.symbol] = value;
        fs.writeFileSync('./maxDailyLosses.json', JSON.stringify(maxDailyLosses, null, 4));
    }

    /**
     * @param {Ticker} data
     */
    update(data) {
        Object.assign(this, data);
    }
}

async function trade(symbol, price, quantity, forceTrade = false) {
    if (quantity >= 0)
    {
        const todayProfits = await readProfits(symbol);
        if ((todayProfits - quantity * price) < -symbols[symbol].maxDailyLoss && !forceTrade)
        {
            // addLogMessage(`🚫 REFUSED TO BUY ${Math.abs(quantity)} ${symbol} at ${price} due to daily loss limit: ${chalk.redBright(Math.abs(formatFloat(todayProfits)))} > ${chalk.red(Settings.maxDailyLoss)}`);
            return;
        }
    }

    const doTrade = async () => {
        for(let i = 0; i < 3; i++) {
            const completedOrder = await binance.order({
                symbol: `${symbol}USDT`,
                side: quantity >= 0 ? 'BUY' : 'SELL',
                quantity: Math.abs(quantity).toFixed(8),
                //type: "LIMIT",
                type: "MARKET",
                //price: price,
                //timeInForce: 'IOC'
            });

            if (completedOrder.status === 'EXPIRED') {
                //console.log('🚫 FAILED TO', quantity > 0 ? '🪙 BUY' : '💵 SELL', Math.abs(quantity), symbol,'at', price);
                continue;
            }

            return completedOrder;
        }
    }

    const completedOrder = await doTrade();
    if (!completedOrder || completedOrder.status === 'EXPIRED') {
        addLogMessage(`🚫 FAILED TO ${quantity >= 0 ? '🪙 BUY' : '💵 SELL'} ${Math.abs(quantity)} ${symbol} at ${price}`);
        return;
    }

    symbols[symbol].showTradeFrames = 10;
    const tradeTotal = completedOrder.fills.reduce((acc, fill) => acc + parseFloat(fill.price) * parseFloat(fill.qty), 0);

    const bnbPrice = symbols['BNB'] ? (parseFloat(symbols['BNB'].bestAsk) + parseFloat(symbols['BNB'].bestBid)) / 2 : 650;

    const commission = completedOrder.fills.reduce((acc, fill) => acc + parseFloat(fill.commission) * bnbPrice, 0);

    const tradePrice = Math.abs(completedOrder.fills.reduce((acc, fill) => acc + parseFloat(fill.price) * parseFloat(fill.qty), 0) / quantity);

    const finalSaleValueUsd = -Math.sign(quantity) * tradeTotal - commission;

    // write transaction to database
    addLogMessage(await save(`${symbol}USDT`, quantity, tradePrice, finalSaleValueUsd, commission, new Date(completedOrder.transactTime)));
}

function printTrades() {
    while (logMessages.length > process.stdout.rows - Object.keys(currencies).length - 1) {
        logMessages.shift();
    }

    for (var i = 0; i < logMessages.length; i++) {
        process.stdout.cursorTo(0, Object.keys(currencies).length + (logMessages.length - i));
        process.stdout.clearLine(0);
        process.stdout.write(logMessages[i]);
        process.stdout.clearLine(1);
    }
}

async function printSymbol(symbol) {

    if (!(symbol in symbols)) {
        return;
    }

    const timestamp = new Date().toLocaleDateString("uk-UA", {
        year: 'numeric',
        month: 'numeric',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    const makeVelocitySymbol = (velocity) => {
        velocity = parseFloat(velocity) * 10000;
        if (Math.abs(velocity) < 0.1) {
            return chalk.white(' ⡇');
        }
        // const positive = ['⡀', '⡄', '⡆', '⡇'];
        // const negative = ['⠁', '⠃', '⠇', '⡇'];
        // ⢸⡇⠸⠇⠘⠃⠈⠁
        // ⢸⡇⢰⡆⢠⡄⢀⡀
        //const positive = ['⢀', '⢠', '⢰', '⢸'];
        const positive =   [ '⠈', '⠘', '⠸', '⢸', '⢸'];
        const positiveNeg = [ '⡆', '⡄', '⡀', ' ', ' '];
        // const positive =    [ '⠁', '⠃', '⠇', '⡇', '⡇'];
        //const positiveNeg = [ '⢰', '⢠', '⢀', ' ', ' '];
        // const negative =    [ '⠁', '⠃', '⠇', '⡇', '⡇'];
        const negative =    [ '⡀', '⡄', '⡆', '⡇', '⡇'];
        const negativePos = [ '⠸', '⠘', '⠈', ' ', ' '];
        // const positive = ['↑', '⇈'];
        // const negative = ['↓', '⇊'];

        const index = Math.min(Math.floor(Math.abs(velocity)), positive.length - 2);
        if (velocity < 0)
        {
            return chalk.white(velocity >= 0 ? positiveNeg[index] : negativePos[index])
                + (velocity >= 0.0 ? chalk.green : chalk.red)(velocity >= 0 ? positive[index] : negative[index]);
        }
        return (velocity >= 0.0 ? chalk.green : chalk.red)(velocity >= 0 ? positive[index] : negative[index])
                + chalk.white(velocity >= 0 ? positiveNeg[index] : negativePos[index]);
    }

    const colorizeDeltaUsd = (symbol, delta) => {
        let deltaStr = ((delta < 0 ? '-' : '+') + Math.abs(delta.toFixed(2))).padEnd(10);
        const fraction = Math.abs(deltas[symbol]) / Object.keys(currencies).map(c => deltas[c]).reduce((acc, d) => Math.max(acc, Math.abs(d)), 0);
        const c1 = selectedRow === Object.keys(currencies).sort().indexOf(symbol) ? 150 : 100;
        const c2 = selectedRow === Object.keys(currencies).sort().indexOf(symbol) ? 100 : (delta > 0 ? 50 : 25);
        deltaStr = chalk.bgRgb(delta < 0 ? c1 : 0, delta >= 0 ? c1 : 0,0)(deltaStr.substring(0, Math.round(fraction * deltaStr.length)))
            + chalk.bgRgb(delta < 0 ? c2 : 0, delta >= 0 ? c2 : 0,0)(deltaStr.substring(Math.round(fraction * deltaStr.length)));

        return chalk.white(deltaStr.padEnd(10));
    }

    const colorizeSymbolProfit = async (symbol, delta) => {
        delta = parseFloat(delta);
        const alpha = 'showTradeFrames' in symbols[symbol] ? symbols[symbol].showTradeFrames / 10 : 0;
        if (symbols[symbol].showTradeFrames > 0)
        {
            if (--symbols[symbol].showTradeFrames === 0)
            {
                delete symbols[symbol].showTradeFrames;
            }
        }

        let deltaStr = ((delta < 0 ? '-' : '+') + Math.abs(delta.toFixed(2))).padEnd(10);
        const maxDeltaProfit = (await Promise.all(Object.keys(currencies).map(async c => readProfits(c)))).reduce((acc, profit) => Math.max(acc, Math.abs(profit)), 0);
        const fraction = Math.abs(delta / maxDeltaProfit);
        const colors ={
            active: 100,
            inactive: 25
        };
        const colorLeft = colors.active * (Object.keys(currencies).sort().indexOf(symbol) === selectedRow ? 2 : 1.0);
        const colorRight = colors.inactive * (Object.keys(currencies).sort().indexOf(symbol) === selectedRow ? 2 : 1.0);
        deltaStr = chalk.bgRgb(delta < 0 ? colorLeft : 0, delta >= 0 ? colorLeft : 0,0)(deltaStr.substring(0, Math.round(fraction * deltaStr.length)))
            + chalk.bgRgb(delta < 0 ? colorRight : 0, delta >= 0 ? colorRight : 0,0)(deltaStr.substring(Math.round(fraction * deltaStr.length)));

        const m = Math.round(225 * (1.0 - alpha) + 255 * alpha);
        return chalk.rgb(m, m, m)(deltaStr);
    }

    let deltaPrice = symbols[symbol].deltaPrice || 0;
    const relativeDeltaPrice = deltaPrice / (symbols[symbol].price || 1);

    const symbolProfit = await readProfits(symbol);

    const relativePriceColor = chalk.rgb(relativeDeltaPrice >= 0 ?
        Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, relativeDeltaPrice * 1000)) || 0)) :
        0,
        relativeDeltaPrice >= 0 ? 0 :
        Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, -relativeDeltaPrice * 1000)) || 0)),
        0);

    const isSelected = Object.keys(currencies).sort().indexOf(symbol) === selectedRow;
    const total = Object.keys(currencies).reduce((acc, symbol) => acc + currencies[symbol], 0);
    const max = Object.keys(currencies).reduce((acc, symbol) => Math.max(acc, currencies[symbol] / total), 0);
    const fraction = currencies[symbol] / total / max;

    let str = `${(Math.round(currencies[symbol]) + '').padEnd(10)}`;
    const m = isSelected ? 2 : 1;
    str = chalk.bgRgb(10*m,50*m,120*m)(chalk.rgb(210, 210, 210)(str.substring(0, Math.round(fraction * str.length)))) +
            chalk.bgRgb(0*m,0*m,25*m)(str.substring(Math.round(fraction * str.length)));

    const deltaUsd = deltas[symbol] || 0;
    symbols[symbol].statusLine = `📈 ${timestamp} ${symbol.padEnd(8)} ${makeVelocitySymbol((velocities[symbol] || 0))}` +

        `${relativePriceColor((symbols[symbol].price || 0).toPrecision(6).padEnd(14))}` +

        str +

        ` ${(deltaUsd < 0 ? (-deltaUsd > symbols[symbol].sellThreshold ? chalk.greenBright : chalk.green) :
        (deltaUsd > symbols[symbol].buyThreshold ? chalk.redBright : chalk.red))(colorizeDeltaUsd(symbol, -deltaUsd))} ` +
        await colorizeSymbolProfit(symbol, symbolProfit) +
        ` ${symbols[symbol].enableTrade ? '🟢' : '🔴'} ` +
        `  ${parseFloat(symbols[symbol].buyThreshold).toFixed(0)}  ` +
        ` ${parseFloat(symbols[symbol].sellThreshold).toFixed(0)}`;

    const keys = Object.keys(currencies).sort();
    process.stdout.cursorTo(0, keys.indexOf(symbol));
    if (keys.indexOf(symbol) == selectedRow)
    {
        process.stdout.write(chalk.bgBlackBright(symbols[symbol].statusLine));
    }
    else
    {
        process.stdout.write(symbols[symbol].statusLine);
    }
    process.stdout.clearLine(1);
}

function formatFloat(number, n = 2) {
    return parseFloat(parseFloat(number).toFixed(n));
}

const balances = {};

/**
 * @type {Object<string, Symbol>}
 */
const symbols = {};

const velocities = {};
const lastTickTime = {};

let lastPrice = {}

const lines = {}

const logMessages = [];
const addLogMessage = (msg) => {
    logMessages.push(msg.toString());
    while (logMessages.length > process.stdout.rows - Object.keys(currencies).length - 1) {
        logMessages.shift();
    }
    printTrades();
}

const steps = [1, 5, 10, 25, 50, 100, 500, 1000];
var step = steps.indexOf(100); // adjust with pgup pgdown
var enableTrade = Settings.enableTradeByDefault;
var enableBuy = enableTrade;

let selectedRow = -1;
{
    const stdin = process.stdin;

    // without this, we would only get streams once enter is pressed
    stdin.setRawMode( true );

    // resume stdin in the parent process (node app won't quit all by itself
    // unless an error or process.exit() happens)
    stdin.resume();

    // i don't want binary, do you?
    stdin.setEncoding( 'utf8' );

    // on any data into stdin
    stdin.on( 'data', function( key ){
        // ctrl-c ( end of text )
        if ( key === '\u0003' ) {
            process.exit();
        }

        const lastSelectedRow = selectedRow;

        // write the key to stdout all normal like
        let code = [];
        for (let i = 0; i < key.length; i++)
        {
            code.push(key.charCodeAt(i));
        }
        if (code.length >= 3 && code[0] === 27 && code[1] === 91)
        {
            if (selectedRow >= 0)
            {
                process.stdout.cursorTo(0, selectedRow);
                if (symbols[Object.keys(currencies).sort()[selectedRow]])
                {
                    process.stdout.write(symbols[Object.keys(currencies).sort()[selectedRow]].statusLine + '');
                }
                process.stdout.clearLine(1);
            }

            if (code[2] === 65) // up
            {
                if (selectedRow == -1) {
                    selectedRow = Object.keys(currencies).length - 1;
                } else {
                    selectedRow = Math.max(-1, selectedRow - 1);
                }
            }
            else if (code[2] === 66) // down
            {
                if (selectedRow == Object.keys(currencies).length - 1) {
                    selectedRow = -1;
                } else {
                    selectedRow = Math.min(Object.keys(currencies).length - 1, selectedRow + 1);
                }
            }
            else if (code[2] === 67) // right
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    if ((currencies[symbol] % steps[step]) > 1)
                    {
                        currencies[symbol] += steps[step] - currencies[symbol] % steps[step]
                    }
                    else
                    {
                        currencies[symbol] = Math.round((currencies[symbol] + steps[step]) / steps[step]) * steps[step];
                    }
                    printSymbol(symbol);
                }
                fs.writeFileSync('./currencies.json', JSON.stringify(currencies, null, 4));
            }
            else if (code[2] === 68) // left
            {
                if (selectedRow >= 0) {

                    if ((currencies[Object.keys(currencies).sort()[selectedRow]] % steps[step]) > 1)
                    {
                        currencies[Object.keys(currencies).sort()[selectedRow]] -= currencies[Object.keys(currencies).sort()[selectedRow]] % steps[step]
                    }
                    else {
                        currencies[Object.keys(currencies).sort()[selectedRow]] =
                            Math.round((currencies[Object.keys(currencies).sort()[selectedRow]] - steps[step]) / steps[step]) * steps[step];
                    }
                }
                fs.writeFileSync('./currencies.json', JSON.stringify(currencies, null, 4));
            }
            else if (code[2] === 53) // page up
            {
                step = Math.min(step + 1, steps.length - 1);
            }
            else if (code[2] === 54) // page down
            {
                step = Math.max(step - 1, 0);
            }
            else if (code[2] === 49) // home
            {
                enableTrade = !enableTrade;
            }
            else if (code[2] === 52) // end
            {
                enableBuy = !enableBuy;
            }

        } else if (code.length === 1) {
            if (code[0] === 27) { // esc
                if (selectedRow >= 0) {
                    selectedRow = -1;
                }
            } else if (code[0] === 13) { // enter
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].forceTrade = true;
                }
            } else if (code[0] === 39) { // question mark
                Settings.enableInputLogging = !Settings.enableInputLogging;
            }
            else if (key === 'q') {
                process.exit();
            }
            else if (code[0] === 9) // tab
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].enableTrade = symbols[symbol].enableTrade ? false : true;
                }
            } else if (code[0] === 63) { // question mark
                const help = [
                    `${chalk.bold("USAGE:")}`,
                    `\t${chalk.bold("HOME")}: enable/disable trading`,
                    `\t${chalk.bold("END")}: enable/disable buying`,
                    `\t${chalk.bold("UP") + "/" + chalk.bold("DOWN")} arrows: select currency`,
                    `\t${chalk.bold("LEFT") + "/" + chalk.bold("RIGHT")} arrows: change allocated amount for selected currency`,
                    `\t${chalk.bold("ENTER")}: force trade for selected currency at current price`,
                    `\t${chalk.bold("TAB")}: enable/disable buying for selected currency`,
                    `\t${chalk.bold("Q")}: exit`,
                    `\t${chalk.bold("?")}: display this message`,
                    "",
                    `${chalk.bold("NOTE:")}`,
                    `\tPress ${chalk.bold("HOME")} to enable trading and ${chalk.bold("END")} to enable buying.`,
                    `\tSelect a currency using ${chalk.bold("UP")} and ${chalk.bold("DOWN")} arrows,`,
                    `\tand press ${chalk.bold("TAB")} to enable buying for it.`,
                ];

                help.reverse().forEach((line, i) => addLogMessage(line));
            }
            else if (code[0] === 91) // minus
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].sellThreshold = Math.max(0, symbols[symbol].sellThreshold - (symbols[symbol].sellThreshold > 10 ? 5 : 1));
                    // addLogMessage(`SELL THRESHOLD FOR ${symbol} SET TO ${symbols[symbol].sellThreshold}`);
                    printSymbol(symbol);
                }
            }
            else if (code[0] === 93) // plus
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].sellThreshold = Math.min(currencies[symbol], symbols[symbol].sellThreshold + (symbols[symbol].sellThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            }

            else if (code[0] === 45) // minus
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].buyThreshold = Math.max(0, symbols[symbol].buyThreshold - (symbols[symbol].buyThreshold > 10 ? 5 : 1));

                    // addLogMessage(`BUY THRESHOLD FOR ${symbol} SET TO ${symbols[symbol].buyThreshold}`);
                    printSymbol(symbol);
                }
            }
            else if (code[0] === 61) // plus
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].buyThreshold = Math.min(currencies[symbol], symbols[symbol].buyThreshold + (symbols[symbol].buyThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            }
            else if (code[0] === 8 || code[0] === 127) // backspace
            {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    if (symbol in balances) {
                        currencies[symbol] = balances[symbol] * symbols[symbol].price;
                    }
                    printSymbol(symbol);
                }
            }
        }

        if (selectedRow >= 0) {
            printStats(Object.keys(currencies).sort()[selectedRow]);
        }
        if (lastSelectedRow >= 0 && lastSelectedRow != selectedRow)
        {
            printSymbol(Object.keys(currencies).sort()[lastSelectedRow]);
        }

        if (Settings.enableInputLogging)
        {
            addLogMessage(`INPUT: ${code.join(' ')}`);
            printTrades();
        }
    });
}

const printStats = async (symbol, deltaPrice) =>{
    if (deltaPrice) {
        symbols[symbol].deltaPrice = deltaPrice;
    } else {
        deltaPrice = symbol in symbols ? symbols[symbol].deltaPrice : 0;
    }

    printSymbol(symbol);

    const profits = await readProfits();
    const deltaSum = Object.keys(currencies).reduce((acc, delta) => acc + deltas[delta], 0);
    const deltaSumStr = (deltaSum < 0 ? '+' : '') + formatFloat(-deltaSum);
    const profitsStr = (profits >= 0 ? '+' : '') + formatFloat(profits);
    const deltaSumColor = deltaSum <= 0 ? chalk.green : chalk.red;
    const profitsColor = profits >= 0 ? chalk.green : chalk.red;
    process.stdout.cursorTo(0, Object.keys(currencies).length);

    process.stdout.write(`${enableTrade ? '🟢' : '🔴'}${enableBuy ? '🟢' : '🔴'} ±${('' + steps[step]).padEnd(4)}`);
    process.stdout.write(`${Math.round(balances.USDT)}`.padStart(36));
    process.stdout.write(` ${chalk.yellow('⇄')} `);
    process.stdout.write(`${`${Math.round(Object.values(currencies).reduce((acc, currency) => acc + currency, 0))}`.padEnd(11)}`);

    process.stdout.cursorTo('                                                            '.length, Object.keys(currencies).length);
    process.stdout.write(`${deltaSumColor(deltaSumStr.padEnd(11))}${profitsColor(profitsStr.padEnd(11))}`);
    process.stdout.cursorTo(86, Object.keys(currencies).length);
    process.stdout.write(`${chalk.red('↓')}${chalk.whiteBright('-')}${chalk.green('↑')}${chalk.whiteBright('=')} `);
    process.stdout.write(`${chalk.red('↓')}${chalk.whiteBright('[')}${chalk.green('↑')}${chalk.whiteBright(']')}`);
    process.stdout.clearLine(1);
}

async function tick(time, symbol)
{
    if (!(symbol in symbols))
    {
        return;
    }


    const duration = time - (lastTickTime[symbol] || 0);
    lastTickTime[symbol] = time;

    if (Math.abs(duration) < 100 /*ms*/) {
        // already called this frame
        return;
    }

    const currentPrice = symbols[symbol].price;
    const targetAmount = currencies[symbol];
    const balance = balances[symbol];

    const usd = balance * currentPrice;

    const delta = targetAmount - usd;


    velocities[symbol] = (velocities[symbol] || (currentPrice - lastPrice[symbol]) / currentPrice) * Math.max(0.0, 1.0 - Settings.interpSpeed * duration)
     + (currentPrice - lastPrice[symbol]) / currentPrice * Math.min(1.0, Settings.interpSpeed * duration);

    const deltaPrice = currentPrice - lastPrice[symbol];
    lastPrice[symbol] = currentPrice;

    let quantity = delta / currentPrice;
    quantity = Math.round(quantity / symbols[symbol].stepSize) * symbols[symbol].stepSize;
    const deltaUsd = quantity * currentPrice;
    deltas[symbol] = deltaUsd;

    // addLogMessage(JSON.stringify(symbols[symbol]));
    // quantity = symbols[symbol]
    printStats(symbol, deltaPrice);

    // if (symbol.startsWith('BTC'))
    //     {
    //         addLogMessage(JSON.stringify(symbol) + ' ' + symbols[symbol].price + ' ' + balances[symbol] + ' ' + currencies[symbol] + ' ' + deltaPrice + " usd " + deltaUsd);
    //     }
    if (enableTrade) {
        const velocity = velocities[symbol];
        const forceTrade = symbols[symbol].forceTrade;
        symbols[symbol].forceTrade = false;
        if (forceTrade || ((deltaUsd < 0 ? (velocity < 0.1) : (velocity > -0.1))
            && (((deltaUsd > symbols[symbol].buyThreshold) && enableBuy && symbols[symbol].enableTrade) || deltaUsd < -symbols[symbol].sellThreshold)))
        {
            try {
                if ('BNB' in symbols)
                {
                    if (process.argv.includes('--dry-run'))
                    {
                        addLogMessage(
                            `🚀 ${symbol} delta ${delta} USDT ` +
                            `target ${targetAmount} USDT ` +
                            `min ${-(targetAmount * 0.00125)} ` +
                            `max ${(targetAmount * 0.00625)}`
                        );
                        return;
                    }
                    await trade(symbol, currentPrice, quantity, forceTrade);
                    deltas[symbol] = 0;
                }
            } catch (e) {
                str = 'trade failed: ' + quantity + ' of ' + symbol + ' at ' + currentPrice + ': ' + e;
                addLogMessage(str);
            }
        }
    }
}

process.stdout.write('\u001B[?25l'); // clear screen

async function updateStepSize(symbol) {
    const info1 = await binance.exchangeInfo({ symbol: `${symbol}USDT`});
    for (const s of info1.symbols)
    {
        if (!s.symbol.endsWith('USDT')) {
            continue;
        }
        const symbol = s.symbol.replace(/USDT$/, '');
        if (!(symbol in currencies)) {
            continue;
        }
        const lotSizeFilter = s.filters.find(f => f.filterType === 'LOT_SIZE');
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        if (symbol in symbols) {
            symbols[symbol].stepSize = stepSize;
        }
    }
}

// get current ballance
binance.accountInfo().then(async info => {
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                db.run(SCHEMA, (err) => { if (err) { reject(err) } else { resolve() } });

            } catch (e) {
                reject(e);
            }
        })
    });

    process.stdout.cursorTo(0, 0);
    process.stdout.clearScreenDown();
    const allSymbols = info.balances
        .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
        .map(b => b.asset)
        .filter(a=>a !== 'USDT');

    for (const balance of info.balances)
    {
        const value = parseFloat(balance.free) + parseFloat(balance.locked);
        if (value > 0)
        {
            balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            if (balance.asset in currencies && balance.asset in symbols) {
                printSymbol(balance.asset);
            }
        }
    }

    // subscribe for ballance updates
    binance.ws.user(async msg => {
        if (msg.eventType === 'outboundAccountPosition') {
            for (const balance of msg.balances) {
                balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            }
        }
    });

    startTotal = await readProfits();

    // addLogMessage(`❓ Press '?' for help`);
    // setTimeout(() => {
    //     logMessages.shift();
    //     process.stdout.cursorTo(0, Object.keys(currencies).length + logMessages.length + 2);
    //     process.stdout.clearLine(1);
    //  }, 2000);

    readTransactionLog();


    binance.ws.ticker([...allSymbols.sort()].map(k => `${k}USDT`), async priceInfo => {
        // console.log(priceInfo);
        // return;
        const symbol = priceInfo.symbol.replace(/USDT$/, '');
        if (symbol === 'USDC') return;

        if (!(symbol in symbols)) {
            symbols[symbol] = new Symbol(symbol, priceInfo);
            updateStepSize(symbol);
            // symbols[symbol].buyThreshold = thresholds.buy[symbol] ? thresholds.buy[symbol] : Settings.buyThreshold;
            // symbols[symbol].sellThreshold = thresholds.sell[symbol] ? thresholds.sell[symbol] : Settings.sellThreshold;

        } else {
            symbols[symbol].update(priceInfo);
        }

        if (!(symbol in currencies)) {
                // addLogMessage(`🚀 ${symbol} delta balance ${balances[symbol]} price ${symbols[symbol].price}, ${balances[symbol] * symbols[symbol].price}`)
            currencies[symbol] = balances[symbol] * symbols[symbol].price;
            printTrades();
        }

        if (symbol in currencies) {
            await tick(parseFloat(priceInfo.eventTime), symbol);
        }
    });
});
