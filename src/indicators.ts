import { sma, ema, rsi, stochasticrsi, getDetachSourceFromOHLCV } from 'trading-indicator';
import cache from 'memory-cache';
import Settings from './settings';

export class Indicators {
    async getData(symbol: string, interval: string = '1h'): Promise<any> {
        const cacheKey: string = `${symbol}_${interval}`;
        const cached: any = cache.get(cacheKey);
        let result: any = cached;
        if (!cached) {
            result = (await getDetachSourceFromOHLCV('binance', `${symbol}/${Settings.stableCoin}`, interval, false)).input;
            const cacheInterval: number =
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

    async SMA(symbol: string, interval: string = '1h', period: number = 8): Promise<number> {
        const smaData: number[] = await sma(period, "close", await this.getData(symbol, interval));
        return smaData[smaData.length - 1];
    }

    async EMA(symbol: string, interval: string = '1h', period: number = 8): Promise<number> {
        const emaData: number[] = await ema(period, "close", await this.getData(symbol, interval));
        return emaData[emaData.length - 1];
    }

    async RSI(symbol: string, interval: string = '1h', period: number = 14): Promise<number> {
        const rsiData: number[] = await rsi(period, "close", await this.getData(symbol, interval));
        return rsiData[rsiData.length - 1];
    }

    async StochasticRSI(symbol: string, interval: string = '1h', period: number = 14, k: number = 9, d: number = 6): Promise<number | undefined> {
        const stochasticRSIData: any[] = await stochasticrsi(k, d, period, period, "close", await this.getData(symbol, interval));
        return stochasticRSIData.length ? stochasticRSIData[stochasticRSIData.length - 1].stochRSI : undefined;
    }
}

export default Indicators;