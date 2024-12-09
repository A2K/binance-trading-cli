const Binance = require('binance-api-node').default;

require('dotenv').config();
const chalk = require('chalk');

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET
});

const UNICODE_VOID = ' ';
const UNICODE_BODY = '┃';
const UNICODE_HALF_BODY_BOTTOM = '╻';
const UNICODE_HALF_BODY_TOP = '╹';
const UNICODE_WICK = '│';
const UNICODE_TOP = '╽';
const UNICODE_BOTTOM = '╿';
const UNICODE_UPPER_WICK = '╷';
const UNICODE_LOWER_WICK = '╵';

class Candle {
    constructor(data) {
        this.time = {
            open: new Date(data.openTime),
            close: new Date(data.closeTime)
        }
        this.open = parseFloat(data.open);
        this.high = parseFloat(data.high);
        this.low = parseFloat(data.low);
        this.close = parseFloat(data.close);
        this.volume = parseFloat(data.volume);
        this.trades = data.trades;
        this.baseAssetVolume = parseFloat(data.baseAssetVolume);
        this.quoteAssetVolume = parseFloat(data.quoteAssetVolume);
    }

    update(time, price) {
        // this.time.close = time;
        this.close = price;
        this.low = Math.min(this.low, price);
        this.high = Math.max(this.high, price);
    }

    render(min, max, height, y) {
        return chalk.rgb(
            this.open < this.close ? 0 : 255,
            this.open < this.close ? 255 : 0, 0)
            (this.render_unicode(min, max, height, y));
    }

    render_unicode(min, max, height, y) {
        const step = (max - min) / height;
        const startPrice = max - step * (y + 1);
        const endPrice = max - step * y;
        if (startPrice >= Math.min(this.open, this.close) &&
            startPrice <= Math.max(this.open, this.close)) {
            if (endPrice >=Math.min(this.open, this.close) && endPrice <= Math.max(this.open, this.close)) {
                return UNICODE_BODY;
            }
            if (endPrice <= this.high) {
                return UNICODE_TOP;
            }
            return UNICODE_HALF_BODY_BOTTOM;
        } else if (endPrice >= Math.min(this.open, this.close) &&
                   endPrice <= Math.max(this.open, this.close)) {
            if (startPrice > Math.min(this.open, this.close)) {
                return UNICODE_BODY;
            }
            if (startPrice > this.low) {
                return UNICODE_BOTTOM;
            }
            return UNICODE_HALF_BODY_TOP;
        }
        if (startPrice <= Math.min(this.open, this.close) &&
            endPrice >= Math.max(this.open, this.close)) {
                return UNICODE_BODY;
        }
        if (startPrice < this.close && endPrice >= this.close) {
            if (startPrice < this.low && endPrice > this.low) {
                return UNICODE_HALF_BODY_TOP;
            }
            return UNICODE_TOP;
        } else if (startPrice < this.open && endPrice >= this.open) {
            if (startPrice < this.low && endPrice > this.low) {
                return UNICODE_HALF_BODY_BOTTOM;
            }
            return UNICODE_TOP;
        } else if (startPrice >= this.low && endPrice <= this.high) {
            const mid = (startPrice + endPrice) / 2;
            if (this.low >= (mid + this.low) / 2) {
                return UNICODE_LOWER_WICK;
            } else if (this.high <= (mid + this.high) / 2) {
                return UNICODE_UPPER_WICK;
            }
            return UNICODE_WICK;
        }
        return UNICODE_VOID;
    }
}

/**
 * @param {string} symbol
 * @param {string} interval
 * @param {number} count
 * @returns {Promise<Candle[]>}
 */
async function getCandles(symbol, interval, count) {
    return new Promise(resolve =>
        binance.candles({ symbol: `${symbol}USDT`, interval, limit: count }).then((candles) =>
            resolve(candles.map(c => new Candle(c)))));
}

/**
 * @param {Candle[]} candles
 * @param {number} height
 * @returns {Promise<string[]>}
 */
function renderCandles(candles, height) {
    const max = candles.reduce((acc, candle) => Math.max(acc, candle.high), 0);
    const min = candles.reduce((acc, candle) => Math.min(acc, candle.low), Infinity);
    const result = new Array(height).fill(0).map((_, y) =>
        candles.map(candle => candle.render(min, max, height, y)).join(''));
    result.min = min;
    result.max = max;
    return result;
}

/**
 * @param {string} symbol
 * @param {string} interval
 * @param {number} width
 * @param {number} height
 * @returns {Promise<string[]>}
 */
async function getAndRenderCandles(symbol, interval, width, height) {
    return renderCandles(await getCandles(symbol, interval, width), height);
}

exports.renderCandles = renderCandles;
exports.getCandles = getCandles;
exports.getAndRenderCandles = getAndRenderCandles;
exports.Candle = Candle;
