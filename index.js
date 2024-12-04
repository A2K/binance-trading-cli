const Binance = require('binance-api-node').default;
const { Ticker } = require('binance-api-node');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./transactions.db');
const chalk = require('chalk');
const fs = require('fs');
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
    try {
        // create settings.json file with your own settings
        return require('./settings.json');
    } catch (e) {
        return{
            buyThreshold: 35,
            sellThreshold: 25,
            maxDailyLoss: 0,
            interpSpeed: 0.00025,
            enableTradeByDefault: false,
            enableInputLogging: false
        }
    }
})();

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET
});

const cachedProfits = {
    total: 0
};

/**
 * @param {string} symbol
 * @param {number} amount
 * @param {number} price
 * @param {number} total
 * @param {number} fee
 * @returns Promise<Trade>
 */
async function save(symbol, amount, price, total, fee) {
    balances[symbol] -= amount;
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                db.run(`CREATE TABLE IF NOT EXISTS transations
                    (time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                     symbol TEXT,
                     amount REAL,
                     price REAL,
                     total REAL,
                     fee REAL)`);

                const stmt = db.prepare("INSERT INTO transations(symbol, amount, price, total, fee) VALUES (?, ?, ?, ?, ?)");
                stmt.run(symbol, amount, price, total, fee);
                stmt.finalize((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    cachedProfits[symbol.substring(0, symbol.length - 4)] -= amount * price + fee;
                    cachedProfits.total -= amount * price + fee;
                    resolve(new Trade(symbol, amount, price, total, fee));
                });

            } catch (e) {
                reject(e);
            }
        });
    });
}

async function readProfits(symbol) {
    if (symbol) {
        if (symbol in cachedProfits && typeof(cachedProfits[symbol]) !== 'undefined') {
            return cachedProfits[symbol];
        }
    } else if ('total' in cachedProfits && typeof(cachedProfits.total) !== 'undefined') {
        return cachedProfits.total;
    }

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            if (symbol) {
                db.each(`SELECT SUM(total) as total FROM transations WHERE symbol = '${symbol}USDT' AND time >= DATETIME('now', 'start of day')`, (err, row) => {
                // db.each(`SELECT SUM(total) as total FROM transations WHERE symbol = '${symbol}USDT'`, (err, row) => {
                    const result = parseFloat(row.total || 0);
                    cachedProfits[symbol] = result;
                    resolve(result);
                });
            } else {
                db.each(`SELECT SUM(total) as total FROM transations WHERE time >= DATETIME('now', 'start of day')`, (err, row) => {
                // db.each(`SELECT SUM(total) as total FROM transations`, (err, row) => {
                    const result = parseFloat(row.total || 0);
                    cachedProfits["total"] = result;
                    resolve(result);
                });
            }
        });
    });
}

async function readHistory(numRows) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.each(`SELECT * FROM transations ORDER BY time DESC LIMIT ${numRows}`, (err, row) => {
                resolve(parseFloat(row.total || 0));
            });
        });
    });
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
    constructor(symbol, quantity, price, total, commission) {
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
        ` ${new Date().toLocaleDateString("uk-UA", {
            year: 'numeric',
            month: 'numeric',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })} ` +
        `${(quantity >= 0 ? chalk.redBright : chalk.greenBright)((quantity > 0 ? '-' : '+') + Math.abs(tradeTotal).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
        `${(quantity < 0 ? chalk.red : chalk.green)((quantity >= 0 ? '+' : '-') + formatFloat(Math.abs(quantity)))} ${chalk.bold(this.symbol.replace(/USDT$/, ''))} at ${chalk.yellow(formatFloat(this.price, 8))} ` +
        `(fee: ${chalk.yellowBright(formatFloat(this.commission, 4))})`
    }
}

class Symbol
{
    constructor(data)
    {
        Object.assign(this, data);
        this.startPrice = this.price;
    }

    get price() {
        return ((parseFloat(this.bestAsk) || 0) + (parseFloat(this.bestBid) || 0)) / 2;
    }

    /**
     * @param {Ticker} data
     */
    update(data) {
        Object.assign(this, data);
    }
}

async function trade(symbol, price, quantity, forceTrade = false) {
    //console.log(quantity > 0 ? '🪙 BUY' : '💵 SELL', Math.abs(quantity), symbol, 'at', price);
    if (quantity >= 0)
    {
        const todayProfits = await readProfits(symbol);
        if ((todayProfits - quantity * price) < -Settings.maxDailyLoss && !forceTrade)
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
                quantity: Math.abs(quantity),
                //type: "LIMIT",
                type: "MARKET",
                //price: price,
                //timeInForce: 'IOC'
            });
            //console.log(completedOrder)

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
    addLogMessage(await save(`${symbol}USDT`, quantity, tradePrice, finalSaleValueUsd, commission));
}

function printTrades() {
    while (trades.length > process.stdout.rows - Object.keys(currencies).length - 2) {
        trades.shift();
    }

    for (var i = 0; i < trades.length; i++) {
        process.stdout.cursorTo(0, Object.keys(currencies).length + (trades.length - i) + 1);
        process.stdout.clearLine(0);
        process.stdout.write(trades[i]);
        process.stdout.clearLine(1);
    }
}

function printSymbol(symbol) {
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
}

function formatFloat(number, n = 2) {
    return parseFloat(number.toFixed(n));
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

const trades = [];
const addLogMessage = (msg) => {
    trades.push(msg.toString());
    while (trades.length > process.stdout.rows - Object.keys(currencies).length - 2) {
        trades.shift();
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
                process.stdout.write(symbols[Object.keys(currencies).sort()[selectedRow]].statusLine + '');
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
            else if (code[0] === 45) // minus
            {

            }
            else if (code[0] === 43) // plus
            {

            }

            if (selectedRow >= 0) {
                printStats(Object.keys(currencies).sort()[selectedRow]);
            }

        } else if (code.length === 1) {
            if (code[0] === 27) {
                if (selectedRow >= 0) {
                    process.stdout.cursorTo(0, selectedRow);
                    process.stdout.write(lines[Object.keys(currencies).sort()[selectedRow]]);
                    process.stdout.clearLine(1);
                }
                selectedRow = -1;
            } else if (code[0] === 13) {
                if (selectedRow >= 0) {
                    const symbol = Object.keys(currencies).sort()[selectedRow];
                    symbols[symbol].forceTrade = true;
                }
            } else if (code[0] === 63) { // question mark
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
            }
        }

        if (Settings.enableInputLogging)
        {
            addLogMessage(`INPUT: ${code.join(' ')}`);
            printTrades();
        }
    });
}

const printStats = async (symbol, deltaPrice) =>{
    // not actual braile
    // ⡆⡄⡀ ⠇⠃⠁
    // ⠃⠂ ⠄⡄
    // ⡀⠠⡀⢀⠄⠂
    // ⡇⡆⡄⡀
    // ⡇⠇⠃⠁
    // ⢸

    // ⠈⠘⠸⢸⢸
    // ⣠
    // ⣰
    if (deltaPrice) {
        symbols[symbol].deltaPrice = deltaPrice;
    } else {
        deltaPrice = symbols[symbol].deltaPrice;
    }
    const velocity = (velocities[symbol] || 0) * 10000;

    const makeVelocitySymbol = (velocity) => {
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
    const deltaUsd = deltas[symbol];
    const velocitySymbol = makeVelocitySymbol(velocity);
    const deltaSum = Object.keys(currencies).reduce((acc, delta) => acc + deltas[delta], 0);

    const relativeDeltaPrice = deltaPrice / symbols[symbol].price;
    const symbolProfit = await readProfits(symbol);

    const isSelected = Object.keys(currencies).sort().indexOf(symbol) === selectedRow;

    const total = Object.keys(currencies).reduce((acc, symbol) => acc + currencies[symbol], 0);
    const max = Object.keys(currencies).reduce((acc, symbol) => Math.max(acc, currencies[symbol] / total), 0);
    const fraction = currencies[symbol] / total / max;
    let str = `${(Math.round(currencies[symbol]) + '').padEnd(10)}`;
    const m = isSelected ? 2 : 1;
    str = chalk.bgRgb(10*m,50*m,120*m)(chalk.rgb(210, 210, 210)(str.substring(0, Math.round(fraction * str.length)))) +
          chalk.bgRgb(0*m,0*m,25*m)(str.substring(Math.round(fraction * str.length)));

    const timestamp = new Date().toLocaleDateString("uk-UA", {
        year: 'numeric',
        month: 'numeric',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

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
        return chalk.rgb(
            delta >= 0 ? 0 : Math.round(225 * (1.0 - alpha) + 255 * alpha),
            delta >= 0 ? Math.round(225 * (1.0 - alpha) + 255 * alpha) : 0,
            0)(deltaStr);
    }

    const relativePriceColor = chalk.rgb(relativeDeltaPrice >= 0 ?
        Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, relativeDeltaPrice * 1000)) || 0)) :
        0,
        relativeDeltaPrice >= 0 ? 0 :
        Math.max(180, Math.min(255, Math.round(255 * Math.min(1.0, -relativeDeltaPrice * 1000)) || 0)),
        0);

    symbols[symbol].statusLine = `📈 ${timestamp} ${symbol.padEnd(8)} ${velocitySymbol}` +

        `${relativePriceColor(symbols[symbol].price.toPrecision(6).padEnd(14))}` +

        str +

        ` ${(deltaUsd < 0 ? (-deltaUsd > Settings.sellThreshold ? chalk.greenBright : chalk.green) :
        (deltaUsd > Settings.buyThreshold ? chalk.redBright : chalk.red))(colorizeDeltaUsd(symbol, -deltaUsd))} ` +
        await colorizeSymbolProfit(symbol, symbolProfit) +
        ` ${symbols[symbol].enableTrade ? '🟢' : '🔴'}`;
        // (symbolProfit >= 0 ? chalk.green : chalk.red)(((symbolProfit > 0 ? '+' : '') + formatFloat(symbolProfit)).padEnd(10));

    printSymbol(symbol);

    const naturalChange = Object.keys(currencies).sort()
        .map(s => {
            if (!(s in symbols))
            {
                return 0;
            }
            return currencies[s] * (symbols[s].price - symbols[s].startPrice);
        })
        .reduce((acc, priceChange) => acc + priceChange, 0);

    const profits = await readProfits();
    const offset = Math.abs(Math.min(Math.min(0, parseFloat(profits)), Math.min(0, parseFloat(naturalChange))));
    // console.log('offset', offset);
    const efficiency = Math.abs((profits - offset) / (naturalChange - offset));
    const deltaSumStr = (deltaSum < 0 ? '+' : '') + formatFloat(-deltaSum);
    const profitsStr = (profits >= 0 ? '+' : '') + formatFloat(profits);
    const deltaSumColor = deltaSum <= 0 ? chalk.green : chalk.red;
    const profitsColor = profits >= 0 ? chalk.green : chalk.red;
    process.stdout.cursorTo(0, Object.keys(currencies).length);

    process.stdout.write(`${enableTrade ? '🟢' : '🔴'}${enableBuy ? '🟢' : '🔴'} ±${('' + steps[step]).padEnd(4)}                                         ${Object.values(currencies).reduce((acc, currency) => acc + currency, 0)}`.padEnd(25));

    process.stdout.cursorTo('                                                            '.length, Object.keys(currencies).length);
    process.stdout.write(`${deltaSumColor(deltaSumStr.padEnd(11))}${profitsColor(profitsStr.padEnd(11))}`);
    process.stdout.write(`${Math.round(balances.USDT)}`.padEnd(10));
    process.stdout.write(`E=${(efficiency >= 0 ? '+' : '') + formatFloat(efficiency * 100, 2)}%`.padEnd(12));
    process.stdout.write(`NC=${(naturalChange >= 0 ? '+' : '') + formatFloat(naturalChange)}`.padEnd(12));
    process.stdout.clearLine(1);
}

async function tick(time, symbol)
{
    if (!(symbol in symbols))
    {
        return;
    }

    const duration = time - (lastTickTime[symbol] || 0);

    if (Math.abs(duration) < 100 /*ms*/) {
        // already called this frame
        return;
    } else {
        lastTickTime[symbol] = time;
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

    const quantity = Math.round(Math.round(Math.round(delta / currentPrice) * currentPrice) / currentPrice);
    const deltaUsd = quantity * currentPrice;
    deltas[symbol] = deltaUsd;

    printStats(symbol, deltaPrice);

    if (enableTrade) {
        const velocity = velocities[symbol];
        const forceTrade = symbols[symbol].forceTrade;
        symbols[symbol].forceTrade = false;
        if (forceTrade || ((deltaUsd < 0 ? (velocity < 0.1) : (velocity > -0.1))
            && (((deltaUsd > Settings.buyThreshold) && enableBuy && symbols[symbol].enableTrade) || deltaUsd < -Settings.sellThreshold)))
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
                console.log('trade failed:', symbol, currentPrice, quantity, e);
            }
        }
    }
}

process.stdout.write('\u001B[?25l'); // clear screen

// get current ballance
binance.accountInfo().then(async info => {
    process.stdout.cursorTo(0, 0);
    process.stdout.clearScreenDown();
    for (const balance of info.balances)
    {
        const value = parseFloat(balance.free) + parseFloat(balance.locked);
        if (value >= 0)
        {
            balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            if (balance.asset in currencies && balance.asset in symbols) {
                printSymbol(balance.asset);
            }
        }
    }

    binance.ws.user(async msg => {
        if (msg.eventType === 'outboundAccountPosition')
        {
            for (const balance of msg.balances)
            {
                balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
            }
        }
    });

    startTotal = await readProfits();

    binance.ws.ticker([...Object.keys(currencies).sort(), 'BNB'].map(k => `${k}USDT`), async priceInfo => {
        const symbol = priceInfo.symbol.replace(/USDT$/, '');
        if (!(symbol in symbols)) {
            symbols[symbol] = new Symbol(priceInfo);
        } else {
            symbols[symbol].update(priceInfo);
        }
        if (symbol in currencies) {
            await tick(parseFloat(priceInfo.eventTime), symbol);
        }
    });
});
