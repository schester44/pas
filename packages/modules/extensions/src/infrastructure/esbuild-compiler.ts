import { compileExtension, ExtensionCompileError } from "@pas/sandbox/compile";
import type { CompileResult, ExtensionCompiler } from "../ports/services";

export class EsbuildExtensionCompiler implements ExtensionCompiler {
  async compile(files: Record<string, string>, entry: string): Promise<CompileResult> {
    try {
      return { ok: true, ...(await compileExtension(files, entry)) };
    } catch (error) {
      if (error instanceof ExtensionCompileError) return { ok: false, issues: error.issues };

      throw error;
    }
  }
}
