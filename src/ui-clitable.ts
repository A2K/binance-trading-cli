
import { log, scrollBar } from './ui';

export class CLICell {
    constructor(public getter: (width: number) => Promise<string> = async () => ' '.repeat(width), public width: number = 10) { }

    public async render(): Promise<string> {
        try {
            return await this.getter(this.width);
        } catch (e) {
            log.err(e);
            return 'ERR'.padEnd(this.width);
        }
    }
}

export default class CLITable {

    private rows: CLICell[][] = [];

    private _height: number = 25;
    get height(): number { return this._height; }
    set height(value: number) {
        this._height = value;
        this._scrollBarNeedsUpdate = true;
    }

    private _scrollPosition: number = 0;
    private _scrollBarNeedsUpdate = true;

    get scrollPosition(): number { return this._scrollPosition; }
    set scrollPosition(value: number) {
        const newValue = Math.max(0, Math.min(this.rows.length - this.height, value));
        if (newValue != this._scrollPosition) {
            this._scrollPosition = newValue;
            this._scrollBarNeedsUpdate = true;
        }
    }

    private _scrollBar: string = '';
    get scrollBar(): string {
        if (this._scrollBarNeedsUpdate) {
            this.updateScrollBar();
        }
        return this._scrollBar;
    }

    constructor(rows: number, columns: number, public spacing: number = 1) {
        this.rows = new Array(rows).fill(0).map(() => new Array(columns).fill(0).map(() => new CLICell(async () => '')));
    }

    private updateScrollBar(): void {
        this._scrollBar = scrollBar({
            position: this.scrollPosition,
            total: this.rows.length,
            height: this.height
        });
        this._scrollBarNeedsUpdate = false;
    }

    public setCell(row: number, column: number, getter: (width: number) => Promise<string>): void {
        this.rows[row][column].getter = getter;
    }

    public setColumnWidth(column: number, width: number): void {
        this.rows.forEach(row => row[column].width = width);
    }

    public async renderRow(index: number): Promise<string> {
        if (index < 0 || index >= this.rows.length) {
            return ' '.repeat(this.width);
        }
        const cells = await Promise.all(this.rows[index].map(async (cell: CLICell) => await cell.render()));
        return `${cells.join(' '.repeat(this.spacing))} ${this.scrollBar[index - this.scrollPosition] || ''}`;
    }

    public async renderTable(): Promise<string[]> {
        if (this._scrollBarNeedsUpdate) {
            this.updateScrollBar();
        }
        const visibleRows = this.rows.slice(this.scrollPosition, Math.min(this.rows.length, this.scrollPosition + this.height));
        return Promise.all(visibleRows.map(async (_, index: number) => await this.renderRow(index)));
    }

    get width(): number {
        return this.rows.length
            ? this.rows[0].reduce((acc, cell) => acc + cell.width, 0) + this.spacing * (this.rows[0].length - 1) + 10
            : 0;
    }

}