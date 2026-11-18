declare module "fast-formula-parser" {
  export interface Coordinate {
    row: number;
    col: number;
  }

  export interface CellRef extends Coordinate {
    sheet?: string;
  }

  export interface RangeRef {
    sheet?: string;
    from: Coordinate;
    to: Coordinate;
  }

  export interface Position extends Coordinate {
    sheet: string;
  }

  export interface FunctionArg {
    value: unknown;
    isArray: boolean;
    isRangeRef?: boolean;
    isCellRef?: boolean;
    omitted?: boolean;
  }

  export class FormulaError extends Error {
    constructor(error: string, message?: string, details?: unknown);
    readonly error: string;
    static readonly NA: FormulaError;
    static readonly VALUE: FormulaError;
    static readonly REF: FormulaError;
    static readonly NAME: FormulaError;
    static readonly NUM: FormulaError;
    static readonly DIV0: FormulaError;
  }

  export interface Token {
    image: string;
    tokenType: { name: string };
  }

  export interface ParserConfig {
    functions?: Record<string, (...args: FunctionArg[]) => unknown>;
    onCell?: (ref: CellRef) => unknown;
    onRange?: (ref: RangeRef) => unknown[][];
    onVariable?: (name: string, sheet: string) => CellRef | RangeRef | null;
  }

  export class DepParser {
    constructor(config: Pick<ParserConfig, "onVariable">);
    parse(formula: string, position: Position, ignoreError?: boolean): (CellRef | RangeRef)[];
    getCell(ref: CellRef): unknown;
    getRange(ref: RangeRef): unknown;
    position: Position;
  }

  export default class FormulaParser {
    constructor(config?: ParserConfig);
    static readonly DepParser: typeof DepParser;
    static readonly FormulaError: typeof FormulaError;
    static readonly MAX_ROW: number;
    static readonly MAX_COLUMN: number;
    readonly functions: Record<string, unknown>;
    position: Position;
    async: boolean;
    parser: { input: Token[]; errors: unknown[]; formulaWithBinaryOp(): unknown };
    parse(formula: string, position: Position, allowReturnArray?: boolean): unknown;
    checkFormulaResult(result: unknown, allowReturnArray?: boolean): unknown;
    supportedFunctions(): string[];
  }
}

declare module "fast-formula-parser/grammar/lexing.js" {
  import type { Token } from "fast-formula-parser";

  const lexing: { lex(text: string): { tokens: Token[] } };
  export default lexing;
}
