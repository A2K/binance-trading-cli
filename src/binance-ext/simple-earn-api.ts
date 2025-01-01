import { HttpMethod } from "binance-api-node";
import { ThrottledBinanceAPI } from "./throttled-binance-api";

export type FlexibleProduct = {
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

export type FlexibleProductListResponse = {
    total: number,
    rows: FlexibleProduct[]
};

export type RedeemResponse = {
    redeemId: number,
    success: boolean
};

export type StakingAccountAssetRow = {
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

export type StakingAccountAssetResponse = {
    total: number,
    rows: StakingAccountAssetRow[]
};

export type FlexibleSubscriptionPurchase = {
    purchaseId: number,
    success: boolean
};

export class SimpleEarn {

    private binance: ThrottledBinanceAPI;

    constructor(binance: ThrottledBinanceAPI) {
        this.binance = binance;
    }

    private promises: {
        list: { [key: string]: Promise<FlexibleProductListResponse> },
        position: { [key: string]: Promise<StakingAccountAssetResponse> }
    } = { list: {}, position: {} };

    async flexibleList(options: { asset?: string, current?: number, size?: number, recvWindow?: number }): Promise<FlexibleProductListResponse> {
        const key = JSON.stringify(options);

        const ongoing = this.promises.list[key];
        if (ongoing) {
            return await ongoing;
        }
        const weight = 150;

        const result = await (this.promises.list[key] = this.binance.privateRequest(
            'GET' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/list',
            options, weight) as Promise<FlexibleProductListResponse>);

        delete this.promises.list[key];
        return result;
    }

    async flexibleSubscribe(options: { productId: string, amount: number, autoSubscribe?: boolean, sourceAccount?: string, recvWindow?: number }): Promise<FlexibleSubscriptionPurchase> {
        const weight = 1;
        return await this.binance.privateRequest(
            'POST' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/subscribe',
            options, weight) as FlexibleSubscriptionPurchase;
    }

    async flexibleRedeem(options: { productId: string, redeemAll?: boolean, amount?: number, destAccount?: string, recvWindow?: number }): Promise<RedeemResponse> {
        const weight = 1;
        return await this.binance.privateRequest(
            'POST' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/redeem',
            options, weight) as RedeemResponse;
    }

    async flexiblePosition(options: { asset?: string, productId?: string, current?: number, size?: number, recvWindow?: number } = {}) {
        const key = JSON.stringify(options);
        const ongoing = this.promises.position[key];
        if (ongoing) {
            return await ongoing;
        }
        const weight = 150;
        const result = await (this.promises.position[key] = this.binance.privateRequest(
            'GET' as HttpMethod,
            '/sapi/v1/simple-earn/flexible/position',
            options, weight) as Promise<StakingAccountAssetResponse>);
        delete this.promises.position[key];
        return result;
    }
}

export default SimpleEarn;