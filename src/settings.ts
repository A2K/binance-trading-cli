import fs from 'fs';
import { DelayedExecution } from './utils';

export type ConfigFile =
    'settings' |
    'thresholds' |
    'enabledBuys' |
    'enabledSells' |
    'maxDailyLosses' |
    'interpSpeeds' |
    'currencies' |
    'staking';

export function getConfig(configFile: ConfigFile, defaultValue: any = {}) {
    try {
        return require(`./config/${configFile}.json`);
    } catch (e) {
        return defaultValue;
    }
}

const __saveDelays: { [key: string]: DelayedExecution } = {};
export function saveConfigFile(configFile: ConfigFile, value: any) {
    fs.existsSync('./config') || fs.mkdirSync('./config');
    (__saveDelays[configFile] || (__saveDelays[configFile] = new DelayedExecution(100, () => {
        fs.writeFileSync(`./config/${configFile}.json`, JSON.stringify(value, null, 4));
    }))).execute();
}

type StableCoin = 'USDC' | 'USDT';

type SettingsType = {
    buyThreshold: number,
    sellThreshold: number,
    maxDailyLoss: number,
    interpSpeed: number,
    enableTradeByDefault: boolean,
    enableInputLogging: boolean,
    showTime: boolean,
    stableCoins: StableCoin[]
    stableCoin: StableCoin
};

export const Settings: SettingsType = getConfig('settings', {
    buyThreshold: 35,
    sellThreshold: 25,
    maxDailyLoss: 0,
    interpSpeed: 0.00003125,
    enableTradeByDefault: false,
    enableInputLogging: false,
    showTime: false,
    stableCoins: [ 'USDT', 'USDC' ],
    stableCoin: 'USDT' as StableCoin // Default stable coin
});

export const thresholds: {
    buy: { [key: string]: number },
    sell: { [key: string]: number }
} = getConfig('thresholds', {
    buy: {},
    sell: {}
});

export const enabledBuys: {[key: string]: boolean} = getConfig('enabledBuys');
export const enabledSells: {[key:string]: boolean} = getConfig('enabledSells');
export const maxDailyLosses: {[key: string]: number} = getConfig('maxDailyLosses');
export const interpSpeeds: {[key: string]: number} = getConfig('interpSpeeds');

export default Settings;

export var enableSell: boolean = false;
export var enableBuy: boolean = false;
