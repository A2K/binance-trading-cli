import readline from 'readline';
import chalk from 'chalk';
import Fuse from 'fuse.js';
import Settings, { saveConfigFile } from './settings';
import { addLogMessage, drawCandles, printStats, printSymbol, printTrades, printTransactions } from './ui';
import state from './state';
import { redeemFlexibleProductAll, subscribeFlexibleProductAllFree } from './autostaking';

var lookupStr = '';
var lookupClearTimeout: NodeJS.Timer | undefined;

function addLookupChar(charStr: string) {
    lookupStr += charStr;
    if (lookupClearTimeout) {
        clearTimeout(lookupClearTimeout);
    }
    setTimeout(() => {
        lookupStr = '';
    }, 1000);

    const curFuzzySearch = new Fuse(Object.keys(state.currencies).sort());
    const fuzzyResult = curFuzzySearch.search(lookupStr);
    if (fuzzyResult) {
        const bestMatch = fuzzyResult[0];
        if (bestMatch)
        {
            state.selectedRow = bestMatch.refIndex;
            printSymbol(Object.keys(state.currencies).sort()[bestMatch.refIndex]);
        }
    }
}

export default function registerInputHandlers() {

    const stdin = process.stdin;

    if (stdin.setRawMode) {
        stdin.setRawMode(true);
    }

    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', function (key: string) {
        if (key === '\u0003') {
            process.exit();
        }

        const lastSelectedRow: number = state.selectedRow;

        let code: number[] = [];
        for (let i = 0; i < key.length; i++) {
            code.push(key.charCodeAt(i));
        }

        const cmp = (code: number[], arr: number[]) => {
            if (code.length !== arr.length) {
                return false;
            }
            for (let i = 0; i < code.length; i++) {
                if (code[i] !== arr[i]) {
                    return false;
                }
            }
            return true;
        }
        if (cmp(code, [27, 91, 49, 56, 126])) { // F7 - stake all (all assets)
            for (const asset of Object.keys(state.currencies)) {
                subscribeFlexibleProductAllFree(asset);
            }
        }
        if (cmp(code, [27, 91, 49, 57, 126])) { // F8 - stake all (selected asset)
            if (state.selectedRow >= 0) {
                const asset: string = Object.keys(state.currencies).sort()[state.selectedRow];
                subscribeFlexibleProductAllFree(asset);
            }
        }

        if (cmp(code, [27, 91, 50, 48, 126])) { // F9 - unstake all
            if (state.selectedRow >= 0) {
                const asset: string = Object.keys(state.currencies).sort()[state.selectedRow];
                redeemFlexibleProductAll(asset);
            }
        }
        if (cmp(code, [27, 91, 49, 55, 126])) { // F6 - toggle staking
            if (state.selectedRow >= 0) {
                const asset: string = Object.keys(state.currencies).sort()[state.selectedRow];
                state.assets[asset].staking = !state.assets[asset].staking;
            }
        }
        if (code.length >= 3 && code[0] === 27 && code[1] === 91) {
            if (state.selectedRow >= 0) {
                readline.cursorTo(process.stdout, 0, state.selectedRow);
                if (state.assets[Object.keys(state.currencies).sort()[state.selectedRow]]) {
                    process.stdout.write(state.assets[Object.keys(state.currencies).sort()[state.selectedRow]].statusLine + '');
                }
            }

            if (code[2] === 65) {
                lookupStr = '';
                if (state.selectedRow == -1) {
                    state.selectedRow = Object.keys(state.currencies).length - 1;
                } else {
                    state.selectedRow = Math.max(-1, state.selectedRow - 1);
                }
            } else if (code[2] === 66) {
                lookupStr = '';
                if (state.selectedRow == Object.keys(state.currencies).length - 1) {
                    state.selectedRow = -1;
                } else {
                    state.selectedRow = Math.min(Object.keys(state.currencies).length - 1, state.selectedRow + 1);
                }
            } else if (code[2] === 67) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    if ((state.currencies[symbol] % state.steps[state.step]) > 1) {
                        state.currencies[symbol] += state.steps[state.step] - state.currencies[symbol] % state.steps[state.step]
                    } else {
                        state.currencies[symbol] = Math.round((state.currencies[symbol] + state.steps[state.step]) / state.steps[state.step]) * state.steps[state.step];
                    }
                    printSymbol(symbol);
                }
                saveConfigFile('currencies', state.currencies);
            } else if (code[2] === 68) {
                if (state.selectedRow >= 0) {
                    if ((state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] % state.steps[state.step]) > 1) {
                        state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] -= state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] % state.steps[state.step]
                    } else {
                        state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] =
                            Math.round((state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] - state.steps[state.step]) / state.steps[state.step]) * state.steps[state.step];
                    }
                }
                saveConfigFile('currencies', state.currencies);
            } else if (code[2] === 53) {
                state.step = Math.min(state.step + 1, state.steps.length - 1);
            } else if (code[2] === 54) {
                state.step = Math.max(state.step - 1, 0);
            } else if (cmp([27, 91, 49, 126], code)) { // HOME
                lookupStr = '';
                state.selectedRow = 0;
            } else if (code[2] === 52) {
                state.selectedRow = Object.keys(state.currencies).length - 1;
                lookupStr = '';
            } else if (code[2] === 91) {
                if (code[3] === 65) {
                    if (state.selectedRow >= 0) {
                        const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                        state.assets[symbol].enableSell = state.assets[symbol].enableSell ? false : true;
                    } else {
                        state.enableSell = !state.enableSell;
                    }
                } else if (code[3] === 66) {
                    if (state.selectedRow >= 0) {
                        const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                        state.assets[symbol].enableBuy = state.assets[symbol].enableBuy ? false : true;
                    } else {
                        state.enableBuy = !state.enableBuy;
                    }
                }
            } else if (code[2] === 51) {
                if (code[3] === 56 || code[3] === 126) { // INSERT
                    state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                    delete state.candles.data;
                    drawCandles(Object.keys(state.currencies).sort()[state.selectedRow]);
                }
            } else if (code[2] === 50) {
                if (code[3] === 57 || code[3] === 126) { // DELETE
                    state.candles.scale = Math.max(0, state.candles.scale - 1);
                    delete state.candles.data;
                    drawCandles(Object.keys(state.currencies).sort()[state.selectedRow]);
                }
            }
        } else if (code.length >= 3 && code[0] === 27 && code[1] === 79) {
            if (code[2] === 80) { // F1
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].enableSell = !state.assets[asset].enableSell;
                } else {
                    state.enableSell = !state.enableSell;
                }
            } else if (code[2] === 81) { // F2
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].enableBuy = !state.assets[asset].enableBuy;
                } else {
                    state.enableBuy = !state.enableBuy;
                }
            } else if (code[2] === 82) { // F3
                state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                delete state.candles.data;
            } else if (code[2] === 83) { // F4
                state.candles.scale = Math.max(0, state.candles.scale - 1);
                delete state.candles.data;
            }
        } else if (code.length === 1) {
            if (code[0] === 27) { // ESC
                const oldRow: number = state.selectedRow;
                state.selectedRow = -1;
                lookupStr = '';
                if (oldRow >= 0) {
                    printSymbol(Object.keys(state.currencies).sort()[oldRow]);
                }
            } else if (code[0] === 13) { // ENTER
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[symbol].forceTrade = true;
                }
            } else if (code[0] === 39) { // RIGHT
                Settings.enableInputLogging = !Settings.enableInputLogging;
            } else if (key === '1') { // 1
                Settings.interpSpeed *= 2;
                addLogMessage(`INTERPOLATION SPEED SET TO ${Settings.interpSpeed}`);
            } else if (key === '2') { // 2
                Settings.interpSpeed /= 2;
                addLogMessage(`INTERPOLATION SPEED SET TO ${Settings.interpSpeed}`);
            } else if (code[0] === 9) { // TAB
                Settings.showTime = !Settings.showTime;
                readline.cursorTo(process.stdout, 0, 0);
                readline.clearScreenDown(process.stdout);
                printTrades();
            } else if (code[0] === 63) { // ?
                const help: string[] = [
                    `${chalk.bold("USAGE:")}`,
                    `\t${chalk.bold("HOME")}: enable/disable trading`,
                    `\t${chalk.bold("END")}: enable/disable buying`,
                    `\t${chalk.bold("UP") + "/" + chalk.bold("DOWN")} arrows: select currency`,
                    `\t${chalk.bold("LEFT") + "/" + chalk.bold("RIGHT")} arrows: change allocated amount for selected currency`,
                    `\t${chalk.bold("ENTER")}: force trade for selected currency at current price`,
                    `\t${chalk.bold("TAB")}: enable/disable buying for selected currency`,
                    `\t${chalk.bold("Q")}: exit`,
                    `\t${chalk.bold("?")}: display this message`,
                    "",
                    `${chalk.bold("NOTE:")}`,
                    `\tPress ${chalk.bold("HOME")} to enable trading and ${chalk.bold("END")} to enable buying.`,
                    `\tSelect a currency using ${chalk.bold("UP")} and ${chalk.bold("DOWN")} arrows,`,
                    `\tand press ${chalk.bold("TAB")} to enable buying for it.`,
                ];

                help.reverse().forEach((line, i) => addLogMessage(line));
            } else if (code[0] === 45) { // INSERT
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[symbol].sellThreshold = Math.max(state.assets[symbol].minNotional, state.assets[symbol].sellThreshold - (state.assets[symbol].sellThreshold > 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 61) { // =
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[symbol].sellThreshold = Math.min(state.currencies[symbol], state.assets[symbol].sellThreshold + (state.assets[symbol].sellThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 93) { // ]
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[symbol].buyThreshold = Math.max(state.assets[symbol].minNotional, state.assets[symbol].buyThreshold - (state.assets[symbol].buyThreshold > 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 91) { // [
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[symbol].buyThreshold = Math.min(state.currencies[symbol], state.assets[symbol].buyThreshold + (state.assets[symbol].buyThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 8 || code[0] === 127) { // BACKSPACE
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    if (symbol in state.balances) {
                        state.currencies[symbol] = state.balances[symbol] * state.assets[symbol].price;
                    }
                    printSymbol(symbol);
                }
            } else if (code[0] > 'A'.charCodeAt(0) && code[0] <= 'z'.charCodeAt(0)) { // A-Z
                addLookupChar(String.fromCharCode(code[0]));
            }
            else if (code[0] === 155) { // INSERT
                state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                delete state.candles.data;
            }
            else if (code[0] === 127) { // DELETE
                state.candles.scale = Math.max(0, state.candles.scale - 1);
                delete state.candles.data;
            }
            else if (cmp([44], code)) { // ,
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].maxDailyLoss = Math.max(0, state.assets[asset].maxDailyLoss - 5);
                }
            } else if (cmp([46], code)) { // .
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].maxDailyLoss += 5;
                }
            }
        }

        if (lastSelectedRow != state.selectedRow)
        {
            printTransactions(state.selectedRow >= 0
                ? Object.keys(state.currencies).sort()[state.selectedRow]
                : undefined);
        }

        if (state.selectedRow >= 0) {
            printStats(Object.keys(state.currencies).sort()[state.selectedRow]);
        }
        if (lastSelectedRow >= 0 && lastSelectedRow != state.selectedRow) {
            delete state.candles.data;
            printSymbol(Object.keys(state.currencies).sort()[lastSelectedRow]);
        }

        if (Settings.enableInputLogging) {
            addLogMessage(`INPUT: ${code.join(' ')}`);
            printTrades();
        }
    });
}