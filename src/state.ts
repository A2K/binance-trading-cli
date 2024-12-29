import Symbol from './symbol';
import fs from 'fs';

type CandleData = import('./candles.js').Candle[];

class State {
    symbols: { [key: string]: Symbol } = {};
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
        scales: string[];
        data: CandleData;
        time: { open: number; close: number };
    } = {
            scales: ['1s', '1m', '15m', '1h', '4h', '1d', '1w', '1M'],
            scale: 1,
            height: -1,
            XBase: 96,
            data: [],
            time: { open: 0, close: 0 },
        };
    enableSell: boolean = false;
    enableBuy: boolean = false;
    steps: number[] = [1, 5, 10, 25, 50, 100, 500, 1000];
    step: number = 5;
    constructor() {
        try {
            this.currencies = JSON.parse(fs.readFileSync('./currencies.json', 'utf8'));
        } catch (e) { }
    }
}

const state = new State();
export default state;