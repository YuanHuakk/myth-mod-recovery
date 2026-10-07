import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hash, writeJson, readJson } from "./files.js";
import { patchStage } from "./codec.js";

const bridgeScript = fileURLToPath(
  new URL("../runtime/bridge.ps1", import.meta.url),
);
const loaderTemplate = new URL("../runtime/loader.lua", import.meta.url);
const bundledDll = fileURLToPath(new URL("../runtime/win-x64/lua51Original.dll", import.meta.url));

function literal(value) {
  if (typeof value === "string")
    return (
      '"' +
      [...Buffer.from(value, "utf8")]
        .map((byte) => "\\" + String(byte).padStart(3, "0"))
        .join("") +
      '"'
    );
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return "{" + value.map(literal).join(",") + "}";
  return (
    "{" +
    Object.entries(value)
      .map(([key, item]) => `[${literal(key)}]=${literal(item)}`)
      .join(",") +
    "}"
  );
}

function runtime(options = {}) {
  if (process.platform !== "win32")
    throw new Error("当前原生桥接器运行于 Windows。");
  const dll = path.resolve(
    options.luaDll ||
      (options.gameRoot
        ? path.join(options.gameRoot, "bin64/lua51Original.dll")
        : bundledDll),
  );
  if (!fs.existsSync(dll))
    throw new Error(`未找到 Lua DLL，请指定 --game-root 或 --lua-dll：${dll}`);
  return {
    dll,
    dllSHA256: hash(fs.readFileSync(dll)),
    powershell: options.powershell || "powershell.exe",
    timeoutMs: options.timeoutMs || 60000,
  };
}

function bridge(output, name, request, engine) {
  const directory = path.join(output, ".work");
  fs.mkdirSync(directory, { recursive: true });
  const requestPath = path.join(directory, `${name}.json`);
  const resultPath = path.join(directory, `${name}.result`);
  writeJson(requestPath, { ...request, dll: engine.dll });
  const result = spawnSync(
    engine.powershell,
    [
      "-NoProfile",
      "-File",
      bridgeScript,
      "-RequestPath",
      requestPath,
      "-ResultPath",
      resultPath,
    ],
    {
      encoding: "utf8",
      timeout: engine.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error)
    throw new Error(`Lua 桥接进程失败：${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`Lua 桥接失败：${(result.stderr || result.stdout).trim()}`);
  return fs.readFileSync(resultPath, "utf8");
}

function runLoader(
  output,
  name,
  mode,
  profile,
  input,
  files,
  stage,
  symbols,
  engine,
) {
  const config = {
    mode,
    adapter: profile.adapter,
    workshopId: profile.workshopId,
    root: input.replaceAll("\\", "/").replace(/\/$/, "") + "/",
    output: path.join(output, "decoded").replaceAll("\\", "/") + "/",
    files,
    symbols,
    stage: patchStage(stage, profile),
  };
  const template = fs.readFileSync(loaderTemplate, "utf8");
  const script = path.join(output, ".work", `${name}.lua`);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(
    script,
    template.replace("__RECOVERY_CONFIG__", () => literal(config)),
    "utf8",
  );
  return bridge(output, name, { mode: "execute", script }, engine);
}

function compile(output, name, files, engine) {
  bridge(output, name, { mode: "compile", files }, engine);
  const result = readJson(path.join(output, ".work", `${name}.result`));
  if (result.errors.length || result.compiledFiles !== files.length)
    throw new Error("Lua 编译检查未完成。");
  return result.compiledFiles;
}

export { literal, runtime, runLoader, compile };
