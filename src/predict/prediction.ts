import * as brain from 'brain.js';
import { INeuralNetworkData, INeuralNetworkOptions, INeuralNetworkTrainOptions } from 'brain.js/dist/neural-network';
import ccxt from 'ccxt';
import fs from 'fs';
import 'source-map-support/register';

const SCALE = 1000000;
const HIST = 30;
const INTERVAL = '1m';

// provide optional config object (or undefined). Defaults shown.
const config: Partial<INeuralNetworkOptions & INeuralNetworkTrainOptions> = {
    // hiddenLayers: [1000], // array of ints for the sizes of the hidden layers in the network
    hiddenLayers: [1000], // array of ints for the sizes of the hidden layers in the network
    // hiddenLayers: [7, 5], // array of ints for the sizes of the hidden layers in the network
    activation: 'leaky-relu', // supported activation types: ['sigmoid', 'relu', 'leaky-relu', 'tanh'],
    // leakyReluAlpha: 0.5, // supported for activation type 'leaky-relu'
    inputSize: 9 + 9 * HIST, // input size of one set of data
    outputSize: 1, // output size of one set of data,
    binaryThresh: 0.5, // ¯\_(ツ)_/¯
    errorThresh: 0.0000001, // the acceptable error percentage from training data
};
const config2: Partial<INeuralNetworkOptions & INeuralNetworkTrainOptions> = {
    // hiddenLayers: [1000], // array of ints for the sizes of the hidden layers in the network
    // hiddenLayers: [11], // array of ints for the sizes of the hidden layers in the network
    hiddenLayers: [3], // array of ints for the sizes of the hidden layers in the network
    activation: 'leaky-relu', // supported activation types: ['sigmoid', 'relu', 'leaky-relu', 'tanh'],
    // leakyReluAlpha: 0.5, // supported for activation type 'leaky-relu'
    inputSize: (config.inputSize || (9 + 9 * HIST)) + 1, // input size of one set of data
    outputSize: 5, // output size of one set of data,
    binaryThresh: 0.5, // ¯\_(ツ)_/¯
    errorThresh: 0.0000001, // the acceptable error percentage from training data
};
const trainConfig: Partial<INeuralNetworkTrainOptions> = {
    iterations: 100,
    log: true,
    logPeriod: 1,
    errorThresh: config.errorThresh
};

import { ema, rsi, stochasticrsi, sma } from 'trading-indicator';
import { OHLCV } from '../indicators';
import { Candle, renderCandles } from '../candles';
import chalk from 'chalk';
import { clamp } from '../utils';
import { refreshMaterializedViews } from '../transactions';

// create a simple feed-forward neural network with backpropagation
async function main() {
    await refreshMaterializedViews();
    process.exit(0);
    // const net = new brain.NeuralNetwork(config);
    const net = new brain.NeuralNetwork(config);
    const net2 = new brain.NeuralNetwork(config2);
    const binance = new ccxt.binance();
    const data = await binance.fetchOHLCV('BTC/USDT', INTERVAL, undefined, 1000);

    console.log(data.length);
    const OHLCVData: OHLCV = {
        open: data.map(i => i[1]),
        high: data.map(i => i[2]),
        low: data.map(i => i[3]),
        close: data.map(i => i[4]),
        volume: data.map(i => i[5]),
        time: data.map(i => i[0]),
    }

    var emaData: number[] = await ema(10, 'close', OHLCVData);
    var rsiData: number[] = await rsi(10, 'close', OHLCVData);
    var strsiData: number[] = await stochasticrsi(10, 8, 8, 8, 'close', OHLCVData);
    var smaData: number[] = await sma(10, 'close', OHLCVData);

    const makeInput = (i: number): number[] => {
        const writeIndex1 = (n: number) => [
            clamp((emaData[emaData.length - (data.length - n)] - data[n][1]) / data[n][1]) || 0,
            clamp(rsiData[rsiData.length - (data.length - n)] / 100) || 0.5,
            clamp(strsiData[strsiData.length - (data.length - n)] / 100) || 0.5,
            clamp((smaData[smaData.length - (data.length - n)] - data[n][1]) / data[n][1]) || 0,
            ...(data[n].slice(1).map((nn: number) => clamp(nn / SCALE || 0)))
        ]
        const writeIndex2 = (n: number) => [
            clamp((emaData[emaData.length - (data.length - n)] - data[n][1]) / data[n][1]) || 0,
            clamp(rsiData[rsiData.length - (data.length - n)] / 100) || 0.5,
            clamp(strsiData[strsiData.length - (data.length - n)] / 100) || 0.5,
            clamp((smaData[smaData.length - (data.length - n)] - data[n][1]) / data[n][1]) || 0,
            ...(data[n].slice(1).map((nn: number) => clamp(nn / SCALE || 0)))
            // (data[n][1] + data[n][4]) / 2 / SCALE || 0
            // ...data[i].slice(1).map((n: number) => clamp(n / SCALE || 0))
        ]
        var input: number[] = writeIndex1(i);
        for(var ii = i - 1; ii >= Math.max(i - HIST, 0); --ii) {
            input.push(...writeIndex1(ii));
        }
        return input;
    }

    const makeInputOutput = (ohclv: ccxt.OHLCV, i: number): { input: number[], output: number[] } => {
        return {
            input: makeInput(i),
            output: [ohclv[1] / SCALE || 0]
        }
    }
    const makeInputOutput2 = (ohclv: ccxt.OHLCV, i: number, price: number): { input: number[], output: number[] } => {
        return {
            input: makeInput(i).concat([price / SCALE || 0]),
            output: [...ohclv.slice(1).map(x=> x / SCALE || 0)]
        }
    }

    if (fs.existsSync('network.json')) {
        console.log('loading network from network.json');
        net.fromJSON(JSON.parse(fs.readFileSync('network.json').toString()));
        net2.fromJSON(JSON.parse(fs.readFileSync('network2.json').toString()));
    } else {

        console.log('generate training data');
        const trainSet = data.slice(HIST, -1).map((x, i) => makeInputOutput(data[i+1], i + HIST));
        const trainSet2 = data.slice(HIST, -1).map((x, i) => makeInputOutput2(data[i+1], i + HIST, data[i+1][1]));

        console.log('training');
        console.log(trainSet)
        net.train(trainSet, trainConfig);
        net2.train(trainSet2, trainConfig);
        console.log('training done, saving network to network.json');
        fs.writeFileSync('network.json', JSON.stringify(net.toJSON()));
        fs.writeFileSync('network2.json', JSON.stringify(net2.toJSON()));
        console.log('network saved');
    }
    const candlesHeight = 30;

    const c1 = renderCandles(data.slice(-120).map(d => new Candle({
        openTime: d[0],
        open: d[1].toFixed(8),
        high: d[2].toFixed(8),
        low: d[3].toFixed(8),
        close: d[4].toFixed(8),
        volume: d[5].toFixed(8),
        closeTime: d[0] + 3600000,
        baseAssetVolume: d[5].toFixed(8),
        quoteAssetVolume: '0',
        trades: 0,
        quoteVolume: d[5].toFixed(8)
    })), candlesHeight);

    const numPredicted = 48;
    for (var i = 0; i < numPredicted; ++i) {
        const timeStepMs = ((intrvl: string) => {
            switch (intrvl) {
                case '1m': return 60000;
                case '5m': return 300000;
                case '15m': return 900000;
                case '30m': return 1800000;
                case '1h': return 3600000;
                case '2h': return 7200000;
                case '4h': return 14400000;
                case '6h': return 21600000;
                case '8h': return 28800000;
                case '12h': return 43200000;
                case '1d': return 86400000;
                case '3d': return 259200000;
                case '1w': return 604800000;
                case '1M': return 2592000000;
                case '1y': return 31536000000;
                default: return 0;
            }
        })(INTERVAL);
        const time = new Date(data[data.length - 1][0] + timeStepMs).getTime();

        const input = makeInput(data.length - 1);
        var output: number[] = net.run(input) as number[];
        const input2 = [...input, output[0]];
        // console.log('input2:', input2);
        var output2 = net2.run(input2) as number[];
        output2[0] = output[0];
        // output2[2] = Math.max(output[0], output2[2]);
        // output2[3] = Math.min(output[0], output2[3]);
        output2[1] = Math.max(output2[3], Math.max(output2[0], output2[1]));
        output2[2] = Math.min(output2[3], Math.min(output2[0], output2[2]));
        // var result = (output2 as number[]).map(q => q * SCALE);
        var result = [ output[0] * SCALE, output[0] * SCALE, output[0] * SCALE, input[4] * SCALE, output[0] * SCALE]

        // console.log('result:',result);

        // data.push([time, ...result] as [number, number, number, number, number, number]);
        data.push([time, ...result] as [number, number, number, number, number, number]);

        OHLCVData.time.push(time);
        OHLCVData.open.push(result[0]);
        OHLCVData.high.push(result[1]);
        OHLCVData.low.push(result[2]);
        OHLCVData.close.push(result[3]);
        OHLCVData.volume.push(result[4]);

        emaData = await ema(8, 'close', OHLCVData);
        rsiData = await rsi(8, 'close', OHLCVData);
        strsiData = await stochasticrsi(10, 8, 8, 8, 'close', OHLCVData);
        smaData = await sma(8, 'close', OHLCVData);
    }

    const c2 = renderCandles(data.slice(-numPredicted).map(d => new Candle({
        openTime: d[0],
        open: d[1].toFixed(8),
        high: d[2].toFixed(8),
        low: d[3].toFixed(8),
        close: d[4].toFixed(8),
        volume: d[5].toFixed(8),
        closeTime: d[0] + 3600000,
        baseAssetVolume: d[5].toFixed(8),
        quoteAssetVolume: '0',
        trades: 0,
        quoteVolume: d[5].toFixed(8)
    })), candlesHeight);

    c1.rows.map((row, i) =>
        process.stdout.write(
            `${chalk.bgRgb(64, 64, 64)(row)}${chalk.bgRgb(64, 128, 64)(c2.rows[i])}\n`
        ));
}

main();