import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkbook, XlsxError } from '../../src/tester/xlsx-reader.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const template = (): Map<string, string[][]> =>
  readWorkbook(readFileSync(join(FIXTURES, 'template-plan.xlsx')));

describe('readWorkbook', () => {
  it('reads every sheet openpyxl wrote, by name', () => {
    expect([...template().keys()]).toEqual(['MCP Cases', 'TEMPLATE']);
  });

  it('reads the pinned header row exactly', () => {
    expect(template().get('MCP Cases')?.[0]).toEqual([
      'Case-id', 'Feature area', 'Precondition', 'Call', 'Input',
      'Expected result', 'Severity', 'Obtained result', 'Status',
    ]);
  });

  it('reads a data row, including the JSON payload cell', () => {
    const row = template().get('MCP Cases')?.[1];
    expect(row?.[0]).toBe('TASK000-1');
    expect(row?.[4]).toBe('{"categoryId": "cat-empty"}');
    expect(row?.[6]).toBe('blocker');
  });

  it('throws rather than returning nothing for a file that is not a zip', () => {
    expect(() => readWorkbook(Buffer.from('this is not a spreadsheet'))).toThrow(XlsxError);
  });
});
