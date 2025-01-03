
import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import cache from 'memory-cache';

import 'source-map-support/register';
import { addLogMessage } from './ui';
import { formatAssetQuantity, marketCeil, timestampStr } from './utils';
import state from './state';

import binance, { ThrottledBinanceAPI } from './binance-ext/throttled-binance-api';
import { StakingAccountAssetResponse, StakingAccountAssetRow } from './binance-ext/simple-earn-api';
import { Order, OrderType } from 'binance-api-node';

type FlexibleProduct = {
    asset: string,
    latestAnnualPercentageRate: string,
    canPurchase: boolean,
    canRedeem: boolean,
    isSoldOut: boolean,
    hot: boolean,
    minPurchaseAmount: string,
    productId: string,
    subscriptionStartTime: number,
    status: 'PURCHASING' | 'REDEEMING' | 'SOLD_OUT' // | ... | -\_(ツ)_/-
};

export async function findFlexibleProduct(asset: string): Promise<FlexibleProduct | undefined> {

    const cacheKey = `flexible-product-${asset}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const list = await binance.simpleEarn.flexibleList({ asset });

    var products = list.rows.filter(p => p.asset === asset && p.canPurchase && p.canRedeem && !p.isSoldOut)
        .sort((a, b) => parseFloat(b.latestAnnualPercentageRate) - parseFloat(a.latestAnnualPercentageRate));

    if (products.length) {
        return cache.put(cacheKey, products[0], 1000 * 60 * 60);
    }
}

type FlexibleSubscriptionPurchase = {
    purchaseId: number,
    success: boolean
};

async function stakeBNSOL(amount: number): Promise<number> {
    var order: Order | undefined;
    try {
        order = await binance.order({
            type: OrderType.MARKET,
            symbol: 'BNSOLSOL',
            side: 'BUY',
            quantity: amount.toFixed(6)
        });
    } catch (e) {
        addLogMessage(`🚫 ${timestampStr()} FAILED TO STAKE ${amount} SOL`);
        return 0;
    }

    if (order.status !== 'FILLED') {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} Failed to buy ${amount} BNSOL`));
        return 0;
    }

    const executedQty = parseFloat(order.executedQty);

    return await subscribeFlexibleProduct('BNSOL', executedQty);
}

async function redeemBNSOL(amount: number): Promise<number> {
    const accountInfo = await binance.accountInfo();
    const balance = accountInfo.balances.find(b => b.asset === 'BNSOL');
    if (!balance) {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} No BNSOL balance found`));
        return 0;
    }

    var freeBNSOL = parseFloat(balance.free);

    if (freeBNSOL < amount) {
        amount = freeBNSOL + await redeemFlexibleProduct('BNSOL', marketCeil('SOL', amount - freeBNSOL));
    }

    const order = await binance.order({
        type: OrderType.MARKET,
        symbol: 'BNSOLSOL',
        side: 'SELL',
        quantity: formatAssetQuantity('SOL', amount)
    });

    if (order.status !== 'FILLED') {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} Failed to sell ${amount} BNSOL`));
        return 0;
    }

    clearStakingCache('SOL');

    return parseFloat(order.cummulativeQuoteQty);
}

export async function subscribeFlexibleProduct(asset: string, amount: number): Promise<number> {
    if (asset === 'SOL') {
        return stakeBNSOL(amount);
    }

    const product = await findFlexibleProduct(asset);
    if (!product) {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} No flexible product found for ${asset}`));
        return 0;
    }

    const productId = product.productId;

    const response = await binance.simpleEarn.flexibleSubscribe({ productId, amount, autoSubscribe: false }) as FlexibleSubscriptionPurchase;
    if (response.success) {

        addLogMessage(`💰 ${timestampStr()} STAKED ${chalk.yellow(formatAssetQuantity(asset, amount))} ${chalk.whiteBright(asset)}`);

        clearStakingCache(asset);

        return amount;
    } else {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} Failed to stake ${amount} ${asset}`));
        return 0;
    }
}

class StakingAccount {

    private data: { [key: string]: StakingAccountAssetResponse } = {};
    private api: ThrottledBinanceAPI;

    private state: { [key: string]: number } = {};

    constructor(api: ThrottledBinanceAPI) {
        this.api = api;
    }

    async sync(): Promise<void> {
        const data = await this.api.simpleEarn.flexiblePosition({ size: 1000 });
        this.state = {};
        for (const row of data.rows)
        {
            this.state[row.asset] = (this.state[row.asset] || 0) + parseFloat(row.totalAmount);
        }
    }

    async get(asset: string): Promise<number> {
        return this.state[asset] || 0;
    }

    async flexiblePosition(asset?: string, size: number = 100) {
        return this.api.simpleEarn.flexiblePosition({ asset, size });
    }
}

export async function getStakingAccount(asset?: string, size: number = 100): Promise<StakingAccountAssetResponse> {
    const cacheKey = `staking-account-${asset || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const response = await binance.simpleEarn.flexiblePosition(asset ? { asset, size } : { size })

    if (asset === undefined) {
        const perAsset: { [key: string]: StakingAccountAssetRow[] } = {};
        for (const row of response.rows) {
            if (!(row.asset in perAsset)) {
                perAsset[row.asset] = [ row ];
            } else {
                perAsset[row.asset].push(row);
            }
        }
        for (const asset of Object.keys(perAsset)) {
            cache.put(`staking-account-${asset}`, { rows: perAsset[asset] }, 1000 * 60 * 60);
        }
    }

    return cache.put(cacheKey, response);
}

async function getStakedBNSOL(): Promise<number> {
    const stakedInfo = await getStakingAccount('BNSOL');
    if (!stakedInfo) {
        return 0;
    }
    const staked = stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0);
    const nonstaked = state.balances['BNSOL'] || 0;
    return staked + nonstaked;
}

export async function getStakedAssets(): Promise<string[]> {
    const account = await getStakingAccount();
    if (!account) {
        addLogMessage(chalk.red('No staking account found'));
        return [];
    }
    return account.rows.map(r => r.asset);
}

export async function getStakedQuantity(asset: string): Promise<number> {
    const cacheKey = `staked-${asset}`;
    const cached = cache.get(cacheKey);
    if (typeof cached === 'number') {
        return cached;
    }

    if (asset === 'SOL') {
        return getStakedBNSOL();
    }

    const stakedInfo = await getStakingAccount(asset);
    if (!stakedInfo) {
        addLogMessage(chalk.red(`No staked info found for ${asset}`));
        return 0;
    }

    return cache.put(cacheKey, stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0));
}

type RedeemResponse = {
    redeemId: number,
    success: boolean
};

// returns the amount left to redeem (unredeemed amount)
// should be 0 if everything went well
export async function redeemFlexibleProduct(asset: string, amount: number): Promise<number> {
    if (asset === 'SOL') {
        return redeemBNSOL(amount);
    }

    var response: RedeemResponse | undefined;

    const stakedInfo = await getStakingAccount(asset);
    if (!stakedInfo) {
        addLogMessage(chalk.red(`No staked info found for ${asset}`));
        return amount;
    }

    const totalStaked = stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0);

    if (totalStaked < amount) {
        addLogMessage(chalk.red(`Not enough ${asset} staked (${stakedInfo.total} < ${amount})`));
        return amount;
    }

    var leftToRedeem = amount;
    for (const row of stakedInfo.rows) {
        const rowAmount = Math.min(leftToRedeem, parseFloat(row.totalAmount));

        try {
            response = await binance.simpleEarn.flexibleRedeem({ productId: row.productId, amount });
        } catch (e) {
            console.error(chalk.red(`Failed to redeem ${rowAmount} ${asset}:`), e);
            break;
        }

        leftToRedeem -= rowAmount;
        if (leftToRedeem <= 0) {
            break;
        }
    }

    addLogMessage(`💲 ${timestampStr()} UNSTAKED ${chalk.yellow(formatAssetQuantity(asset, amount))} ${chalk.whiteBright(asset)}`);

    clearStakingCache(asset);

    return leftToRedeem;
}

export async function redeemFlexibleProductAll(asset: string): Promise<number> {
    const stakedQuantity = await getStakedQuantity(asset);
    if (stakedQuantity === 0) {
        return 0;
    }
    return await redeemFlexibleProduct(asset, stakedQuantity);
}

export async function subscribeFlexibleProductAllFree(asset: string): Promise<number> {
    const accountInfo = await binance.accountInfo();
    const balance = accountInfo.balances.find(b => b.asset === asset);
    if (!balance) {
        addLogMessage(chalk.red(`No balance found for ${asset}`));
        return 0;
    }

    const amountToStake = parseFloat(balance.free);
    if (amountToStake === 0) {
        return 0;
    }

    return await subscribeFlexibleProduct(asset, amountToStake);
}

export async function getStakingEffectiveAPR(asset: string): Promise<number> {
    if (asset === 'SOL') {
        // asset = 'BNSOL';
        // const account = await binance.stakingSOL.account();
        // const effectiveAPR = parseFloat(account.thirtyDaysProfitInSOL) / 30 * 365 / parseFloat(account.holdingInSOL);
        // return effectiveAPR;
    }
    const cacheKey = `staking-apr-${asset}`;
    const cached = cache.get(cacheKey);
    if (typeof cached === 'number') {
        return cached;
    }

    const stakedInfo = await getStakingAccount(asset);
    if (!stakedInfo) {
        return 0;
    }

    const totalStaked = stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0);
    const totalAPR = stakedInfo.rows.reduce((acc, row) =>
        acc + parseFloat(row.latestAnnualPercentageRate) * parseFloat(row.totalAmount), 0);

    return cache.put(cacheKey, totalStaked ? totalAPR / totalStaked : 0, 1000 * 60 * 60);
}

export async function getStakingEffectiveAPRAverage(): Promise<number> {
    const cacheKey = `staking-apr-all`;
    const cached = cache.get(cacheKey);
    if (typeof cached === 'number') {
        return cached;
    }

    const stakedInfo = await getStakingAccount();
    if (!stakedInfo) {
        return 0;
    }

    const totalStaked = stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0);
    const totalAPR = stakedInfo.rows.reduce((acc, row) =>
        acc + parseFloat(row.latestAnnualPercentageRate) * parseFloat(row.totalAmount), 0);

    return cache.put(cacheKey, totalStaked ? totalAPR / totalStaked : 0, 1000 * 60 * 60);
}

export function clearStakingCache(asset: string): void {
    cache.del(`staked-${asset}`);
    cache.keys().filter(k =>
        k.startsWith(`readProfits-${asset}`) ||
        k.startsWith(`staking-apr-${asset}`) ||
        k.startsWith(`staking-account-${asset}`)
    ).forEach(cache.del);
}