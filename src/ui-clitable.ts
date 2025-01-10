
import chalk from 'chalk';
import state from './state';
import Settings from './settings';
import readline from 'readline';
import candles, { Candle, LiveCandleData } from './candles';
import { bgLerp, lerpColor, lerpChalk, clamp, getAssetBallance, progressBarText, verticalBar, trimTrailingZeroes, DelayedExecution, timestampStr, getAvgBuyPrice, formatAssetQuantity, getAssetBallanceFree } from './utils';
import { readProfits, readTransactionLog } from './transactions';
import { CandleChartInterval_LT } from 'binance-api-node';
import { getStakedQuantity, getStakingEffectiveAPR, getStakingEffectiveAPRAverage } from './autostaking';
import { getLiveIndicator, LiveIndicator, LiveOHLCVHistory } from './indicators';
import { sma, ema, rsi, stochasticrsi } from 'trading-indicator';
import Trade from './trade';
import fs from 'fs';
import GraphemeSplitter from 'grapheme-splitter';
import wrap from 'word-wrap';
import { log } from './ui';

export class CLICell {
    constructor(public getter: (width: number) => Promise<string> = async () => ' '.repeat(width), public width: number = 10) { }

    public async render(): Promise<string> {
        try {
            return await this.getter(this.width);
        } catch (e) {
            log.err(e);
            return 'ERR'.padEnd(this.width);
        }
    }
}

export default class CLITable {

    public rows: CLICell[][] = [];

    constructor(rows: number, columns: number, public spacing: number = 1) {
        this.rows = new Array(rows).fill(0).map(() => new Array(columns).fill(0).map(() => new CLICell(async () => '')));
    }

    public setCell(row: number, column: number, getter: (width: number) => Promise<string>): void {
        this.rows[row][column].getter = getter;
    }

    public setColumnWidth(column: number, width: number): void {
        this.rows.forEach(row => row[column].width = width);
    }

    public async renderRow(index: number): Promise<string> {
        return (await Promise.all(this.rows[index].map(async (cell: CLICell) => await cell.render()))).join(' '.repeat(this.spacing));
    }

    public async renderTable(): Promise<string[]> {
        return await Promise.all(this.rows.map(async (_, index: number) => await this.renderRow(index)));
    }

}