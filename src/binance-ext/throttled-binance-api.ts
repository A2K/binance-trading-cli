import dotenv from 'dotenv';
dotenv.config();

import Binance, { Account, CandleChartResult, CandlesOptions, ExchangeInfo, ExchangeInfoRateLimit, HttpMethod, MyTrade, NewOrderSpot, Order, RateLimitInterval_LT } from "binance-api-node";
import { RateLimiter, RateLimiterOpts } from "limiter";
import { SimpleEarn } from "./simple-earn-api";
import { addLogMessage } from '../ui';
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
    // addLogMessage(JSON.stringify([...weightCount.entries()]));
}

export class ThrottledBinanceAPI {

    public simpleEarn: SimpleEarn;

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
    }

    async order(options: NewOrderSpot): Promise<Order> {
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
        // https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints#exchange-information
        await Promise.all([this.weightLimiter.removeTokens(20), this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('exchangeInfo', 20);
        return this.api.exchangeInfo(options);
    }

    async candles(options: CandlesOptions): Promise<CandleChartResult[]> {
        // https://developers.binance.com/docs/derivatives/coin-margined-futures/market-data/Kline-Candlestick-Data#api-description
        await Promise.all([ this.weightLimiter.removeTokens(options.limit
            ? (options.limit < 100 ? 1 : (options.limit < 500 ? 2 : 5)) : 5),
            this.countLimiter.removeTokens(1)]);
        COUNT_WEIGHT('candles', 5);
        return this.api.candles(options);
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
}

const binance = new ThrottledBinanceAPI({
    apiKey: process.env.BINANCE_API_KEY as string,
    apiSecret: process.env.BINANCE_API_SECRET as string
});

export default binance;
