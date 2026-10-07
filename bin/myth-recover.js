#!/usr/bin/env node
import { parseArgs } from "node:util";
import { profiles } from "../src/profiles.js";
import * as pipeline from "../src/pipeline.js";

const help = `神话 Mod 源码恢复工具

node ./bin/myth-recover.js profiles
node ./bin/myth-recover.js recover --input "工坊目录" --output "新输出目录"
node ./bin/myth-recover.js verify --output "输出目录"
node ./bin/myth-recover.js install --output "输出目录" --target "新的本地 Mod 目录"

recover 会自动匹配加载器指纹；可用 --profile words 或 characters 指定配置。
默认使用工程内置的 runtime/win-x64/lua51Original.dll，无需 DST 安装目录。
通用参数：--game-root "游戏目录"、--lua-dll "DLL路径"、--powershell "可执行文件"、--timeout-ms 60000。
verify 可用 --input 指定原文件的新位置。install 可用 --label 指定显示名后缀。
恢复和安装目标必须是新目录；失败批次保留诊断产物。输出不会覆盖原文件。
`;

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(help);
    return;
  }
  const allowed = {
    profiles: ["help"],
    recover: [
      "input",
      "output",
      "profile",
      "game-root",
      "lua-dll",
      "powershell",
      "timeout-ms",
      "help",
    ],
    verify: [
      "input",
      "output",
      "game-root",
      "lua-dll",
      "powershell",
      "timeout-ms",
      "help",
    ],
    install: [
      "input",
      "output",
      "target",
      "label",
      "game-root",
      "lua-dll",
      "powershell",
      "timeout-ms",
      "help",
    ],
  };
  if (!allowed[command]) throw new Error(`未知命令：${command}`);
  const { values } = parseArgs({
    args,
    options: Object.fromEntries(
      allowed[command].map((name) => [
        name,
        { type: name === "help" ? "boolean" : "string" },
      ]),
    ),
  });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  if (command === "profiles") {
    console.log(
      JSON.stringify(
        profiles.map(({ id, workshopId, name, adapter }) => ({
          id,
          workshopId,
          name,
          adapter,
        })),
        null,
        2,
      ),
    );
    return;
  }
  for (const name of command === "recover"
    ? ["input", "output"]
    : command === "install"
      ? ["output", "target"]
      : ["output"]) {
    if (!values[name]) throw new Error(`缺少参数：--${name}`);
  }
  if (
    values["timeout-ms"] &&
    (!/^\d+$/.test(values["timeout-ms"]) ||
      Number(values["timeout-ms"]) < 1 ||
      !Number.isSafeInteger(Number(values["timeout-ms"])))
  ) {
    throw new Error("--timeout-ms 必须是正整数。");
  }
  const options = {
    ...values,
    gameRoot: values["game-root"],
    luaDll: values["lua-dll"],
    timeoutMs: Number(values["timeout-ms"]) || undefined,
  };
  const result = pipeline[command](options, (message) =>
    process.stderr.write(message + "\n"),
  );
  console.log(JSON.stringify({ status: "passed", ...result }, null, 2));
}

try {
  main();
} catch (error) {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
}
