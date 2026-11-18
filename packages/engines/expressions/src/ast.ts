// ZEN exposes its AST only as a Rust Debug string; parsing it keeps us aligned with the engine's own parser.
export type DebugNode =
  | { t: "struct"; name: string; fields: Record<string, DebugNode> }
  | { t: "tuple"; name: string; items: DebugNode[] }
  | { t: "unit"; name: string }
  | { t: "list"; items: DebugNode[] }
  | { t: "str"; value: string }
  | { t: "num"; value: string };

export function parseDebug(source: string): DebugNode {
  let i = 0;

  const fail = (message: string): never => {
    throw new Error(`Unreadable expression AST (${message} at ${i})`);
  };

  const skip = () => {
    while (i < source.length && /\s/.test(source[i]!)) i++;
  };

  const peek = () => {
    skip();

    return source[i];
  };

  const expect = (char: string) => {
    if (peek() !== char) fail(`expected '${char}'`);

    i++;
  };

  const ident = () => {
    skip();
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));

    if (!match) return fail("expected identifier");

    i += match[0].length;

    return match[0];
  };

  const string = () => {
    expect('"');
    let out = "";

    while (i < source.length) {
      const char = source[i++]!;

      if (char === '"') return out;

      if (char !== "\\") {
        out += char;
        continue;
      }

      const esc = source[i++];

      if (esc === "n") out += "\n";
      else if (esc === "t") out += "\t";
      else if (esc === "r") out += "\r";
      else if (esc === "0") out += "\0";
      else if (esc === "u") {
        const match = /^\{([0-9a-fA-F]+)\}/.exec(source.slice(i));

        if (!match) fail("bad unicode escape");

        out += String.fromCodePoint(Number.parseInt(match![1]!, 16));
        i += match![0].length;
      } else out += esc ?? "";
    }

    return fail("unterminated string");
  };

  const sequence = (close: string): DebugNode[] => {
    const items: DebugNode[] = [];

    while (peek() !== close) {
      items.push(value());

      if (peek() === ",") i++;
      else if (peek() !== close) fail(`expected ',' or '${close}'`);
    }

    i++;

    return items;
  };

  const value = (): DebugNode => {
    const char = peek();

    if (char === '"') return { t: "str", value: string() };

    if (char === "[") {
      i++;

      return { t: "list", items: sequence("]") };
    }

    if (char === "(") {
      i++;

      return { t: "tuple", name: "", items: sequence(")") };
    }

    if (char !== undefined && /[-0-9]/.test(char)) {
      const match = /^-?[0-9][0-9._eE+-]*/.exec(source.slice(i));

      if (!match) return fail("bad number");

      i += match[0].length;

      return { t: "num", value: match[0] };
    }

    const name = ident();

    if (peek() === "{") {
      i++;
      const fields: Record<string, DebugNode> = {};

      while (peek() !== "}") {
        const key = ident();
        expect(":");
        fields[key] = value();

        if (peek() === ",") i++;
      }

      i++;

      return { t: "struct", name, fields };
    }

    if (peek() === "(") {
      i++;

      return { t: "tuple", name, items: sequence(")") };
    }

    return { t: "unit", name };
  };

  const root = value();

  if (peek() !== undefined) fail("trailing input");

  return root;
}

export interface PathOptions {
  aliases?: Record<string, string | null>;
}

interface Env {
  aliases: Record<string, string | null>;
  pointer: string | null;
}

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

export function collectPaths(ast: DebugNode, options: PathOptions = {}): string[] {
  const found = new Set<string>();

  const add = (path: string | null) => {
    if (path) found.add(path);
  };

  const pathOf = (node: DebugNode, env: Env): string | null | undefined => {
    if (node.t === "unit") {
      if (node.name === "Root") return "";

      if (node.name === "Pointer") return env.pointer;

      return undefined;
    }

    if (node.t === "tuple") {
      const [first] = node.items;

      if (node.name === "Identifier" && first?.t === "str") {
        const name = first.value;

        if (Object.hasOwn(env.aliases, name)) return env.aliases[name] ?? null;

        return name;
      }

      if (node.name === "Parenthesized" && first) return pathOf(first, env);

      return undefined;
    }

    if (node.t !== "struct") return undefined;

    if (node.name === "Member") {
      const target = node.fields.node!;
      const property = node.fields.property!;
      let base = pathOf(target, env);

      if (base === undefined) {
        base = closureSource(target, env);

        if (base === undefined) {
          visit(target, env);
          base = null;
        }
      }

      if (property.t === "tuple" && property.name === "String" && property.items[0]?.t === "str") {
        return base === null ? null : join(base, property.items[0].value);
      }

      if (!(property.t === "tuple" && property.name === "Number")) visit(property, env);

      return base === null ? null : `${base}[]`;
    }

    if (node.name === "Slice") {
      for (const key of ["from", "to"]) {
        const bound = node.fields[key];

        if (bound) visit(bound, env);
      }

      return pathOf(node.fields.node!, env) ?? null;
    }

    return undefined;
  };

  const closureSource = (node: DebugNode, env: Env): string | null | undefined => {
    if (node.t !== "struct" || node.name !== "FunctionCall") return undefined;

    const kind = node.fields.kind;

    if (!(kind?.t === "tuple" && kind.name === "Closure" && kind.items[0]?.t === "unit")) {
      return undefined;
    }

    if (kind.items[0].name !== "Filter") return undefined;

    visit(node, env);
    const args = node.fields.arguments;
    const list = args?.t === "list" ? args.items[0] : undefined;

    return list ? (pathOf(list, env) ?? null) : null;
  };

  const visit = (node: DebugNode, env: Env): void => {
    const path = pathOf(node, env);

    if (path !== undefined) {
      add(path);

      return;
    }

    if (node.t === "struct" && node.name === "FunctionCall") {
      const args = node.fields.arguments;

      if (args?.t !== "list") return;

      // `#` inside a closure body is an element of the closure's first argument.
      const [list] = args.items;
      const listPath = list ? pathOf(list, env) : undefined;

      if (list && listPath === undefined) visit(list, env);
      else add(listPath ?? null);

      const element = typeof listPath === "string" ? `${listPath}[]` : null;

      for (const arg of args.items.slice(1)) {
        if (arg.t === "struct" && arg.name === "Closure") {
          const alias = arg.fields.alias;
          const aliases = { ...env.aliases };

          if (alias?.t === "tuple" && alias.name === "Some" && alias.items[0]?.t === "str") {
            aliases[alias.items[0].value] = element;
          }

          visit(arg.fields.body!, { aliases, pointer: element });
        } else visit(arg, env);
      }

      return;
    }

    if (node.t === "struct") {
      for (const child of Object.values(node.fields)) visit(child, env);
    } else if (node.t === "tuple" || node.t === "list") {
      for (const child of node.items) visit(child, env);
    }
  };

  visit(ast, { aliases: options.aliases ?? {}, pointer: null });

  return [...found];
}

export function hasErrorNode(node: DebugNode): boolean {
  if (node.t === "struct") {
    return node.name === "Error" || Object.values(node.fields).some(hasErrorNode);
  }

  if (node.t === "tuple" || node.t === "list") return node.items.some(hasErrorNode);

  return false;
}
