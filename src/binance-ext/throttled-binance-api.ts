import dotenv from 'dotenv';
dotenv.config();

import Binance, { Account, CancelOrderOptions, CancelOrderResult, CandleChartResult, CandlesOptions, ExchangeInfo, ExchangeInfoRateLimit, HttpMethod, MyTrade, NewOrderSpot, Order, RateLimitInterval_LT, TimeInForce, WithdrawResponse } from "binance-api-node";
import { RateLimiter, RateLimiterOpts } from "limiter";
import SimpleEarn from "./simple-earn-api";
import StakingSOL from "./staking-sol";
import { log } from '../ui';
import cache from 'memory-cache';

function intervalToMs(interval: RateLimitInterval_LT): number {
    switch (interval) {
        case 'MINUTE': return 1000 * 60;
        case 'DAY': return 1000 * 60 * 60 * 24;
        default: return 1000;
    }
}

function resolveInterval(rateLimit: ExchangeInfoRateLimit): number {
    return rateLimit.intervalNum * intervalToMs(rateLimit.interval);
}

function hasLessTokens(a: RateLimiter, b: RateLimiter): number {
    return a.getTokensRemaining() - b.getTokensRemaining();
}

class CompositeRateLimiter {

    constructor(limits: RateLimiterOpts[]) {
        this.limiters = limits.map(limit => new RateLimiter(limit));
    }

    async removeTokens(weight: number) {
        // remove tokens from limiters sequentially starting from the one with the least tokens
        for (const limiter of this.limiters.sort(hasLessTokens)) {
            await limiter.removeTokens(weight);
        }
    }

    public limiters: RateLimiter[];
}

const weightCount = new Map<string, number>();

function COUNT_WEIGHT(name: string, weight: number) {
    weightCount.set(name, (weightCount.get(name) || 0) + weight);
    // addLogMessage([...weightCount.entries()].map(([name, weight]) => `${name}: ${weight}`).join(', '));
}

type CancelReplaceResponse = { cancelResponse: CancelOrderResult, newOrderResponse: Order };

export class ThrottledBinanceAPI {

    public simpleEarn: SimpleEarn;
    // public stakingSOL: StakingSOL;

    private weightLimiter: CompositeRateLimiter = new CompositeRateLimiter([
        { tokensPerInterval: 6000, interval: 1000 * 60 }
    ]);

    private countLimiter: CompositeRateLimiter = new CompositeRateLimiter([
        { tokensPerInterval: 61000, interval: 1000 * 60 }
    ]);

    private orderRateLimiter: CompositeRateLimiter = new CompositeRateLimiter([
        { tokensPerInterval: 100, interval: 1000 * 10 }, // 100 orders per 10 seconds
        { tokensPerInterval: 1000, interval: 1000 * 100 }, // 1000 orders per 100 seconds
        { tokensPerInterval: 200000, interval: 1000 * 60 * 60 * 24 }, // 200000 orders per 24 hours
    ]);

    private api: import("binance-api-node").Binance;

    get limits() {
        return {
            weight: this.weightLimiter.limiters.map(limiter => ({
                current: limiter.getTokensRemaining(),
                max: limiter.tokenBucket.tokensPerInterval
            })),
            count: this.countLimiter.limiters.map(limiter => ({
                current: limiter.getTokensRemaining(),
                max: limiter.tokenBucket.tokensPerInterval
            })),
            order: this.orderRateLimiter.limiters.map(limiter => ({
                current: limiter.getTokensRemaining(),
                max: limiter.tokenBucket.tokensPerInterval
            })),
        };
    }

    async init() {
        const exchangeInfo = await this.api.exchangeInfo();

        this.weightLimiter = new CompositeRateLimiter(
            exchangeInfo.rateLimits
            .filter(rateLimit => rateLimit.rateLimitType === "REQUEST_WEIGHT")
            .map(rateLimit => ({
                tokensPerInterval: rateLimit.limit,
                interval: resolveInterval(rateLimit)
            }))
        );

        this.countLimiter = new CompositeRateLimiter(
            exchangeInfo.rateLimits
            .filter(rateLimit => (rateLimit.rateLimitType as string) === "RAW_REQUESTS")
            .map(rateLimit => ({
                tokensPerInterval: rateLimit.limit,
                interval: resolveInterval(rateLimit)
            }))
        );

        this.orderRateLimiter = new CompositeRateLimiter(
            exchangeInfo.rateLimits
            .filter(rateLimit => rateLimit.rateLimitType === "ORDERS")
            .map(rateLimit => ({
                tokensPerInterval: rateLimit.limit,
                interval: resolveInterval(rateLimit)
            }))
        );
    }

    get ws() {
        return this.api.ws;
    }

    constructor(options?: { apiKey: string, apiSecret: string }) {
        this.api = Binance(options);
        this.simpleEarn = new SimpleEarn(this);
        // this.stakingSOL = new StakingSOL(this);
    }

    async order(options: {
        symbol: string, // Trading pair (e.g., BTCUSDT)
        side: 'BUY' | 'SELL', // Order side
        type: 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT' | 'LIMIT_MAKER', // Order type
        timeInForce?: 'GTC' | 'IOC' | 'FOK', // Optional: Time in force
        quantity?: string, // Optional: Amount of asset to buy/sell
        quoteOrderQty?: number, // Optional: Quote asset amount to spend
        price?: string, // Optional: Price for LIMIT orders
        newClientOrderId?: string, // Optional: Unique ID for the order
        strategyId?: number, // Optional: Strategy identifier
        strategyType?: number, // Optional: Strategy type (>= 1000000)
        stopPrice?: string, // Optional: Stop price for stop and take-profit orders
        trailingDelta?: number, // Optional: Trailing delta for stop and take-profit orders
        icebergQty?: number, // Optional: Iceberg order quantity
        newOrderRespType?: 'ACK' | 'RESULT' | 'FULL', // Optional: Response type
        selfTradePreventionMode?: 'STP_MODE_1' | 'STP_MODE_2' | 'STP_MODE_3', // Optional: Self-trade prevention mode
        recvWindow?: number // Optional: Receive window (<= 60000)
    }) {
        await Promise.all([
            this.orderRateLimiter.removeTokens(1),
            this.weightLimiter.removeTokens(2),
            this.countLimiter.removeTokens(1)
        ]);
        const response = await this.api.privateRequest('POST' as HttpMethod, '/api/v3/order', options);
        return response as Order;
    }

    async _order(options: NewOrderSpot): Promise<Order> {
        log('order', JSON.stringify(options));

        await Promise.all([
            this.orderRateLimiter.removeTokens(1),
            this.weightLimiter.removeTokens(2),
            this.countLimiter.removeTokens(1)
        ]);
        COUNT_WEIGHT('order', 2);
        return this.api.order(options);
    }

    async myTrades(options: {
        symbol: string
        orderId?: number
        startTime?: number
        endTime?: number
        fromId?: number
        limit?: number
        recvWindow?: number
        useServerTime?: boolean
    }): Promise<MyTrade[]> {
        // https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints#account-trade-list-user_data
        await Promise.all([this.weightLimiter.removeTokens(20), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('myTrades', 20);
        return this.api.myTrades(options);
    }

    async accountInfo(options?: { useServerTime: boolean }): Promise<Account> {
        const cacheKey = '___accountInfo__useServerTime_' + options?.useServerTime;
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        // https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints#account-information-user_data
        await Promise.all([this.weightLimiter.removeTokens(20), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('accountInfo', 20);
        return cache.put(cacheKey, this.api.accountInfo(options), 100);
    }

    async exchangeInfo(options?: { symbol: string }): Promise<ExchangeInfo> {
        const cacheKey = '___exchangeInfo__symbol_' + options?.symbol;
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        // https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints#exchange-information
        await Promise.all([this.weightLimiter.removeTokens(20), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('exchangeInfo', 20);
        return cache.put(cacheKey, this.api.exchangeInfo(options), 100);
    }

    async candles(options: CandlesOptions): Promise<CandleChartResult[]> {
        const cacheKey = '___candles__' + JSON.stringify(options);
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        // https://developers.binance.com/docs/derivatives/coin-margined-futures/market-data/Kline-Candlestick-Data#api-description
        await Promise.all([ this.weightLimiter.removeTokens(options.limit
            ? (options.limit < 100 ? 1 : (options.limit < 500 ? 2 : 5)) : 5),
            this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('candles', 5);
        return cache.put(cacheKey, this.api.candles(options), 1000);
    }

    async privateRequest(method: HttpMethod, path: string, data: any, weight: number): Promise<unknown> {
        await Promise.all([this.weightLimiter.removeTokens(weight), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT(path, weight);
        return this.api.privateRequest(method, path, Object.assign(data, { timestamp: Date.now() }));
    }

    async publicRequest(method: HttpMethod, path: string, data: any, weight: number): Promise<unknown> {
        await Promise.all([this.weightLimiter.removeTokens(weight), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT(path, weight);
        return this.api.publicRequest(method, path, Object.assign(data, { timestamp: Date.now() }));
    }

    async getOrder(symbol: string, orderId: number): Promise<Order> {
        const weight = 1;
        COUNT_WEIGHT('getOrder', weight);
        return this.api.getOrder({ symbol, orderId });
    }

    get canStakeOrRedeem(): boolean {
        return this.simpleEarn.__flexibleRateLimiter.getTokensRemaining() >= 1
            && this.weightLimiter.limiters[0].getTokensRemaining() >= 300;
    }

    async withdraw(options: {
        coin: string
        network?: string
        address: string
        amount: number
        name?: string
        transactionFeeFlag?: boolean,
        walletType?: number
    }): Promise<WithdrawResponse> {
        const weight = 600;
        await Promise.all([this.weightLimiter.removeTokens(weight), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('withdraw', weight);
        return this.api.withdraw(options);
    }

    async cancelOrder(options: CancelOrderOptions): Promise<CancelOrderResult> {
        COUNT_WEIGHT('cancelOrder', 1);
        return this.api.cancelOrder(options);
    }

    async cancelReplace(options: {
        symbol: string,
        side: string,
        type: string,
        cancelReplaceMode: CancelReplaceMode,
        timeInForce?: TimeInForce,
        quantity?: string,
        quoteOrderQty?: string,
        price?: string,
        cancelNewClientOrderId?: string,
        cancelOrigClientOrderId?: string,
        cancelOrderId?: number,
        newClientOrderId?: number,
        strategyId?: number,
        strategyType?: number,
        stopPrice?: string,
        trailingDelta?: number,
        icebergQty?: number,
        newOrderRespType?: NewOrderRespType,
        selfTradePreventionMode?: string,
        cancelRestrictions?: string,
        orderRateLimitExceededMode?: string,
        recvWindow?: number,
        timestamp?: number,
    }): Promise<Order> {
        COUNT_WEIGHT('cancelReplace', 1);
        const response = await this.api.privateRequest('POST' as HttpMethod, '/api/v3/order/cancelReplace', Object.assign(options, { timestamp: Date.now() })) as CancelReplaceResponse;
        return response.newOrderResponse;
    }

    async prices(options?: { symbol?: string }): Promise<{ [index: string]: string }> {
        return this.api.prices(options);
    }

    // async limits(options) {
    //     const response = this.privateRequest('GET', '/api/v3/rateLimit/order', options, 40);
    // }
}

const binance = new ThrottledBinanceAPI({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

export default binance;

type CancelReplaceMode = 'STOP_ON_FAILURE' | 'ALLOW_FAILURE';
type NewOrderRespType = 'ACK' | 'RESULT' | 'FULL';
