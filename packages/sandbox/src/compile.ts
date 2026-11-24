import { build, type Plugin } from "esbuild";

export class ExtensionCompileError extends Error {
  constructor(readonly issues: string[]) {
    super(`The extension doesn't compile: ${issues.join("; ")}`);
  }
}

const virtualFiles = (files: Record<string, string>): Plugin => ({
  name: "extension-files",
  setup(esbuild) {
    esbuild.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return { path: args.path, namespace: "extension" };

      if (!args.path.startsWith(".")) {
        return { errors: [{ text: `Imports must be files in the extension, not "${args.path}"` }] };
      }

      const base = new URL(args.path, `file:///${args.importer}`).pathname.slice(1);

      const found = [base, `${base}.ts`, `${base}/index.ts`].find(
        (candidate) => candidate in files,
      );

      return found
        ? { path: found, namespace: "extension" }
        : { errors: [{ text: `Can't find ${args.path} from ${args.importer}` }] };
    });

    esbuild.onLoad({ filter: /.*/, namespace: "extension" }, (args) => ({
      contents: files[args.path] ?? "",
      loader: "ts",
    }));
  },
});

/** Publish-time: bundles an extension's TypeScript files into one self-contained ES module. */
export async function compileExtension(
  files: Record<string, string>,
  entry = "index.ts",
): Promise<{ code: string; warnings: string[] }> {
  if (!(entry in files)) throw new ExtensionCompileError([`Missing entry file ${entry}`]);

  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2023",
      logLevel: "silent",
      plugins: [virtualFiles(files)],
    });

    return {
      code: result.outputFiles[0]?.text ?? "",
      warnings: result.warnings.map((w) => w.text),
    };
  } catch (error) {
    const errors = (error as { errors?: { text: string }[] }).errors;

    throw new ExtensionCompileError(errors?.map((e) => e.text) ?? [String(error)]);
  }
}
