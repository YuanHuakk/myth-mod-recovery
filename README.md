# 神话 Mod 源码恢复工具

支持神话书说主题（1991746508）和人物（1699194522），自动识别加载器，恢复源码及全部资源。

## 环境

Windows x64、Node.js 18.3+、PowerShell 5.1/7、VC++ x64 运行库。
已内置 Lua DLL，无需安装 DST 或 npm 依赖。

## 使用

在工程根目录执行，将输入与安装路径替换为实际目录：

```powershell
node "./bin/myth-recover.js" recover --input "原 Mod 目录" --output "./output/new-run"
node "./bin/myth-recover.js" verify --output "./output/new-run"
node "./bin/myth-recover.js" install --output "./output/new-run" --target "游戏目录/mods/myth_local"
node "./bin/myth-recover.js" --help
```

恢复和安装目标须为新目录。安装会追加本地测试标识；游戏测试时同时启用主题与人物本地版，关闭对应工坊版并重启。

默认使用内置 DLL；外部版本可用 `--lua-dll` 或 `--game-root` 指定，前者优先。

## 输出

- `decoded/`：明文源码。
- `restored/`：包含全部资源的完整 Mod。
- `audit/` 与 JSON 报告：字节复算、文件哈希和编译结果。
