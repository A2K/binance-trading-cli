import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import Fuse from 'fuse.js';
import Settings from './settings';
import { addLogMessage, printStats, printSymbol, printTrades } from './ui';
import state from './state';

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
        if (code.length >= 3 && code[0] === 27 && code[1] === 91) {
            if (state.selectedRow >= 0) {
                readline.cursorTo(process.stdout, 0, state.selectedRow);
                if (state.symbols[Object.keys(state.currencies).sort()[state.selectedRow]]) {
                    process.stdout.write(state.symbols[Object.keys(state.currencies).sort()[state.selectedRow]].statusLine + '');
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
                fs.writeFileSync('./state.currencies.json', JSON.stringify(state.currencies, null, 4));
            } else if (code[2] === 68) {
                if (state.selectedRow >= 0) {
                    if ((state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] % state.steps[state.step]) > 1) {
                        state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] -= state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] % state.steps[state.step]
                    } else {
                        state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] =
                            Math.round((state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] - state.steps[state.step]) / state.steps[state.step]) * state.steps[state.step];
                    }
                }
                fs.writeFileSync('./state.currencies.json', JSON.stringify(state.currencies, null, 4));
            } else if (code[2] === 53) {
                state.step = Math.min(state.step + 1, state.steps.length - 1);
            } else if (code[2] === 54) {
                state.step = Math.max(state.step - 1, 0);
            } else if (code[2] === 49) {
                lookupStr = '';
                state.selectedRow = 0;
            } else if (code[2] === 52) {
                state.selectedRow = Object.keys(state.currencies).length - 1;
                lookupStr = '';
            } else if (code[2] === 91) {
                if (code[3] === 65) {
                    if (state.selectedRow >= 0) {
                        const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                        state.symbols[symbol].enableSell = state.symbols[symbol].enableSell ? false : true;
                    } else {
                        state.enableSell = !state.enableSell;
                    }
                } else if (code[3] === 66) {
                    if (state.selectedRow >= 0) {
                        const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                        state.symbols[symbol].enableBuy = state.symbols[symbol].enableBuy ? false : true;
                    } else {
                        state.enableBuy = !state.enableBuy;
                    }
                }
            } else if (code[2] === 51) {
                if (code[3] === 56) {
                    if (state.selectedRow >= 0) {
                        const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                        state.symbols[symbol].interpSpeed = Math.max(0.000001, state.symbols[symbol].interpSpeed * 0.5);
                    }
                } else if (code[3] === 57) {
                    if (state.selectedRow >= 0) {
                        const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                        state.symbols[symbol].interpSpeed = Math.min(1, state.symbols[symbol].interpSpeed * 2.0);
                    }
                }
            }
        } else if (code.length >= 3 && code[0] === 27 && code[1] === 79) {
            if (code[2] === 80) {
                state.enableSell = !state.enableSell;
            } else if (code[2] === 81) {
                state.enableBuy = !state.enableBuy;
            } else if (code[2] === 82) {
                state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                state.candles.data = [];
            } else if (code[2] === 83) {
                state.candles.scale = Math.max(0, state.candles.scale - 1);
                state.candles.data = [];
            }
        } else if (code.length === 1) {
            if (code[0] === 27) {
                const oldRow: number = state.selectedRow;
                state.selectedRow = -1;
                lookupStr = '';
                if (oldRow >= 0) {
                    printSymbol(Object.keys(state.currencies).sort()[oldRow]);
                }
            } else if (code[0] === 13) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.symbols[symbol].forceTrade = true;
                }
            } else if (code[0] === 39) {
                Settings.enableInputLogging = !Settings.enableInputLogging;
            } else if (key === 'q') {
                process.exit();
            } else if (key === '1') {
                Settings.interpSpeed *= 2;
                addLogMessage(`INTERPOLATION SPEED SET TO ${Settings.interpSpeed}`);
            } else if (key === '2') {
                Settings.interpSpeed /= 2;
                addLogMessage(`INTERPOLATION SPEED SET TO ${Settings.interpSpeed}`);
            } else if (code[0] === 9) {
                Settings.showTime = !Settings.showTime;
                readline.cursorTo(process.stdout, 0, 0);
                readline.clearScreenDown(process.stdout);
                printTrades();
            } else if (code[0] === 63) {
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
            } else if (code[0] === 45) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.symbols[symbol].sellThreshold = Math.max(state.symbols[symbol].minNotional, state.symbols[symbol].sellThreshold - (state.symbols[symbol].sellThreshold > 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 61) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.symbols[symbol].sellThreshold = Math.min(state.currencies[symbol], state.symbols[symbol].sellThreshold + (state.symbols[symbol].sellThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 93) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.symbols[symbol].buyThreshold = Math.max(state.symbols[symbol].minNotional, state.symbols[symbol].buyThreshold - (state.symbols[symbol].buyThreshold > 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 91) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.symbols[symbol].buyThreshold = Math.min(state.currencies[symbol], state.symbols[symbol].buyThreshold + (state.symbols[symbol].buyThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
            } else if (code[0] === 8 || code[0] === 127) {
                if (state.selectedRow >= 0) {
                    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    if (symbol in state.balances) {
                        state.currencies[symbol] = state.balances[symbol] * state.symbols[symbol].price;
                    }
                    printSymbol(symbol);
                }
            } else if (code[0] > 'A'.charCodeAt(0) && code[0] <= 'z'.charCodeAt(0)) {
                addLookupChar(String.fromCharCode(code[0]));
            }
        }

        if (state.selectedRow >= 0) {
            printStats(Object.keys(state.currencies).sort()[state.selectedRow]);
        }
        if (lastSelectedRow >= 0 && lastSelectedRow != state.selectedRow) {
            state.candles.data = [];
            printSymbol(Object.keys(state.currencies).sort()[lastSelectedRow]);
        }

        if (Settings.enableInputLogging) {
            addLogMessage(`INPUT: ${code.join(' ')}`);
            printTrades();
        }
    });
}