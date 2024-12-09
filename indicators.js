const { sma, ema, rsi, stochasticrsi, getDetachSourceFromOHLCV } = require('trading-indicator');
const cache = require('memory-cache');

class Indicators {

    async getData(symbol, interval = '1h') {
        const cacheKey = `${symbol}_${interval}`;
        const cached = cache.get(cacheKey);
        let result = cached;
        if (!cached) {
            result = (await getDetachSourceFromOHLCV('binance', `${symbol}/USDT`, interval, false)).input; // true if you want to get future market
            const cacheInterval =
                interval === '1m' ? 1000 * 60 :
                interval === '1h' ? 1000 * 60 * 60 :
                interval === '4h' ? 1000 * 60 * 60 * 4 :
                interval === '1d' ? 1000 * 60 * 60 * 24 :
                interval === '1w' ? 1000 * 60 * 60 * 24 * 7 :
                interval === '1M' ? 1000 * 60 * 60 * 24 * 30 :
                interval === '1y' ? 1000 * 60 * 60 * 24 * 365 :
                interval === '1s' ? 1000 : 1000 * 60;
            cache.put(cacheKey, result, cacheInterval);
        }
        return result;
    }

    async SMA(symbol, interval = '1h', period = 8) {
        let smaData = await sma(period, "close", await this.getData(symbol, interval));
        return smaData[smaData.length - 1];
    }
    async EMA(symbol, interval = '1h', period = 8) {
        let emaData = await ema(period, "close", await this.getData(symbol, interval));
        return emaData[emaData.length - 1];
    }

    async RSI(symbol, interval = '1h', period = 14) {
        const rsiData = await rsi(period, "close", await this.getData(symbol, interval));
        return rsiData[rsiData.length - 1];
    }

    async StochasticRSI(symbol, interval = '1h', period = 14, k = 9, d = 6) {
        const stochasticRSIData = await stochasticrsi(k, d, period, period, "close", await this.getData(symbol, interval));
        return stochasticRSIData.length ? stochasticRSIData[stochasticRSIData.length - 1].stochRSI : undefined;
    }
}

const _Indicators = Indicators;
module.exports = { Indicators: _Indicators };

// new Indicators().StochasticRSI('BTC', 9, 6, '1d', 14).then(console.log);