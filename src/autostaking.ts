
import dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import cache from 'memory-cache';

import 'source-map-support/register';
import { log } from './ui';
import { formatAssetQuantity, marketCeilPrice, marketFloor, timestampStr } from './utils';
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
    log(`Converting ${amount} SOL to BNSOL`);
    var order: Order | undefined;
    try {
        order = await binance.order({
            type: OrderType.MARKET,
            symbol: 'BNSOLSOL',
            side: 'BUY',
            quantity: formatAssetQuantity('BNSOL', amount / state.assets['SOL'].price * state.assets['BNSOL'].price)
        });
    } catch (e) {
        log.err(`failed to trade ${amount} SOL->BNSOL:`, e);
        return 0;
    }

    if (order.status !== 'FILLED') {
        log.err(`failed to trade ${amount} SOL->BNSOL: ${order.status}`);
        return 0;
    }

    const executedQty = parseFloat(order.executedQty);

    return await subscribeFlexibleProduct('BNSOL', executedQty);
}

async function redeemBNSOL(amount: number): Promise<number> {
    const accountInfo = await binance.accountInfo();
    const balance = accountInfo.balances.find(b => b.asset === 'BNSOL');
    if (!balance) {
        log.err(`No BNSOL balance found`);
        return 0;
    }

    var freeBNSOL = parseFloat(balance.free);

    if (freeBNSOL < amount) {
        await redeemFlexibleProduct('BNSOL', marketCeilPrice('SOL', amount - freeBNSOL));
    }

    var order;
    try {
        order = await binance.order({
            type: OrderType.MARKET,
            symbol: 'BNSOLSOL',
            side: 'SELL',
            quantity: formatAssetQuantity('BNSOL', amount)
        });
    } catch (e) {
        log.err(`Failed to sell ${amount} BNSOL:`, e);
        return 0;
    }

    if (order.status !== 'FILLED') {
        log.err(`Failed to sell ${amount} BNSOL`);
        return 0;
    }

    clearStakingCache('SOL');

    return parseFloat(order.cummulativeQuoteQty);
}

async function stakeWBETH(amount: number): Promise<number> {
    var order: Order | undefined;
    log('buying WBETH', JSON.stringify({
        type: OrderType.MARKET,
        symbol: 'WBETHETH',
        side: 'BUY',
        quantity: formatAssetQuantity('ETH', amount)
    }));

    try {
        order = await binance.order({
            type: OrderType.MARKET,
            symbol: 'WBETHETH',
            side: 'BUY',
            quantity: formatAssetQuantity('ETH', amount)
        });
    } catch (e) {
        log.err(`FAILED TO STAKE ${amount} ETH:`, e);
        return 0;
    }

    if (order.status !== 'FILLED') {
        log.err(`Failed to buy ${amount} WBETH`);
        return 0;
    }

    const executedQty = parseFloat(order.executedQty);

    return await subscribeFlexibleProduct('WBETH', executedQty);
}

async function redeemWBETH(amount: number): Promise<number> {
    const accountInfo = await binance.accountInfo();
    const balance = accountInfo.balances.find(b => b.asset === 'WBETH');
    if (!balance) {
        log.err(`No WBETH balance found`);
        return 0;
    }

    var freeBNSOL = parseFloat(balance.free);

    if (freeBNSOL < amount) {
        amount = freeBNSOL + await redeemFlexibleProduct('WBETH', marketCeilPrice('ETH', amount - freeBNSOL));
    }

    const order = await binance.order({
        type: OrderType.MARKET,
        symbol: 'WBETHETH',
        side: 'SELL',
        quantity: formatAssetQuantity('ETH', amount)
    });

    if (order.status !== 'FILLED') {
        log.err(`Failed to sell ${amount} WBETH`);
        return 0;
    }

    clearStakingCache('ETH');

    return parseFloat(order.cummulativeQuoteQty);
}

export async function subscribeFlexibleProduct(asset: string, amount: number): Promise<number> {
    if (asset === 'SOL') {
        return stakeBNSOL(amount * (1.0 - 0.00075));
    }
    if (asset === 'ETH') {
        return stakeWBETH(amount);
    }

    const product = await findFlexibleProduct(asset);
    if (!product) {
        log.err(`No flexible product found for ${asset}`);
        return 0;
    }

    const productId = product.productId;

    var response: FlexibleSubscriptionPurchase;
    try {
        response = await binance.simpleEarn.flexibleSubscribe({ productId, amount, autoSubscribe: false }) as FlexibleSubscriptionPurchase;
    } catch (e) {
        log.err(`Failed to stake ${amount} ${asset}:`, e);
        return 0;
    }
    if (response.success) {

        log(`💰 STAKED ${chalk.yellow(formatAssetQuantity(asset, amount))} ${chalk.whiteBright(asset)}`);

        clearStakingCache(asset);
        setTimeout(() => clearStakingCache(asset), 1000); // not sure why it's delayed

        state.wallet.markOutOfDate(asset);

        return amount;
    } else {
        log.err(`Failed to stake ${amount} ${asset}`);
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
    return stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0);
}

export async function getStakedAssets(): Promise<string[]> {
    const account = await getStakingAccount();
    if (!account) {
        log.err('No staking account found');
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
        log.err(`No staked info found for ${asset}`);
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
    if (asset === 'ETH') {
        return redeemWBETH(amount);
    }

    var response: RedeemResponse | undefined;

    const stakedInfo = await getStakingAccount(asset);
    if (!stakedInfo) {
        log.err(`No staked info found for ${asset}`);
        return amount;
    }

    const totalStaked = stakedInfo.rows.reduce((acc, row) => acc + parseFloat(row.totalAmount), 0);

    if (totalStaked < amount) {
        log.err(`Not enough ${asset} staked (${stakedInfo.total} < ${amount})`);
        return amount;
    }

    var leftToRedeem = amount;
    for (const row of stakedInfo.rows) {
        const rowAmount = Math.min(leftToRedeem, parseFloat(row.totalAmount));

        try {
            response = await binance.simpleEarn.flexibleRedeem({ productId: row.productId, amount });
        } catch (e) {
            log.err(`Failed to redeem ${rowAmount} ${asset}:`, e);
            break;
        }

        leftToRedeem -= rowAmount;
        if (leftToRedeem <= 0) {
            break;
        }
    }

    log(`💲 REDEEMED ${chalk.yellow(formatAssetQuantity(asset, amount))} ${chalk.whiteBright(asset)}`);

    clearStakingCache(asset);
    state.wallet.markOutOfDate(asset);

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
        log.err(`No balance found for ${asset}`);
        return 0;
    }

    const amountToStake = parseFloat(balance.free);
    if (amountToStake === 0) {
        return 0;
    }

    const staked = await subscribeFlexibleProduct(asset, amountToStake);
    state.wallet.markOutOfDate(asset);

    return staked;
}

export async function getStakingEffectiveAPR(asset: string): Promise<number> {
    if (asset === 'SOL') {
        return 0.0844;
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
    cache.del(`staking-account-all`);
    cache.del(`staking-account-${asset}`);
    cache.del(`staking-apr-${asset}`);
}

export function clearProfitsCache(asset: string): void {
    cache.keys()
        .filter(k =>
            k.startsWith(`readProfits-${asset}`) ||
            k.startsWith(`readProfits-undefined-`))
        .forEach(cache.del);
        cache.del(`avgBuyPrice-${asset}`);
}
