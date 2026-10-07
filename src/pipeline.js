import fs from "node:fs";
import path from "node:path";
import {
  hash,
  readJson,
  walk,
  put,
  writeJson,
  newDirectory,
  snapshot,
  checkSnapshot,
} from "./files.js";
import { selectProfile } from "./profiles.js";
import { decodeStage, reverseDecode } from "./codec.js";
import { literal, runtime, runLoader, compile } from "./lua.js";
const { version } = readJson(new URL("../package.json", import.meta.url));
const utf8 = new TextDecoder("utf-8", { fatal: true });

function businessFiles(inputFiles, profile) {
  const files = inputFiles
    .map((file) => file.path)
    .filter(
      (file) =>
        file.toLowerCase().endsWith(".lua") &&
        !profile.excludeLua.includes(file),
    );
  for (const entry of Object.keys(profile.entryMapping)) {
    if (!files.includes(entry)) throw new Error(`入口文件缺失：${entry}`);
  }
  return files;
}

function stageFromInput(input, profile) {
  return decodeStage(
    fs.readFileSync(path.join(input, profile.stageFile)),
    profile,
  );
}

function symbolsFromInput(input, files) {
  const symbols = new Set();
  for (const file of files)
    for (const byte of fs.readFileSync(path.join(input, file)))
      symbols.add(byte);
  return [...symbols].sort((a, b) => a - b);
}

function captureMapping(output, name, profile, input, files, stage, engine) {
  const symbols = symbolsFromInput(input, files);
  const outputHex = runLoader(
    output,
    name,
    "mapping",
    profile,
    input,
    files,
    stage,
    symbols,
    engine,
  ).trim();
  if (!/^[0-9A-F]+$/.test(outputHex) || outputHex.length !== symbols.length * 2)
    throw new Error("原加载器返回的映射格式错误。");
  return { symbols, outputHex };
}

function buildRestored(output, input, inputFiles, files, profile) {
  const restored = path.join(output, "restored");
  const manifestFiles = [];
  function copy(relative, data, source) {
    utf8.decode(data);
    put(restored, relative, data);
    manifestFiles.push({
      path: relative,
      source,
      bytes: data.length,
      sha256: hash(data),
    });
  }
  for (const file of inputFiles) {
    if (file.path === "mod.manifest") continue;
    if (
      file.path === "modinfo.lua" ||
      !file.path.toLowerCase().endsWith(".lua")
    ) {
      const bytes = fs.readFileSync(path.join(input, file.path));
      if (hash(bytes) !== file.sha256)
        throw new Error(`原文件已变化：${file.path}`);
      put(restored, file.path, bytes);
      manifestFiles.push({ ...file, source: file.path });
    }
  }
  for (const file of files)
    copy(
      profile.entryMapping[file] || file,
      fs.readFileSync(path.join(output, "decoded", file)),
      file,
    );
  manifestFiles.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return {
    schemaVersion: 1,
    toolVersion: version,
    profile: profile.id,
    businessFiles: files.length,
    luaFiles: manifestFiles.filter((file) =>
      file.path.toLowerCase().endsWith(".lua"),
    ).length,
    resourceFiles: manifestFiles.filter(
      (file) => !file.path.toLowerCase().endsWith(".lua"),
    ).length,
    bytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0),
    entryMapping: profile.entryMapping,
    files: manifestFiles,
    gameRuntimeChecked: false,
  };
}

function checkRuntimeFiles(output, manifest) {
  checkSnapshot(
    path.join(output, "restored"),
    manifest.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  );
}

function verifyRecords(output, input, report, profile, mapping) {
  const records = report.files.map((record) => {
    const original = fs.readFileSync(path.join(input, record.path));
    const decoded = fs.readFileSync(path.join(output, "decoded", record.path));
    const restored = fs.readFileSync(
      path.join(
        output,
        "restored",
        profile.entryMapping[record.path] || record.path,
      ),
    );
    const independent = reverseDecode(
      original,
      mapping.symbols,
      mapping.outputHex,
    );
    if (
      hash(original) !== record.originalSHA256 ||
      hash(decoded) !== record.decodedSHA256 ||
      !independent.equals(decoded) ||
      !independent.equals(restored)
    ) {
      throw new Error(`原加载器与独立复算结果不一致：${record.path}`);
    }
    return {
      path: record.path,
      bytes: decoded.length,
      sha256: hash(decoded),
      matches: true,
    };
  });
  const actual = walk(path.join(output, "decoded"));
  if (
    JSON.stringify(actual) !==
    JSON.stringify(report.files.map((file) => file.path).sort())
  )
    throw new Error("解码目录文件列表发生变化。");
  return {
    schemaVersion: 1,
    toolVersion: version,
    profile: profile.id,
    method:
      "Original loader capture compared with independent byte substitution and reversal",
    files: records.length,
    matches: records.length,
    bytes: records.reduce((sum, record) => sum + record.bytes, 0),
    cipherSymbols: mapping.symbols.length,
    records,
    gameRuntimeChecked: false,
  };
}

function recover(options, log) {
  const input = fs.realpathSync(path.resolve(options.input));
  const output = path.resolve(options.output);
  const profile = selectProfile(input, options.profile);
  const engine = runtime(options);
  const inputFiles = snapshot(input);
  const files = businessFiles(inputFiles, profile);
  const stage = stageFromInput(input, profile);
  newDirectory(output, [input]);
  const state = {
    schemaVersion: 1,
    status: "running",
    profile: profile.id,
    input,
  };
  writeJson(path.join(output, "state.json"), state);
  try {
    log(`配置：${profile.name}；待还原 ${files.length} 个业务文件`);
    put(output, "stages/modmain0.lua", stage);
    compile(
      output,
      "compile-stage",
      [path.join(output, "stages/modmain0.lua")],
      engine,
    );
    for (const file of files)
      fs.mkdirSync(path.dirname(path.join(output, "decoded", file)), {
        recursive: true,
      });
    const captured = runLoader(
      output,
      "recover",
      "recover",
      profile,
      input,
      files,
      stage,
      [],
      engine,
    );
    const rows = captured
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    if (
      rows.length !== files.length ||
      new Set(rows.map((row) => row[0])).size !== files.length
    )
      throw new Error("原加载器未捕获全部业务文件。");
    const sizes = new Map(rows.map(([file, bytes]) => [file, Number(bytes)]));
    const originalHashes = new Map(
      inputFiles.map((file) => [file.path, file.sha256]),
    );
    const report = {
      schemaVersion: 1,
      toolVersion: version,
      profile: profile.id,
      input,
      runtime: engine,
      inputFiles,
      stageSHA256: hash(stage),
      businessSourcesExecuted: false,
      files: files.map((file) => {
        const decoded = fs.readFileSync(path.join(output, "decoded", file));
        if (decoded.length !== sizes.get(file))
          throw new Error(`捕获字节数不匹配：${file}`);
        utf8.decode(decoded);
        return {
          path: file,
          bytes: decoded.length,
          originalSHA256: originalHashes.get(file),
          decodedSHA256: hash(decoded),
        };
      }),
    };
    const manifest = buildRestored(output, input, inputFiles, files, profile);
    const luaFiles = manifest.files
      .filter((file) => file.path.toLowerCase().endsWith(".lua"))
      .map((file) => path.join(output, "restored", file.path));
    const compiled = compile(output, "compile-restored", luaFiles, engine);
    log(
      `完整副本：${manifest.luaFiles} 个 Lua、${manifest.resourceFiles} 个资源；开始独立复算`,
    );
    const mapping = captureMapping(
      output,
      "mapping-recover",
      profile,
      input,
      files,
      stage,
      engine,
    );
    const verification = verifyRecords(output, input, report, profile, mapping);
    checkSnapshot(input, inputFiles);
    checkRuntimeFiles(output, manifest);
    verification.compiledLuaFiles = compiled;
    verification.manifestFiles = manifest.files.length;
    verification.runtime = engine;
    manifest.validation = {
      nativeLuaCompilation: true,
      utf8BusinessSources: true,
      independentDecodeMatches: true,
      resourceHashesMatch: true,
    };
    writeJson(path.join(output, "recovery-report.json"), report);
    writeJson(path.join(output, "restored-manifest.json"), manifest);
    writeJson(path.join(output, "audit/cipher-evidence.json"), {
      ...mapping,
      stageSHA256: hash(stage),
      patches: profile.patches,
      businessSourcesExecuted: false,
    });
    writeJson(
      path.join(output, "audit/recovery-verification.json"),
      verification,
    );
    writeJson(path.join(output, "state.json"), {
      ...state,
      status: "complete",
    });
    return {
      output,
      profile: profile.id,
      businessFiles: files.length,
      luaFiles: manifest.luaFiles,
      resourceFiles: manifest.resourceFiles,
      matches: verification.matches,
    };
  } catch (error) {
    writeJson(path.join(output, "state.json"), {
      ...state,
      status: "failed",
      error: error.message,
    });
    throw error;
  }
}

function verify(options, log) {
  const output = fs.realpathSync(path.resolve(options.output));
  const state = readJson(path.join(output, "state.json"));
  if (state.status !== "complete")
    throw new Error(`恢复批次未完成：${state.status}`);
  const report = readJson(path.join(output, "recovery-report.json"));
  const input = fs.realpathSync(path.resolve(options.input || report.input));
  const profile = selectProfile(input, report.profile);
  const manifest = readJson(path.join(output, "restored-manifest.json"));
  if (
    report.schemaVersion !== 1 ||
    manifest.schemaVersion !== 1 ||
    manifest.profile !== profile.id
  )
    throw new Error("报告版本或配置不匹配。");
  checkSnapshot(input, report.inputFiles);
  checkRuntimeFiles(output, manifest);
  const files = businessFiles(report.inputFiles, profile);
  if (
    JSON.stringify(files) !==
    JSON.stringify(report.files.map((file) => file.path))
  )
    throw new Error("业务文件列表与报告不匹配。");
  const engine = runtime(options);
  const stage = stageFromInput(input, profile);
  if (
    hash(fs.readFileSync(path.join(output, "stages/modmain0.lua"))) !==
    hash(stage)
  )
    throw new Error("保存的第二层载荷发生变化。");
  log(
    `重新运行${profile.name}原加载器，并校验 ${manifest.files.length} 个完整副本文件`,
  );
  const mapping = captureMapping(
    output,
    "mapping-verify",
    profile,
    input,
    files,
    stage,
    engine,
  );
  const result = verifyRecords(output, input, report, profile, mapping);
  const luaFiles = manifest.files
    .filter((file) => file.path.toLowerCase().endsWith(".lua"))
    .map((file) => path.join(output, "restored", file.path));
  result.compiledLuaFiles = compile(output, "compile-verify", luaFiles, engine);
  result.manifestFiles = manifest.files.length;
  result.runtime = engine;
  checkSnapshot(input, report.inputFiles);
  checkRuntimeFiles(output, manifest);
  writeJson(path.join(output, "audit/recovery-verification.json"), result);
  return {
    output,
    profile: profile.id,
    files: result.files,
    matches: result.matches,
    manifestFiles: result.manifestFiles,
    compiledLuaFiles: result.compiledLuaFiles,
  };
}

function install(options, log) {
  const output = fs.realpathSync(path.resolve(options.output));
  const target = path.resolve(options.target);
  if (fs.existsSync(target))
    throw new Error(`安装目标已存在，请指定新目录：${target}`);
  verify(options, log);
  const report = readJson(path.join(output, "recovery-report.json"));
  const manifest = readJson(path.join(output, "restored-manifest.json"));
  const input = fs.realpathSync(path.resolve(options.input || report.input));
  const restored = path.join(output, "restored");
  newDirectory(target, [output, input]);
  const suffix = options.label
    ? literal(` (${options.label})`)
    : `((locale == "zh" or locale == "zhr") and ${literal("（本地测试）")} or " (Local Test)")`;
  const installed = manifest.files.map((file) => {
    let bytes = fs.readFileSync(path.join(restored, file.path));
    if (file.path === "modinfo.lua")
      bytes = Buffer.concat([
        bytes,
        Buffer.from(`\nname = name .. ${suffix}\n`, "utf8"),
      ]);
    put(target, file.path, bytes);
    return { path: file.path, bytes: bytes.length, sha256: hash(bytes) };
  });
  compile(
    output,
    "compile-install",
    [path.join(target, "modinfo.lua")],
    runtime(options),
  );
  checkSnapshot(target, installed);
  writeJson(path.join(output, "audit/install.json"), {
    target,
    files: installed,
    metadataChange: "display-name suffix",
    gameRuntimeChecked: false,
  });
  return {
    target,
    files: installed.length,
    luaFiles: manifest.luaFiles,
    resourceFiles: manifest.resourceFiles,
  };
}

export { recover, verify, install };
