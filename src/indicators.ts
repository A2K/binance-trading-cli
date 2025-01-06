import { sma, ema, rsi, stochasticrsi, getDetachSourceFromOHLCV } from 'trading-indicator';
import cache from 'memory-cache';
import Settings from './settings';
import binance from './binance-ext/throttled-binance-api';
import { CandleChartInterval_LT } from 'binance-api-node';
import { log } from './ui';

export class OHLCV {
    open: number[] = [];
    high: number[] = [];
    low: number[] = [];
    close: number[] = [];
    volume: number[] = [];
    time: number[] = [];
};

export class LiveOHLCVHistory {
    data: OHLCV = new OHLCV();

    pair: string;
    interval: string;
    size: number = -1;
    updateCallbacks: ((history: LiveOHLCVHistory) => void)[] = [];
    handle?: import("binance-api-node").ReconnectingWebSocketHandler;

    constructor(pair: string, interval: string) {
        this.pair = pair;
        this.interval = interval;
    }

    async init() {
        const candles = await binance.candles({
            symbol: this.pair,
            interval: this.interval as CandleChartInterval_LT
        });

        this.size = candles.length;

        for (const candle of candles) {
            this.data.open.push(parseFloat(candle.open));
            this.data.high.push(parseFloat(candle.high));
            this.data.low.push(parseFloat(candle.low));
            this.data.close.push(parseFloat(candle.close));
            this.data.volume.push(parseFloat(candle.volume));
            this.data.time.push(new Date(candle.openTime).getTime());
        }

        this.handle = binance.ws.candles(this.pair, this.interval, (candle) => {
            if (this.data.time.length > 0 && candle.startTime === this.data.time[this.data.time.length - 1]) {
                this.data.open[this.data.open.length - 1] = parseFloat(candle.open);
                this.data.high[this.data.high.length - 1] = parseFloat(candle.high);
                this.data.low[this.data.low.length - 1] = parseFloat(candle.low);
                this.data.close[this.data.close.length - 1] = parseFloat(candle.close);
                this.data.volume[this.data.volume.length - 1] = parseFloat(candle.volume);
            } else {
                this.data.open.push(parseFloat(candle.open));
                this.data.high.push(parseFloat(candle.high));
                this.data.low.push(parseFloat(candle.low));
                this.data.close.push(parseFloat(candle.close));
                this.data.volume.push(parseFloat(candle.volume));
                this.data.time.push(candle.startTime);
            }
            while (this.data.time.length > this.size) {
                this.data.open.shift();
                this.data.high.shift();
                this.data.low.shift();
                this.data.close.shift();
                this.data.volume.shift();
                this.data.time.shift();
            }
            this.updateCallbacks.map(cb => cb(this));
        });

        return this;
    }

    on(event: 'update', callback: (history: LiveOHLCVHistory) => void) {
        if (event === 'update') {
            this.updateCallbacks.push(callback);
        }
    }

    off(event: 'update') {
        if (event === 'update') {
            this.updateCallbacks = [];
        }
    }

    close() {
        if (this.handle) {
            this.handle();
        }
    }
}

export class LiveIndicator {
    pair: string;
    interval: string;
    method: (history: LiveOHLCVHistory) => Promise<number>;

    history: LiveOHLCVHistory;

    public value: number = NaN;
    private needsUpdate: boolean = true;

    constructor(pair: string, interval: string, algo: (history: LiveOHLCVHistory) => Promise<number>) {
        this.pair = pair;
        this.interval = interval;
        this.method = algo;
        this.history = new LiveOHLCVHistory(pair, interval);
    }

    async init(): Promise<LiveIndicator> {
        await this.history.init();
        this.value = await this.method(this.history);
        this.history.on('update', (history: LiveOHLCVHistory) => {
            this.needsUpdate = true;
        });
        return this;
    }

    async update(): Promise<LiveIndicator> {
        if (this.needsUpdate) {
            this.value = await this.method(this.history);
            this.needsUpdate = false;
        }
        return this;
    }

    close() {
        this.history.close();
    }
}

async function getLiveOHLCVHistory(pair: string, interval: string): Promise<LiveOHLCVHistory> {
    const cacheKey = `getLiveOHLCVHistory(${pair},${interval})`;
    return cache.get(cacheKey) || cache.put(cacheKey, new LiveOHLCVHistory(pair, interval).init());
}

export async function getLiveIndicator(name: string, pair: string, interval: string, method: (history: LiveOHLCVHistory) => Promise<number>): Promise<LiveIndicator> {
    const cacheKey = `getLiveIndicator(${name},${pair},${interval})`;
    return await (await (cache.get(cacheKey) || cache.put(cacheKey, new LiveIndicator(pair, interval, method)).init())).update();
}

export async function closeLiveIndicator(name: string, pair: string, interval: string): Promise<void> {
    const cacheKey = `getLiveIndicator(${name},${pair},${interval})`;
    const indicator = await cache.get(cacheKey) as LiveIndicator;
    if (indicator) {
        indicator.close();
        cache.del(cacheKey);
    }
}

export class Indicators {
    static async SMA(symbol: string, interval: string = '1h', period: number = 8): Promise<number> {
        const history = await getLiveOHLCVHistory(`${symbol}${Settings.stableCoin}`, interval);
        const smaData: number[] = await sma(period, "close", history.data);
        return smaData[smaData.length - 1];
    }

    static async EMA(symbol: string, interval: string = '1h', period: number = 8): Promise<number> {
        const history = await getLiveOHLCVHistory(`${symbol}${Settings.stableCoin}`, interval);
        const emaData: number[] = await ema(period, "close", history.data);
        return emaData[emaData.length - 1];
    }

    static async RSI(symbol: string, interval: string = '1h', period: number = 14): Promise<number> {
        const history = await getLiveOHLCVHistory(`${symbol}${Settings.stableCoin}`, interval);
        const rsiData: number[] = await rsi(period, "close", history.data);
        return rsiData[rsiData.length - 1];
    }

    static async StochasticRSI(symbol: string, interval: string = '1h', period: number = 14, k: number = 9, d: number = 6): Promise<number | undefined> {
        const history = await getLiveOHLCVHistory(`${symbol}${Settings.stableCoin}`, interval);
        const stochasticRSIData: any[] = await stochasticrsi(k, d, period, period, "close", history.data);
        return stochasticRSIData.length ? stochasticRSIData[stochasticRSIData.length - 1].stochRSI : undefined;
    }
}

export default Indicators;