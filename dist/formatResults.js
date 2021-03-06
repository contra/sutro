"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stream = exports.format = void 0;
const jsonstream_next_1 = __importDefault(require("jsonstream-next"));
const isTypeORM = (inp) => Array.isArray(inp) &&
    inp.length === 2 &&
    Array.isArray(inp[0]) &&
    typeof inp[1] === 'number';
const isSequelize = (inp) => inp.rows && typeof inp.count !== 'undefined';
const format = (inp = [], meta) => {
    let rows;
    let count;
    if (isSequelize(inp)) {
        rows = inp.rows;
        count = inp.count;
    }
    else if (isTypeORM(inp)) {
        rows = inp[0];
        count = inp[1];
    }
    else if (Array.isArray(inp)) {
        rows = inp;
    }
    else {
        throw new Error('Invalid response! Could not format.');
    }
    return {
        results: rows,
        meta: {
            results: rows.length,
            total: typeof count === 'undefined'
                ? rows.length
                : Math.max(rows.length, count),
            ...meta
        }
    };
};
exports.format = format;
const stream = (counter, meta) => {
    let results = 0;
    const tail = jsonstream_next_1.default.stringify('{"results":[', ',', (cb) => {
        const fin = (res, total) => {
            const outMeta = {
                results: res,
                total,
                ...meta
            };
            cb(null, `],"meta":${JSON.stringify(outMeta)}}`);
        };
        if (!counter)
            return fin(results, results);
        counter
            .then((total) => {
            const totalConstrained = Math.max(results, total); // count should never be below results
            fin(results, totalConstrained);
        })
            .catch((err) => cb(err));
    });
    const origWrite = tail.write;
    tail.write = (...a) => {
        ++results;
        return origWrite.call(tail, ...a);
    };
    return tail;
};
exports.stream = stream;
exports.stream.contentType = 'application/json';
//# sourceMappingURL=formatResults.js.map