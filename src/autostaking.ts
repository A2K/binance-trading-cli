import Binance, { CandleChartInterval_LT, HttpMethod, Order, OrderType } from 'binance-api-node';
import dotenv from 'dotenv';
import chalk from 'chalk';
import cache from 'memory-cache';

import 'source-map-support/register';
import { RateLimiter } from 'limiter';
import { addLogMessage } from './ui';
import { DelayedExecution, formatAssetQuantity, marketCeil, timestampStr } from './utils';
import state from './state';

dotenv.config();

const binance = Binance({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

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

    var response: unknown;

    try {
        await __stakingRateLimiter.removeTokens(1);
        response = await binance.privateRequest(
            'GET' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/list',
            { asset });
    } catch (e) {
        return undefined;
    }

    if (!response) {
        return undefined;
    }

    var products = response['rows' as keyof unknown] as FlexibleProduct[];

    products = products.filter(p => p.asset === asset && p.canPurchase && p.canRedeem && !p.isSoldOut)
        .sort((a, b) => parseFloat(b.latestAnnualPercentageRate) - parseFloat(a.latestAnnualPercentageRate));

    if (products.length) {
        return cache.put(cacheKey, products[0], 1000 * 60 * 60);
    }
}

type FlexibleSubscriptionPurchase = {
    purchaseId: number,
    success: boolean
};

async function stakeBNSOL(amount: number): Promise<FlexibleSubscriptionPurchase | undefined> {
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
        return undefined;
    }

    if (order.status !== 'FILLED') {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} Failed to buy ${amount} BNSOL`));
        return undefined;
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

    const freeBNSOL = parseFloat(balance.free);

    if (freeBNSOL < amount) {
        await redeemFlexibleProduct('BNSOL', marketCeil('SOL', amount - freeBNSOL));
    }

    const order = await binance.order({
        type: OrderType.MARKET,
        symbol: 'BNSOLSOL',
        side: 'SELL',
        quantity: amount.toFixed(6)
    });

    if (order.status !== 'FILLED') {
        addLogMessage(chalk.red(`🚫 ${timestampStr()} Failed to sell ${amount} BNSOL`));
        return 0;
    }

    return parseFloat(order.cummulativeQuoteQty);
}

export async function subscribeFlexibleProduct(asset: string, amount: number): Promise<FlexibleSubscriptionPurchase | undefined> {
    if (asset === 'SOL') {
        return stakeBNSOL(amount);
    }

    var response: unknown;
    const autoSubscribe: boolean = false;

    try {
        const product = await findFlexibleProduct(asset);
        if (!product) {
            addLogMessage(chalk.red(`🚫 ${timestampStr()} No flexible product found for ${asset}`));
            return undefined;
        }
        const productId = product.productId;
        await __stakingRateLimiter.removeTokens(1);
        const timestamp = Date.now();
        response = await binance.privateRequest(
            'POST' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/subscribe',
            { productId, amount, autoSubscribe, timestamp });
    } catch (e) {
        console.error(e);
        return undefined;
    }

    addLogMessage(`💰 ${timestampStr()} STAKED ${chalk.yellow(formatAssetQuantity(asset, amount))} ${chalk.whiteBright(asset)}`);

    cache.del(`staked-${asset}`);
    cache.del(`staking-account-${asset}`);
    cache.del(`staking-account-all`);

    return response as FlexibleSubscriptionPurchase;
}

type StakingAccountAssetRow = {
    totalAmount: string,
    latestAnnualPercentageRate: string,
    asset: string,
    canRedeem: boolean,
    collateralAmount: string,
    productId: string,
    yesterdayRealTimeRewards: string,
    cumulativeBonusRewards: string,
    cumulativeRealTimeRewards: string,
    cumulativeTotalRewards: string,
    autoSubscribe: boolean
};

type StakingAccountAssetResponse = {
    total: number,
    rows: StakingAccountAssetRow[]
};

const __stakingRateLimiter = new RateLimiter({ tokensPerInterval: 1, interval: 100 });
export async function getStakingAccount(asset: string | undefined = undefined): Promise<StakingAccountAssetResponse | undefined> {
    const cacheKey = `staking-account-${asset || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    var response: unknown;

    try {
        await __stakingRateLimiter.removeTokens(1);
        const timestamp = Date.now();
        response = await binance.privateRequest(
            'GET' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/position',
            asset ? { asset, timestamp } : { timestamp, size: 100 });
    } catch (e) {
        console.error(e);
        return undefined;
    }

    return cache.put(cacheKey, response as StakingAccountAssetResponse, 1000 * 60 * 5);
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
            await __stakingRateLimiter.removeTokens(1);
            const timestamp = Date.now();
            const productId = row.productId;
            response = await binance.privateRequest(
                'POST' as HttpMethod,
                '/sapi/v1/simple-earn/flexible/redeem',
                { productId, asset, timestamp, amount: rowAmount }) as RedeemResponse;
        } catch (e) {
            console.error(chalk.red(`Failed to redeem ${rowAmount} ${asset}:`), e);
            return leftToRedeem;
        }

        leftToRedeem -= rowAmount;
        if (leftToRedeem <= 0) {
            break;
        }
    }

    addLogMessage(`💲 ${timestampStr()} UNSTAKED ${chalk.yellow(formatAssetQuantity(asset, amount))} ${chalk.whiteBright(asset)}`);

    cache.del(`staked-${asset}`);
    cache.del(`staking-account-${asset}`);
    cache.del(`staking-account-all`);

    return leftToRedeem;
}

export async function redeemFlexibleProductAll(asset: string): Promise<number> {
    const stakedQuantity = await getStakedQuantity(asset);
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

    const purchase = await subscribeFlexibleProduct(asset, amountToStake);
    if (!purchase || !purchase.success) {
        addLogMessage(chalk.red(`Failed to stake ${asset}`));
        return 0;
    }

    return amountToStake;
}
