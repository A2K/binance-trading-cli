import { Candle } from './candles.js';
import { getConfig } from './settings';
import Symbol from './symbol';

type CandleTimeScale = '1s' | '1m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';

class State {
    assets: { [key: string]: Symbol } = {};
    balances: { [key: string]: number } = {};
    currencies: { [key: string]: number } = {};
    selectedRow: number = -1;
    deltas: { [key: string]: number } = {};
    velocities: { [key: string]: number } = {};
    lastTickTime: { [key: string]: number } = {};
    lastPrice: { [key: string]: number } = {};
    candles: {
        scale: number;
        height: number;
        XBase: number;
        scales: CandleTimeScale[];
        data: Candle[]
    } = {
            scales: ['1s', '1m', '15m', '1h', '4h', '1d', '1w', '1M'],
            scale: 1,
            height: -1,
            XBase: 107,
            data: []
        };
    enableSell: boolean = false;
    enableBuy: boolean = false;
    steps: number[] = [1, 5, 10, 25, 50, 100, 500, 1000];
    step: number = 5;
    constructor() {
        this.currencies = getConfig('currencies');
        if ('BNSOL' in this.currencies) {
            delete this.currencies['BNSOL'];
        }
    }
}

const state = new State();
export default state;