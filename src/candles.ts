import Binance, { Candle as CandleData, CandleChartInterval_LT, CandleChartResult, ReconnectingWebSocketHandler } from 'binance-api-node';
import dotenv from 'dotenv';
import chalk from 'chalk';
import Settings from './settings';
import { WebsocketAPI } from '@binance/connector-typescript';

dotenv.config();

import binance from './binance-ext/throttled-binance-api';

const UNICODE_VOID: string = ' ';
const UNICODE_BODY: string = '┃';
const UNICODE_HALF_BODY_BOTTOM: string = '╻';
const UNICODE_HALF_BODY_TOP: string = '╹';
const UNICODE_WICK: string = '│';
const UNICODE_TOP: string = '╽';
const UNICODE_BOTTOM: string = '╿';
const UNICODE_UPPER_WICK: string = '╷';
const UNICODE_LOWER_WICK: string = '╵';
const UNICODE_MID: string = '┿';
const UNICODE_HORIZ: string = '━';

const UP_W: string[] = ['╷', '│', '╽', '┃'];
const DOWN_W: string[] = ['╵', '│', '╿', '┃'];
const UP_B: string[] = [' ', ' ', '╻', '┃'];
const DOWN_B: string[] = [' ', ' ', '╹', '┃'];

// export interface CandleData {
//     openTime: number;
//     closeTime: number;
//     open: string;
//     high: string;
//     low: string;
//     close: string;
//     volume: string;
//     trades: number;
//     baseAssetVolume: string;
//     quoteAssetVolume: string;
// }

export class Candle {
    time: { open: Date; close: Date };
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    trades: number;
    baseAssetVolume: number;
    quoteAssetVolume: number;

    constructor(data: CandleChartResult) {
        this.time = {
            open: new Date(data.openTime),
            close: new Date(data.closeTime)
        };
        this.open = parseFloat(data.open);
        this.high = parseFloat(data.high);
        this.low = parseFloat(data.low);
        this.close = parseFloat(data.close);
        this.volume = parseFloat(data.volume);
        this.trades = data.trades;
        this.baseAssetVolume = parseFloat(data.baseAssetVolume);
        this.quoteAssetVolume = parseFloat(data.quoteAssetVolume);
    }

    update(time: Date, price: number): void {
        this.close = price;
        this.low = Math.min(this.low, price);
        this.high = Math.max(this.high, price);
    }

    render(min: number, max: number, height: number, y: number): string {
        return chalk.rgb(
            this.open < this.close ? 0 : 255,
            this.open < this.close ? 255 : 0, 0)
            (this.render_unicode(min, max, height, y));
    }

    render_unicode(min: number, max: number, height: number, y: number): string {
        const step: number = (max - min) / height;
        const startPrice: number = max - step * (y + 1);
        const endPrice: number = max - step * y;

        const openCloseMin: number = Math.min(this.open, this.close);
        const openCloseMax: number = Math.max(this.open, this.close);

        if (startPrice < openCloseMin && endPrice > openCloseMax) {
            return this.low > startPrice && this.high < endPrice ? (
                (Math.abs(this.high - this.low) / Math.abs(startPrice - endPrice) < 0.25) ? UNICODE_HORIZ : UNICODE_MID) : UNICODE_BODY;
        }
        if (startPrice >= openCloseMin && startPrice <= openCloseMax) {
            if (endPrice >= openCloseMin && endPrice <= openCloseMax) {
                return UNICODE_BODY;
            }
            return endPrice <= this.high ? UNICODE_TOP : UNICODE_HALF_BODY_BOTTOM;
        }
        if (endPrice >= openCloseMin && endPrice <= openCloseMax) {
            return startPrice > openCloseMin ? UNICODE_BODY : (startPrice > this.low ? UNICODE_BOTTOM : UNICODE_HALF_BODY_TOP);
        }
        if (startPrice <= openCloseMin && endPrice >= openCloseMax) {
            return UNICODE_BODY;
        }
        if (startPrice < this.close && endPrice >= this.close) {
            return startPrice < this.low && endPrice > this.low ? UNICODE_HALF_BODY_TOP : UNICODE_TOP;
        }
        if (startPrice < this.open && endPrice >= this.open) {
            return startPrice < this.low && endPrice > this.low ? UNICODE_HALF_BODY_BOTTOM : UNICODE_TOP;
        }
        if (startPrice >= this.low && endPrice <= this.high) {
            const mid: number = (startPrice + endPrice) / 2;
            return this.low >= (mid + this.low) / 2 ? UNICODE_LOWER_WICK : (this.high <= (mid + this.high) / 2 ? UNICODE_UPPER_WICK : UNICODE_WICK);
        }
        return UNICODE_VOID;
    }
}

export async function getCandles(symbol: string, interval: CandleChartInterval_LT, count: number): Promise<Candle[]> {
    return new Promise(resolve =>
        binance.candles({ symbol: `${symbol}${Settings.stableCoin}`, interval, limit: count }).then((candles) =>
            resolve(candles.map(c => new Candle(c)))));
}

export function renderCandles(candles: Candle[], height: number): { rows: string[]; min: number; max: number } {
    const max: number = candles.reduce((acc, candle) => Math.max(acc, candle.high), 0);
    const min: number = candles.reduce((acc, candle) => Math.min(acc, candle.low), Infinity);
    const result: string[] = new Array(height).fill(0).map((_, y) =>
        candles.map(candle => candle.render(min, max, height, y)).join(''));
    return { rows: result, min, max };
}

export async function getAndRenderCandles(symbol: string, interval: CandleChartInterval_LT, width: number, height: number): Promise<string[]> {
    return renderCandles(await getCandles(symbol, interval, width), height).rows;
}

export class LiveCandleData {
    data: Candle[];
    private interval: CandleChartInterval_LT;
    private symbol: string;
    private currency: string;
    private width: number;

    get length(): number {
        return this.data ? this.data.length : this.width;
    }

    api: import("binance-api-node").Binance;
    private socketHandle?: ReconnectingWebSocketHandler;

    constructor(symbol: string, currency: string, interval: CandleChartInterval_LT, width: number, autoInit = true) {
        this.data = [];
        this.interval = interval;
        this.symbol = symbol;
        this.currency = currency;
        this.width = width;
        this.api = Binance({ apiKey: process.env.BINANCE_API_KEY, apiSecret: process.env.BINANCE_API_SECRET });
        if (autoInit) this.init();
    }

    async init() {
        if (this.socketHandle) {
            this.api = Binance({ apiKey: process.env.BINANCE_API_KEY, apiSecret: process.env.BINANCE_API_SECRET });
            delete this.socketHandle;
        }

        this.data = (await binance.candles({
            symbol: `${this.symbol}${this.currency}`,
            interval: this.interval,
            limit: this.width
        })).map(c => new Candle(c));

        this.socketHandle = this.api.ws.candles(`${this.symbol}${this.currency}`, this.interval, (candle) => {
            if (this.data.length > 0 && candle.startTime === this.data[this.data.length - 1].time.open.getTime()) {
                this.data[this.data.length - 1].update(new Date(candle.closeTime), parseFloat(candle.close));
            } else {
                this.data.push(new Candle({ ...candle, openTime: candle.startTime, baseAssetVolume: candle.volume, quoteAssetVolume: candle.quoteVolume }));
                while (this.data.length > this.width) {
                    this.data.shift();
                }
            }
        });
    }
}

export default {
    Candle,
    getCandles,
    renderCandles,
    getAndRenderCandles
}