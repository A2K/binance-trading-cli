import { AssetBalance } from 'binance-api-node';
import { Candle, LiveCandleData } from './candles.js';
import { getConfig } from './settings';
import Symbol from './symbol';
import binance from './binance-ext/throttled-binance-api.js';
import { log } from './ui.js';
import { formatAssetQuantity } from './utils.js';
import chalk from 'chalk';

type CandleTimeScale = '1s' | '1m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';

class Wallet {
    private assets: { [key: string]: AssetBalance } = {};
    private upToDate: { [key: string]: boolean } = {};

    constructor() {
        this.init();
    }

    async init() {
        await this.update();
        binance.ws.user(async (msg) => {
            if (msg.eventType === 'outboundAccountPosition') {
                const updates = msg.balances
                    .filter(b => b.asset in this.assets)
                    .map((b: AssetBalance): [AssetBalance, number] => [b, parseFloat(b.free) + parseFloat(b.locked)
                    - (parseFloat(this.assets[b.asset].free) || 0) - (parseFloat(this.assets[b.asset].locked) || 0)])
                    .sort(([a, deltaA], [b, deltaB]) => deltaB - deltaA)
                    .filter(([b, delta]) => Math.abs(delta) > 0.000001).map(([b, delta]) => {
                        return (delta > 0
                            ? chalk.greenBright(`+${formatAssetQuantity(b.asset, delta)}`)
                            : chalk.redBright(`-${formatAssetQuantity(b.asset, -delta)}`)) + ' ' + chalk.whiteBright(b.asset);
                    });
                if (updates.length) {
                    log(`👛 ${updates.join(', ')}`);
                }
                for (const balance of msg.balances!) {
                    this.assets[balance.asset] = balance;
                    this.upToDate[balance.asset] = true;
                }
            }
        });
    }

    private __updateInProgress?: Promise<void>;

    async update() {
        if (this.__updateInProgress) {
            return await this.__updateInProgress;
        }
        await (this.__updateInProgress = this._update());
    }

    private async _update() {
        try {
            const accountInfo = await binance.accountInfo();
            for (const balance of accountInfo.balances) {
                this.assets[balance.asset] = balance;
                this.upToDate[balance.asset] = true;
            }
            Object.keys(this.upToDate).filter(k => !this.upToDate[k]).forEach(k => delete this.assets[k]);
            delete this.__updateInProgress;
        } catch (e) {
            log.err('Failed to update wallet:', e);
            return;
        }
    }

    async get(asset: string): Promise<AssetBalance> {
        if (!this.upToDate[asset]) {
            await this.update();
        }
        return this.assets[asset] || { asset: asset, free: 0, locked: 0 };
    }

    async free(asset: string): Promise<number> {
        return parseFloat((await this.get(asset)).free);
    }

    async total(asset: string): Promise<number> {
        const b = await this.get(asset);
        return parseFloat(b.free) + parseFloat(b.locked);
    }

    markOutOfDate(asset: string) {
        this.upToDate[asset] = false;
    }
}

class State {
    assets: { [key: string]: Symbol } = {};
    wallet: Wallet = new Wallet();
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
        data?: LiveCandleData
    } = {
            scales: ['1s', '1m', '15m', '1h', '4h', '1d', '1w', '1M'],
            scale: 1,
            height: -1,
            XBase: 97
        };
    enableSell: boolean = false;
    enableBuy: boolean = false;
    steps: number[] = [1, 5, 10, 25, 50, 100, 500, 1000];
    step: number = 5;
    tradeScroll: number = 0;
    logScroll: number = 0;
    tradesScrollHover: boolean = false;
    logScrollHover: boolean = false;
    constructor() {
        this.currencies = getConfig('currencies');
        if ('BNSOL' in this.currencies) {
            delete this.currencies['BNSOL'];
        }
    }
}

const state = new State();
export default state;