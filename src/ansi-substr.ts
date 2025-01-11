const ESCAPE_CODES: { [key: number]: number } = {
	0: 0,
	1: 22,
	2: 22,
	3: 23,
	4: 24,
	7: 27,
	8: 28,
	9: 29,
	30: 39,
	31: 39,
	32: 39,
	33: 39,
	34: 39,
	35: 39,
	36: 39,
	37: 39,
	38: 39,
	90: 39,
	40: 49,
	41: 49,
	42: 49,
	43: 49,
	44: 49,
	45: 49,
	46: 49,
	48: 49,
	47: 49
};

function wrapAnsi(pair: number[]): string {
	let result = '';
	let tmpCode;

	while ((tmpCode = pair.pop())) {
        result += '\u001b[' + tmpCode + 'm';
    }

	return result;
}

export default function ansiSlice(str:string, start:number, end?:number): string {
	const originalString = str.replace(/\u001b\[.*?m/g, '');
	start = (start < 0) ? 0 : start;

	if (end === undefined) {
        end = originalString.length;
    }
	end = (originalString.length < end) ? originalString.length : end;
	const ansiRegex = new RegExp(/\u001b\[(\d+).*?m/g);
	let ansiResult = ansiRegex.exec(str);
	let ansiCursor = 0;
	let stringCursor = 0;
	let tmpCursor;
	let resultString = '';
	const pair:number[] = [];

	if (!ansiResult) {
        return str.substring(start, end);
    }

	if (start === end) {
        return '';
    }

	do {
        if (ansiCursor < ansiResult.index) {
            tmpCursor = stringCursor + (ansiResult.index - ansiCursor);

            if (stringCursor >= start && tmpCursor <= end) {
                resultString += originalString.substring(stringCursor, tmpCursor);
            } else if (stringCursor <= start && tmpCursor >= start && tmpCursor <= end) {
                resultString += originalString.substring(start, tmpCursor);
            } else if (stringCursor <= end && tmpCursor >= end && stringCursor >= start) {
                resultString +=
					(originalString.substring(stringCursor, end));
				break;
            } else if (stringCursor <= start && tmpCursor >= end) {
                resultString +=
					(originalString.substring(start, end));
				break;
            }
        }

        stringCursor += (ansiResult.index - ansiCursor);
        if (stringCursor >= end) {
            break;
        }

        if (ESCAPE_CODES[Number(ansiResult[1])]) {
            pair.push(ESCAPE_CODES[Number(ansiResult[1])]);
        } else {
            const index:number = pair.indexOf(Number(ansiResult[1]));
			pair.splice(index, 1);
        }
        resultString += ansiResult[0];
        ansiCursor = ansiRegex.lastIndex;
        if (stringCursor <= start && pair.length === 0) {
            resultString = '';
        }
    } while ((ansiResult = ansiRegex.exec(str)) !== null);

    resultString += wrapAnsi(pair);
    if (tmpCursor) {
        if (tmpCursor <= end) {
            if (tmpCursor > start) {
                resultString += originalString.substring(tmpCursor, end);
            } else {
                resultString = originalString.substring(start, end);
            }
        }
    }

	return resultString;
};