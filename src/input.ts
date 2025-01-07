import readline from 'readline';
import chalk from 'chalk';
import Fuse from 'fuse.js';
import Settings, { saveConfigFile } from './settings';
import { log, clearTransactions, drawCandles, drawCandlesStatusBar, tradeLog, printStats, printSymbol, printTrades, printTransactions, printLog, messageLog } from './ui';
import state from './state';
import { redeemFlexibleProductAll, subscribeFlexibleProductAllFree } from './autostaking';
import { closeLiveIndicator } from './indicators';
import terminal from 'terminal-kit';
import Grapheme from 'grapheme-splitter';

import child_process from 'child_process';
const term = terminal.terminal;

term.grabInput({ mouse: 'motion' });

term.on('key', function (name: string, matches: string[], data: any) {
    const { isCharacter } = data;
    const lastSelectedRow = state.selectedRow;
    if (isCharacter) {
        addLookupChar(name);
    } else {
        switch (name) {
            // ctrl+c
            case 'CTRL_C':
                child_process.execSync('tmux detach-client');
                // process.exit();
                break;
            case 'CTRL_Q':
                process.exit();
                break;
            case 'UP':
                lookupStr = '';
                if (state.selectedRow == -1) {
                    state.selectedRow = Object.keys(state.currencies).length - 1;
                } else {
                    state.selectedRow = Math.max(-1, state.selectedRow - 1);
                }
                break;
            case 'DOWN':
                lookupStr = '';
                if (state.selectedRow == Object.keys(state.currencies).length - 1) {
                    state.selectedRow = -1;
                } else {
                    state.selectedRow = Math.min(Object.keys(state.currencies).length - 1, state.selectedRow + 1);
                }
                break;
            case 'RIGHT':
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
                break;
            case 'LEFT':
                if (state.selectedRow >= 0) {
                    if ((state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] % state.steps[state.step]) > 1) {
                        state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] -= state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] % state.steps[state.step]
                    } else {
                        state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] =
                            Math.round((state.currencies[Object.keys(state.currencies).sort()[state.selectedRow]] - state.steps[state.step]) / state.steps[state.step]) * state.steps[state.step];
                    }
                }
                saveConfigFile('currencies', state.currencies);
                break;
            case 'PAGE_UP':
                state.step = Math.min(state.step + 1, state.steps.length - 1);
                break;
            case 'PAGE_DOWN':
                state.step = Math.max(state.step - 1, 0);
                break;
            case 'INSERT':
                const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
                state.candles.scale = Math.max(0, state.candles.scale - 1);
                drawCandlesStatusBar(symbol);
                delete state.candles.data;
                drawCandles(symbol);
                break;
            case 'DELETE':
                state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                delete state.candles.data;
                drawCandles(Object.keys(state.currencies).sort()[state.selectedRow]);
                break;
            case 'HOME':
                lookupStr = '';
                state.selectedRow = 0;
                state.symbolsScroll = 0;
                Object.keys(state.currencies).map(printSymbol);
                break;
            case 'END':
                lookupStr = '';
                state.selectedRow = Object.keys(state.currencies).length - 1;
                state.symbolsScroll = Math.max(0, Object.keys(state.currencies).length - state.symbolsHeight);
                Object.keys(state.currencies).map(printSymbol);
                break;
            case 'F1':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].enableSell = !state.assets[asset].enableSell;
                } else {
                    state.enableSell = !state.enableSell;
                }
                break;
            case 'F2':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].enableBuy = !state.assets[asset].enableBuy;
                } else {
                    state.enableBuy = !state.enableBuy;
                }
                break;
            case 'F6':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].staking = !state.assets[asset].staking;
                }
                break;
            case 'F7':
                for (const asset of Object.keys(state.currencies)) {
                    subscribeFlexibleProductAllFree(asset);
                }
                break;
            case 'F8':
                if (state.selectedRow >= 0) {
                    const asset: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    subscribeFlexibleProductAllFree(asset);
                }
                break;
            case 'F9':
                if (state.selectedRow >= 0) {
                    const asset: string = Object.keys(state.currencies).sort()[state.selectedRow];
                    redeemFlexibleProductAll(asset);
                }
                break;
            case 'TAB':
                Settings.drawCandles = !Settings.drawCandles;
                printTrades();
                break;
            case 'ESC':
                state.selectedRow = -1;
                lookupStr = '';
                process.exit(10)
                break;
            case 'ESCAPE':
                state.selectedRow = -1;
                lookupStr = '';
                break;
        }
    }
    if (lastSelectedRow !== state.selectedRow) {
        onSelectedRowChanged(lastSelectedRow);
    }
});

var dragging = false;
var draggingView: 'trades' | 'log' | 'symbols' | 'dividerVertical' = 'trades';
var draggingInverted = false;
var dragStartY = 0;
var scrollBarGrabOffset = 0;
// var selectRowOnMotion = false;
term.on('mouse', function (name: string, data: any) {
    const { x, y } = data;
    const lastSelectedRow = state.selectedRow;
    switch (name) {
        case 'MOUSE_MOTION':
            const hover = x === process.stdout.columns;
            if (hover !== state.tradesScrollHover) {
                state.tradesScrollHover = hover;
                printTrades();
            }
            const hoverLog = x === state.candles.XBase && y > Object.keys(state.currencies).length;
            if (hoverLog !== state.logScrollHover) {
                state.logScrollHover = hoverLog;
                printLog();
            }
            // if (selectRowOnMotion) {
            //     state.selectedRow = y - 1;
            // }
            break;
        case 'MOUSE_RIGHT_BUTTON_PRESSED':
            break;
        case 'MOUSE_RIGHT_BUTTON_RELEASED':
            break;
        case 'MOUSE_LEFT_BUTTON_PRESSED':
            // if (x < state.candles.XBase && y <= Object.keys(state.currencies).length) {
            //     state.selectedRow = y - 1;
            //     selectRowOnMotion = true;
            // }

            if (x > state.candles.XBase) {
                if (y > (Settings.drawCandles ? state.candles.height : 0)) {
                    draggingView = 'trades';
                    draggingInverted = x < process.stdout.columns!;
                    dragging = true;
                    dragStartY = y;
                    scrollBarGrabOffset = state.tradeScroll;
                }
            }

            if (x <= state.candles.XBase && y - 1 < state.symbolsHeight) {
                draggingView = 'symbols';
                draggingInverted = x < state.candles.XBase;
                dragging = true;
                dragStartY = y;
                scrollBarGrabOffset = state.symbolsScroll;
            }
            if (x <= state.candles.XBase && y - 1 > state.symbolsHeight) {
                draggingView = 'log';
                draggingInverted = x < state.candles.XBase;
                dragging = true;
                dragStartY = y;
                scrollBarGrabOffset = state.logScroll;
            }
            if (x <= state.candles.XBase && y - 1 === state.symbolsHeight) {
                draggingView = 'dividerVertical';
                dragging = true;
                dragStartY = y;
                scrollBarGrabOffset = state.symbolsScroll;
            }
            if (x < state.candles.XBase && y < state.symbolsHeight) {
                state.selectedRow = y - 1 + state.symbolsScroll;
            }

            if ((Date.now() - lastClick.time) < 500
                && lastClick.x === x
                && lastClick.y === y) {
                // double click

                if (x >= 65 && x <= 68) {
                    if (y < Object.keys(state.currencies).length) {
                        state.assets[Object.keys(state.currencies).sort()[y]].staking =
                            !state.assets[Object.keys(state.currencies).sort()[y]].staking;
                    }
                }
                if (x >= 75 && x <= 79) {
                    if (y < Object.keys(state.currencies).length) {
                        state.assets[Object.keys(state.currencies).sort()[y]].enableSell =
                            !state.assets[Object.keys(state.currencies).sort()[y]].enableSell;
                    }
                }

                if (x >= 80 && x <= 85) {
                    if (y < Object.keys(state.currencies).length) {
                        state.assets[Object.keys(state.currencies).sort()[y]].enableBuy =
                            !state.assets[Object.keys(state.currencies).sort()[y]].enableBuy;
                    }
                }
                else if (x <= 100) {
                    if (!Settings.drawCandles) {
                        Settings.drawCandles = true;
                        printSymbol(Object.keys(state.currencies).sort()[y - 1]);
                        printTrades();
                    }
                }
            }

            lastClick.x = x;
            lastClick.y = y;
            lastClick.time = Date.now();

            break;
        case 'MOUSE_LEFT_BUTTON_RELEASED':
            dragging = false;
            break;
        case 'MOUSE_MIDDLE_BUTTON_PRESSED':
            break;
        case 'MOUSE_WHEEL_UP':
        case 'MOUSE_WHEEL_DOWN':
            if (x > state.candles.XBase) {
                if (Settings.drawCandles && y <= state.candles.height) {
                    if (name === 'MOUSE_WHEEL_UP') {
                        state.candles.scale = Math.max(0, state.candles.scale - 1);
                    } else {
                        state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                    }
                    drawCandlesStatusBar(Object.keys(state.currencies).sort()[state.selectedRow]);
                    delete state.candles.data;
                    drawCandles(Object.keys(state.currencies).sort()[state.selectedRow]);
                } else {
                    if (name === 'MOUSE_WHEEL_UP') {
                        const newValue = Math.max(0, state.tradeScroll - 1);
                        if (newValue !== state.tradeScroll) {
                            state.tradeScroll = newValue;
                            printTrades();
                        }
                    } else {
                        const newValue = state.tradeScroll + 1; // TODO
                        if (newValue !== state.tradeScroll) {
                            state.tradeScroll = newValue;
                            printTrades();
                        }
                    }
                }
            } else if (y > state.symbolsHeight && x < state.candles.XBase) {
                if (name === 'MOUSE_WHEEL_UP') {
                    const newValue = Math.max(0, state.logScroll - 1);
                    if (newValue !== state.logScroll) {
                        state.logScroll = newValue;
                        printLog();
                    }
                } else {
                    const newValue = state.logScroll + 1; // TODO
                    if (newValue !== state.logScroll) {
                        state.logScroll = newValue;
                        printLog();
                    }
                }
            } else if (y < state.symbolsHeight && x < state.candles.XBase) {
                if (name === 'MOUSE_WHEEL_UP') {
                    const newValue = Math.max(0, state.symbolsScroll - 1);
                    if (newValue !== state.symbolsScroll) {
                        state.symbolsScroll = newValue;
                        Object.keys(state.currencies).map(printSymbol);
                    }
                } else {
                    const newValue = Math.min(state.symbolsScroll + 1, Math.max(0, (Object.keys(state.currencies).length - state.symbolsHeight)));
                    if (newValue !== state.symbolsScroll) {
                        state.symbolsScroll = newValue;
                        Object.keys(state.currencies).map(printSymbol);
                    }
                }
            }
            break;
    case 'MOUSE_DRAG':
            if (dragging) {
                if (draggingView === 'trades') {
                    const yOffset = Settings.drawCandles ? state.candles.height + 3 : 1;
                    if (draggingInverted) {
                        state.tradeScroll += dragStartY - y;
                        dragStartY = y;
                    } else {
                        state.tradeScroll = Math.round(
                            (tradeLog.length)
                            * (y - dragStartY) * (draggingInverted ? -1 : 1)
                            / (process.stdout.rows! - yOffset)) + scrollBarGrabOffset;
                    }

                    const maxLines = (Settings.drawCandles && state.selectedRow >= 0)
                        ? (process.stdout.rows || 80) - state.candles.height - 3
                        : (process.stdout.rows || 80) - 2;
                    state.tradeScroll = Math.max(0, Math.min(state.tradeScroll, Math.max(0, tradeLog.length - maxLines)));
                    printTrades();
                } else if (draggingView === 'log') {
                    const yOffset = Object.keys(state.currencies).length + 1;
                    if (draggingInverted) {
                        state.logScroll += dragStartY - y;
                        dragStartY = y;
                    } else {
                        state.logScroll = Math.round(
                            (messageLog.length)
                            * (y - dragStartY) * (draggingInverted ? -1 : 1)
                            / (process.stdout.rows! - yOffset)) + scrollBarGrabOffset;
                    }

                    const maxLines = Object.keys(state.currencies).length;
                    state.logScroll = Math.max(0, Math.min(state.logScroll, Math.max(0, messageLog.length - maxLines)));
                    printLog();
                } else if (draggingView === 'symbols') {
                    if (draggingInverted) {
                        state.symbolsScroll += dragStartY - y;
                        dragStartY = y;
                    } else {
                        state.symbolsScroll = Math.round(
                            state.symbolsHeight
                            * (y - dragStartY) * (draggingInverted ? -1 : 1)
                            / (process.stdout.rows!)) + scrollBarGrabOffset;
                    }

                    state.symbolsScroll = Math.max(0, Math.min(state.symbolsScroll, Object.keys(state.currencies).length - state.symbolsHeight));
                    Object.keys(state.currencies).map(printSymbol)
                    // printSymbol(Object.keys(state.currencies).sort()[state.selectedRow]);
                } else if (draggingView === 'dividerVertical') {
                    state.symbolsHeight = Math.max(1, y - 1);
                    Object.keys(state.currencies).map(printSymbol);
                    printLog();
                    if (state.symbolsHeight >= Object.keys(state.currencies).length) {
                        state.symbolsScroll = 0;
                    } else {
                        state.symbolsScroll = Math.min(state.symbolsScroll,
                            Object.keys(state.currencies).length - state.symbolsHeight);
                    }
                }

                // else if (selectRowOnMotion) {
                //     state.selectedRow = y - 1;
                // }
            }
            break;
    }
    if (lastSelectedRow !== state.selectedRow) {
        onSelectedRowChanged(lastSelectedRow);
    }
});

function onSelectedRowChanged(lastSelectedRow: number) {

    delete state.candles.data;

    const symbol = Object.keys(state.currencies).sort()[lastSelectedRow];
    if (lastSelectedRow >= 0 && state.assets[symbol]) {
        for (const period of ['1h', '1d', '1w', '1M']) {
            closeLiveIndicator('SMA', `${symbol}${Settings.stableCoin}`, period);
            closeLiveIndicator('EMA', `${symbol}${Settings.stableCoin}`, period);
            closeLiveIndicator('RSI', `${symbol}${Settings.stableCoin}`, period);
            closeLiveIndicator('stRSI', `${symbol}${Settings.stableCoin}`, period);
        }
    }

    if (state.selectedRow >= 0) {
        if (state.selectedRow < state.symbolsScroll) {
            state.symbolsScroll = state.selectedRow;
            Object.keys(state.currencies).map(printSymbol);
        }
        if (state.selectedRow >= state.symbolsScroll + state.symbolsHeight) {
            state.symbolsScroll = state.selectedRow - state.symbolsHeight + 1;
            Object.keys(state.currencies).map(printSymbol);
        }
    }

    if (lastSelectedRow >= 0) {
        printSymbol(Object.keys(state.currencies).sort()[lastSelectedRow]);
    }

    if (state.selectedRow >= 0) {
        printSymbol(Object.keys(state.currencies).sort()[state.selectedRow]);
    }

    printTransactions(state.selectedRow >= 0
        ? Object.keys(state.currencies).sort()[state.selectedRow]
        : undefined);
}
// require('keypress').enableMouse(process.stdout);

// process.stdout.write('\x1b[?1003h');

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

const lastClick: { x: number, y: number, time: number } = { x: -1, y: -1, time: 0 };

export default function registerInputHandlers() {
    return;
/*
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
                Settings.drawCandles = !Settings.drawCandles;
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
                    state.wallet.total(symbol).then((total) =>
                        state.currencies[symbol] = total * state.assets[symbol].price)
                        .then(() => printSymbol(symbol));
                }
            } else if (code.length === 1 && code[0] > 'A'.charCodeAt(0) && code[0] <= 'z'.charCodeAt(0)) { // A-Z
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

        if (code[0] === 27 && code[1] === 91 && code[2] === 77) { // mouse events
            const x = code[4] - 33;
            const y = code[5] - 33;
            if (code[3] === 32) {
                if ((Date.now() - lastClick.time) < 500
                    && lastClick.x === x
                    && lastClick.y === y) {
                    // double click

                    if (x >= 65 && x <= 68) {
                        state.assets[Object.keys(state.currencies).sort()[y]].staking =
                            !state.assets[Object.keys(state.currencies).sort()[y]].staking;
                    }
                    if (x >= 75 && x <= 79) {
                        state.assets[Object.keys(state.currencies).sort()[y]].enableSell =
                            !state.assets[Object.keys(state.currencies).sort()[y]].enableSell;
                    }

                    if (x >= 80 && x <= 85) {
                        state.assets[Object.keys(state.currencies).sort()[y]].enableBuy =
                            !state.assets[Object.keys(state.currencies).sort()[y]].enableBuy;
                    }
                    else if (x <= 100) {
                        if (!Settings.drawCandles) {
                            Settings.drawCandles = true;
                            printTrades();
                        }
                    }
                    return;
                }
                lastClick.x = x;
                lastClick.y = y;
                lastClick.time = Date.now();
            }

            if (code[3] === 97 || code[3] === 96) { // mouse wheel
                if (x > state.candles.XBase
                    && y < state.candles.height
                    && Settings.drawCandles) {  // over candles
                    if (code[3] === 97) { // wheel in
                        state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                        delete state.candles.data;
                        if (state.selectedRow >= 0) {
                            const selectedSymbol = Object.keys(state.currencies).sort()[state.selectedRow];
                            drawCandlesStatusBar(selectedSymbol);
                        }
                    } else if (code[3] === 96) { // wheel out
                        state.candles.scale = Math.max(0, state.candles.scale - 1);
                        delete state.candles.data;
                        if (state.selectedRow >= 0) {
                            const selectedSymbol = Object.keys(state.currencies).sort()[state.selectedRow];
                            drawCandlesStatusBar(selectedSymbol);
                        }
                    }
                } else if (x > state.candles.XBase && (Settings.drawCandles ? y > state.candles.height : true)) {
                    if (code[3] === 97) { // wheel in

                        const newValue = state.logScroll + 1;

                        if (state.logScroll !== newValue) {
                            state.logScroll = newValue;
                            printTrades();
                        }
                    } else if (code[3] === 96) { // wheel out
                        const newValue = Math.max(state.logScroll - 1, 0);
                        if (state.logScroll !== newValue) {
                            state.logScroll = newValue;
                            printTrades();
                        }
                    }
                }
            }

            if (x >= 0
                && x <= state.candles.XBase
                && y <= Object.keys(state.currencies).length
            ) {
                if (code[3] === 32 || code[3] === 64) {
                    state.selectedRow = y;

                    if (y === Object.keys(state.currencies).length) {
                        if (x >= 3 && x <= 6) {
                            state.enableSell = !state.enableSell;
                        }
                        if (x >= 8 && x <= 11) {
                            state.enableBuy = !state.enableBuy;
                        }
                    }
                }
            }
        }

        if (lastSelectedRow != state.selectedRow)
        {
            const symbol = Object.keys(state.currencies).sort()[lastSelectedRow];
            if (lastSelectedRow >= 0 && state.assets[symbol]) {
                for (const period of ['1h', '1d', '1w', '1M']) {
                    closeLiveIndicator('SMA', `${symbol}${Settings.stableCoin}`, period);
                    closeLiveIndicator('EMA', `${symbol}${Settings.stableCoin}`, period);
                    closeLiveIndicator('RSI', `${symbol}${Settings.stableCoin}`, period);
                    closeLiveIndicator('stRSI', `${symbol}${Settings.stableCoin}`, period);
                }
            }

            printTransactions(state.selectedRow >= 0
                ? Object.keys(state.currencies).sort()[state.selectedRow]
                : undefined);
        }

        // if (state.selectedRow >= 0 && ) {
        //     printStats(Object.keys(state.currencies).sort()[state.selectedRow]);
        // }
        if (lastSelectedRow != state.selectedRow) {
            delete state.candles.data;
            if (state.selectedRow >= 0) {
                printStats(Object.keys(state.currencies).sort()[state.selectedRow]);
            }
            if (lastSelectedRow >= 0) {
                printSymbol(Object.keys(state.currencies).sort()[lastSelectedRow]);
            }
        }

        if (Settings.enableInputLogging) {
            addLogMessage(`INPUT: ${code.join(' ')}`);
            printTrades();
        }
    });
    */
}