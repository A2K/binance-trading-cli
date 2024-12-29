import { Ticker } from 'binance-api-node';
import { Settings, thresholds, enabledBuys, enabledSells, maxDailyLosses, interpSpeeds, saveConfigFile } from './settings';
import { Indicators } from './indicators';


export class IndicatorValues {
    EMAs: number[] = [];
    SMAs: number[] = [];
    RSIs: number[] = [];
    StochasticRSIs: number[] = [];
}

export class Symbol implements Ticker {
    symbol: string;
    indicators: Indicators;
    forceTrade: boolean = false;
    deltaPrice: number = 0;
    statusLine: string = '';
    minNotional: number = 10;
    stepSize: number = 0.0001;
    minQty: number = 0.0001;

    eventType: string;
    eventTime: number;
    priceChange: string;
    priceChangePercent: string;
    weightedAvg: string;
    prevDayClose: string;
    curDayClose: string;
    closeTradeQuantity: string;
    bestBid: string;
    bestBidQnt: string;
    bestAsk: string;
    bestAskQnt: string;
    open: string;
    high: string;
    low: string;
    volume: string;
    volumeQuote: string;
    openTime: number;
    closeTime: number;
    firstTradeId: number;
    lastTradeId: number;
    totalTrades: number;

    indicatorValues: IndicatorValues = new IndicatorValues();

    showTradeFrames: number = 0;

    get lowPrice(): number {
        return parseFloat(this.low);
    }

    get highPrice(): number {
        return parseFloat(this.high);
    }

    constructor(symbol: string, data: Ticker) {
        // Object.assign(this, data);
        this.symbol = symbol;
        this.indicators = new Indicators();
        this.eventType = data.eventType;
        this.eventTime = data.eventTime;
        this.priceChange = data.priceChange;
        this.priceChangePercent = data.priceChangePercent;
        this.weightedAvg = data.weightedAvg;
        this.prevDayClose = data.prevDayClose;
        this.curDayClose = data.curDayClose;
        this.closeTradeQuantity = data.closeTradeQuantity;
        this.bestBid = data.bestBid;
        this.bestBidQnt = data.bestBidQnt;
        this.bestAsk = data.bestAsk;
        this.bestAskQnt = data.bestAskQnt;
        this.open = data.open;
        this.high = data.high;
        this.low = data.low;
        this.volume = data.volume;
        this.volumeQuote = data.volumeQuote;
        this.openTime = data.openTime;
        this.closeTime = data.closeTime;
        this.firstTradeId = data.firstTradeId;
        this.lastTradeId = data.lastTradeId;
        this.totalTrades = data.totalTrades;
    }

    get buyThreshold(): number {
        return thresholds.buy[this.symbol] ? thresholds.buy[this.symbol] : Settings.buyThreshold;
    }

    get sellThreshold(): number {
        return thresholds.sell[this.symbol] ? thresholds.sell[this.symbol] : Settings.sellThreshold;
    }

    set buyThreshold(value: number) {
        thresholds.buy[this.symbol] = value;
        saveConfigFile('thresholds', thresholds);
    }

    set sellThreshold(value: number) {
        thresholds.sell[this.symbol] = value;
        saveConfigFile('thresholds', thresholds);
    }

    get enableBuy(): boolean {
        return enabledBuys[this.symbol] ? true : false;
    }

    set enableBuy(value: boolean) {
        enabledBuys[this.symbol] = value;
        saveConfigFile('enabledBuys', enabledBuys);
    }

    get enableSell(): boolean {
        return enabledSells[this.symbol] ? true : false;
    }

    set enableSell(value: boolean) {
        enabledSells[this.symbol] = value;
        saveConfigFile('enabledSells', enabledSells);
    }

    get price(): number {
        return ((parseFloat(this.bestAsk) || 0) + (parseFloat(this.bestBid) || 0)) / 2;
    }

    get maxDailyLoss(): number {
        return this.symbol in maxDailyLosses ? maxDailyLosses[this.symbol] : Settings.maxDailyLoss;
    }

    set maxDailyLoss(value: number) {
        maxDailyLosses[this.symbol] = value;
        saveConfigFile('maxDailyLosses', maxDailyLosses);
    }

    get interpSpeed(): number {
        return this.symbol in interpSpeeds ? interpSpeeds[this.symbol] : Settings.interpSpeed;
    }

    set interpSpeed(value: number) {
        interpSpeeds[this.symbol] = value;
        saveConfigFile('interpSpeeds', maxDailyLosses);
    }

    update(data: Ticker): void {
        Object.assign(this, data);
    }

    async updateIndicators(): Promise<void> {
        const ranges = [{
            interval: '1m',
            range: 60
        }, {
            interval: '1h',
            range: 24
        }, {
            interval: '1d',
            range: 7
        }, {
            interval: '1d',
            range: 30
        }];

        const run = async (method: string) => this.indicatorValues[`${method}s` as keyof IndicatorValues] =
            await Promise.all(ranges.map(r => {
                return (this.indicators[method as keyof Indicators])(this.symbol.replace(/USDT$/, ''), r.interval, r.range);
            }));
        try {
            await run('SMA');
            await Promise.all(['EMA', 'RSI', 'StochasticRSI'].map(run));
        } catch (e) {
            console.error(e);
        }
    }
}

export default Symbol;