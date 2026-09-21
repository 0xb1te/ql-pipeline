export declare class XlsxError extends Error {
    constructor(message: string);
}
/** Every sheet in the workbook, by name, each as an array of rows of trimmed strings. */
export declare function readWorkbook(bytes: Buffer): Map<string, string[][]>;
