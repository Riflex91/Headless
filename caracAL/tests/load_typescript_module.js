"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const moduleCache = new Map();

function localTypeScriptDependency(parentFile, request) {
  if (!request.startsWith(".")) return null;

  const candidate = path.resolve(path.dirname(parentFile), `${request}.ts`);
  return fs.existsSync(candidate) ? candidate : null;
}

function loadTypeScriptModule(filePath) {
  const absolutePath = path.resolve(filePath);
  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  const result = ts.transpileModule(source, {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      strict: true,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });

  const diagnostics = result.diagnostics || [];
  if (diagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    throw new Error(formatted);
  }

  const loaded = new Module(absolutePath, module);
  loaded.filename = absolutePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(absolutePath));
  moduleCache.set(absolutePath, loaded);

  const defaultRequire = loaded.require.bind(loaded);
  loaded.require = (request) => {
    const localDependency = localTypeScriptDependency(absolutePath, request);
    if (localDependency) {
      return loadTypeScriptModule(localDependency);
    }
    return defaultRequire(request);
  };

  try {
    loaded._compile(result.outputText, absolutePath);
  } catch (error) {
    moduleCache.delete(absolutePath);
    throw error;
  }

  return loaded.exports;
}

module.exports = {
  loadTypeScriptModule,
};
