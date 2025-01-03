import { HttpMethod } from "binance-api-node";
import { ThrottledBinanceAPI } from "./throttled-binance-api";

interface AccountResponse {
    bnsolAmount: string,
    holdingInSOL: string,
    thirtyDaysProfitInSOL: string,
}

interface StakeResponse {
    success: boolean,
    bnsolAmount: string,
    exchangeRate: string,
}

interface RedeemResponse {
    success: boolean,
    solAmount: string,
    exchangeRate: string,
    arrivalTime: number
}

interface RateHistoryResponse {
    total: number;
    rows: {
        annualPercentageRate: string;  //BNSOL APR
        exchangeRate: string;  // SOL amount per 1 BNSOL
        boostRewards: {
            boostAPR: string;
            rewardsAsset: string;
        }[];
        time: number;
    }[];
}

export class StakingSOL {

    private binance: ThrottledBinanceAPI;

    constructor(binance: ThrottledBinanceAPI) {
        this.binance = binance;
    }

    async account(options: { recvWindow?: number } = {}): Promise<AccountResponse> {
        return (await this.binance.privateRequest('GET' as HttpMethod, '/sapi/v1/sol-staking/account', options, 150)) as AccountResponse;
    }

    async stake(options: {amount: number, recvWindow?:number}): Promise<StakeResponse> {
        return (await this.binance.privateRequest('POST' as HttpMethod, '/sapi/v1/sol-staking/sol/stake', options, 150)) as StakeResponse;
    }

    async redeem(options: {amount: number, recvWindow?:number}): Promise<RedeemResponse> {
        return (await this.binance.privateRequest('POST' as HttpMethod, '/sapi/v1/sol-staking/sol/redeem', options, 150)) as RedeemResponse;
    }

    async rateHistory(options: {
        startTime?: number,
        endTime?: number,
        current?: number,
        size?: number,
        recvWindow?: number
    } = {}): Promise<RateHistoryResponse> {
        return await this.binance.privateRequest('GET' as HttpMethod, '/sapi/v1/sol-staking/sol/history/rateHistory', options, 150) as RateHistoryResponse;
    }

}

export default StakingSOL;