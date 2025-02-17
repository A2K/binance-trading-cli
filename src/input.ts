import Fuse from 'fuse.js';
import Settings, { saveConfigFile } from './settings';
import { drawCandles, drawCandlesStatusBar, tradeLog, printSymbol, printTrades, printTransactions, printLog, messageLog, activeLimitsWidget, symbolsTable } from './ui';
import state from './state';
import { redeemFlexibleProductAll, subscribeFlexibleProductAllFree } from './autostaking';
import { closeLiveIndicator } from './indicators';
import terminal from 'terminal-kit';

import child_process from 'child_process';
import { stat } from 'fs';
import { getAssetBallance } from './utils';
const term = terminal.terminal;

term.grabInput({ mouse: 'motion' });

term.on('key', function (name: string, matches: string[], data: any) {
    const { isCharacter } = data;
    const lastSelectedRow = state.selectedRow;
    const symbol: string = Object.keys(state.currencies).sort()[state.selectedRow];
    if (isCharacter && !['-', '=', '[', ']', ',', '.', '<', '>', ';', '\''].includes(name)) {
        if (activeLimitsWidget && ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(name)) {
            activeLimitsWidget.handleInput(name);
        } else {
            addLookupChar(name);
        }
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
                    if ((state.currencies[symbol] % state.steps[state.step]) > 1) {
                        state.currencies[symbol] -= state.currencies[symbol] % state.steps[state.step]
                    } else {
                        state.currencies[symbol] =
                            Math.round((state.currencies[symbol] - state.steps[state.step]) / state.steps[state.step]) * state.steps[state.step];
                    }
                    printSymbol(symbol);
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
                state.candles.scale = Math.max(0, state.candles.scale - 1);
                drawCandlesStatusBar(symbol);
                delete state.candles.data;
                drawCandles(symbol);
                break;
            case 'DELETE':
                state.candles.scale = Math.min(state.candles.scales.length - 1, state.candles.scale + 1);
                drawCandlesStatusBar(symbol);
                delete state.candles.data;
                drawCandles(Object.keys(state.currencies).sort()[state.selectedRow]);
                break;
            case 'HOME':
                lookupStr = '';
                state.selectedRow = 0;
                symbolsTable!.scrollPosition = 0;
                Object.keys(state.currencies).map(printSymbol);
                break;
            case 'END':
                lookupStr = '';
                state.selectedRow = Object.keys(state.currencies).length - 1;
                symbolsTable!.scrollPosition = Math.max(0, Object.keys(state.currencies).length - symbolsTable!.height);
                Object.keys(state.currencies).map(printSymbol);
                break;
            case 'BACKSPACE':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    getAssetBallance(asset).then((balance) => {
                        state.currencies[asset] = balance;
                        printSymbol(asset);
                    });
                }
                break;
            case 'F1':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].enableSell = !state.assets[asset].enableSell;
                } else {
                    state.enableSell = !state.enableSell;
                }
                printSymbol(symbol);
                break;
            case 'F2':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].enableBuy = !state.assets[asset].enableBuy;
                } else {
                    state.enableBuy = !state.enableBuy;
                }
                printSymbol(symbol);
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
            case 'ENTER':
                if (activeLimitsWidget) {
                    activeLimitsWidget.handleEnter();
                }
                if (state.selectedRow >= 0) {
                    if (!state.assets[symbol].currentOrder) {
                        state.assets[symbol].forceTrade = true;
                    }
                }
                break;
            case '-':
                if (state.selectedRow >= 0) {
                    state.assets[symbol].sellThreshold = Math.max(state.assets[symbol].minNotional, state.assets[symbol].sellThreshold - (state.assets[symbol].sellThreshold > 10 ? 5 : 1));
                    printSymbol(symbol);
                }
                break;
            case '=':
                if (state.selectedRow >= 0) {
                    state.assets[symbol].sellThreshold = Math.min(state.currencies[symbol], state.assets[symbol].sellThreshold + (state.assets[symbol].sellThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
                break;
            case ']':
                if (state.selectedRow >= 0) {
                    state.assets[symbol].buyThreshold = Math.max(state.assets[symbol].minNotional, state.assets[symbol].buyThreshold - (state.assets[symbol].buyThreshold > 10 ? 5 : 1));
                    printSymbol(symbol);
                }
                break;
            case '[':
                if (state.selectedRow >= 0) {
                    state.assets[symbol].buyThreshold = Math.min(state.currencies[symbol], state.assets[symbol].buyThreshold + (state.assets[symbol].buyThreshold >= 10 ? 5 : 1));
                    printSymbol(symbol);
                }
                break;
            case ',':
            case '<':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].maxDailyLoss = Math.max(0, state.assets[asset].maxDailyLoss - 5);
                    printSymbol(asset);
                }
                break;
            case '.':
            case '>':
                if (state.selectedRow >= 0) {
                    const asset = Object.keys(state.currencies).sort()[state.selectedRow];
                    state.assets[asset].maxDailyLoss += 5;
                    printSymbol(asset);
                }
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
            const hoverLog = x === symbolsTable?.width && y > Object.keys(state.currencies).length;
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
            // if (x < symbolsTable.width && y <= Object.keys(state.currencies).length) {
            //     state.selectedRow = y - 1;
            //     selectRowOnMotion = true;
            // }


            if (x > symbolsTable.width) {
                if (y > (Settings.drawCandles ? state.candles.height : 0)) {
                    draggingView = 'trades';
                    draggingInverted = x < process.stdout.columns!;
                    dragging = true;
                    dragStartY = y;
                    scrollBarGrabOffset = state.tradeScroll;
                }
            }

            if (x <= symbolsTable.width && y - 1 < symbolsTable.height) {
                draggingView = 'symbols';
                draggingInverted = x < symbolsTable.width;
                dragging = true;
                dragStartY = y;
                scrollBarGrabOffset = symbolsTable.scrollPosition;
            }
            if (x <= symbolsTable?.width && y - 1 > symbolsTable.height) {
                draggingView = 'log';
                draggingInverted = x < symbolsTable.width;
                dragging = true;
                dragStartY = y;
                scrollBarGrabOffset = state.logScroll;
            }
            if (x <= symbolsTable.width && y - 1 === symbolsTable.height) {
                draggingView = 'dividerVertical';
                dragging = true;
                dragStartY = y;
                scrollBarGrabOffset = symbolsTable.scrollPosition;
            }
            if (x < symbolsTable.width && y <= symbolsTable.height) {
                state.selectedRow = y - 1 + symbolsTable.scrollPosition;
            }

            if ((Date.now() - lastClick.time) < 500
                && lastClick.x === x
                && lastClick.y === y) {
                // double click

                if (x > symbolsTable.width && y > state.candles.height + 2 && y <= state.candles.height + 4) {
                    activeLimitsWidget?.handleDoubleClick(x - symbolsTable.width, y - state.candles.height - 2);
                }

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
            if (x > symbolsTable!.width) {
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
            } else if (y > symbolsTable.height && x < symbolsTable!.width) {
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
            } else if (y < symbolsTable.height && x < symbolsTable!.width) {
                if (name === 'MOUSE_WHEEL_UP') {
                    const newValue = Math.max(0, symbolsTable.scrollPosition - 1);
                    if (newValue !== symbolsTable.scrollPosition) {
                        symbolsTable.scrollPosition = newValue;
                        Object.keys(state.currencies).map(printSymbol);
                    }
                } else {
                    const newValue = Math.min(symbolsTable.scrollPosition + 1, Math.max(0, (Object.keys(state.currencies).length - symbolsTable.height)));
                    if (newValue !== symbolsTable.scrollPosition) {
                        symbolsTable.scrollPosition = newValue;
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
                        symbolsTable.scrollPosition += dragStartY - y;
                        dragStartY = y;
                    } else {
                        symbolsTable.scrollPosition = Math.round(
                            symbolsTable.height
                            * (y - dragStartY) * (draggingInverted ? -1 : 1)
                            / (process.stdout.rows!)) + scrollBarGrabOffset;
                    }

                    symbolsTable.scrollPosition = Math.max(0, Math.min(symbolsTable.scrollPosition, Object.keys(state.currencies).length - symbolsTable.height));
                    Object.keys(state.currencies).map(printSymbol)
                    // printSymbol(Object.keys(state.currencies).sort()[state.selectedRow]);
                } else if (draggingView === 'dividerVertical') {
                    symbolsTable.height = Math.max(1, y - 1);
                    Object.keys(state.currencies).map(printSymbol);
                    printLog();
                    if (symbolsTable.height >= Object.keys(state.currencies).length) {
                        symbolsTable.scrollPosition = 0;
                    } else {
                        symbolsTable.scrollPosition = Math.min(symbolsTable.scrollPosition,
                            Object.keys(state.currencies).length - symbolsTable.height);
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
        if (state.selectedRow < symbolsTable!.scrollPosition) {
            symbolsTable!.scrollPosition = state.selectedRow;
            Object.keys(state.currencies).map(printSymbol);
        }
        if (state.selectedRow >= symbolsTable!.scrollPosition + symbolsTable!.height) {
            symbolsTable!.scrollPosition = state.selectedRow - symbolsTable!.height + 1;
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
require('keypress').enableMouse(process.stdout);

process.stdout.write('\x1b[?1003h');

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
    // const stdin = process.stdin;
    // if (stdin.setRawMode) {
    //     stdin.setRawMode(true);
    // }
    // stdin.resume();
    // stdin.setEncoding('utf8');
}