
import { MyTrade } from 'binance-api-node';
import chalk from 'chalk';
import { Row } from 'postgres';

export class Trade implements MyTrade {
    id: number
    symbol: string
    orderId: number
    orderListId: number
    price: string
    qty: string
    quoteQty: string
    commission: string
    commissionAsset: string
    time: number
    isBuyer: boolean
    isMaker: boolean
    isBestMatch: boolean

    get date(): Date {
        return new Date(this.time);
    }

    get quoteQuantity(): number {
        return parseFloat(this.quoteQty);
    }

    get quantity(): number {
        return parseFloat(this.qty);
    }

    constructor(row: Row) {
        this.time = row.time.getTime();
        this.symbol = row.symbol;
        this.id = parseInt(row.id);
        this.orderId = parseInt(row.orderId);
        this.orderListId = parseInt(row.orderListId);
        this.price = row.price;
        this.qty = row.qty;
        this.quoteQty = row.quoteQty;
        this.commission = row.commission;
        this.commissionAsset = row.commissionAsset;
        this.isBuyer = row.isBuyer;
        this.isMaker = row.isMaker;
        this.isBestMatch = row.isBestMatch;
    }

    toString(): string {
        return `${this.isBuyer ? '🪙' : '💵'}` +
            ` ${this.date.toLocaleDateString("uk-UA", {
                year: 'numeric',
                month: 'numeric',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })} ` +
            `${(this.isBuyer ? chalk.redBright : chalk.greenBright)((this.isBuyer ? '-' : '+') + Math.abs(this.quoteQuantity).toFixed(2))} ${chalk.whiteBright('USDT')} ` +
            `${(this.isBuyer ? chalk.green : chalk.red)((this.isBuyer ? '+' : '-') + Math.abs(this.quantity))} ${chalk.bold(this.symbol.replace(/USDT$/, ''))} at ${chalk.yellowBright(this.price)} ` +
            chalk.rgb(125, 125, 125)(`fee ${chalk.rgb(150, 125, 50)(this.commission)} ${chalk.rgb(150, 150, 150)(this.commissionAsset)}`);
    }

}

export default Trade;