import { hash } from "./files.js";

function decodeStage(source, profile) {
  const alphabet = new Map(profile.alphabet);
  const bytes = [];
  let accumulator = 0;
  let count = 0;
  for (let index = 0; index < source.length; index++) {
    const key = source[index];
    if (alphabet.has(key)) {
      accumulator += alphabet.get(key) * 64 ** (3 - count++);
      if (count === 4) {
        bytes.push(
          Math.floor(accumulator / 65536) & 255,
          Math.floor((accumulator % 65536) / 256),
          accumulator % 256,
        );
        accumulator = 0;
        count = 0;
      }
    } else if (key === 61) {
      bytes.push(Math.floor(accumulator / 65536) & 255);
      if (source[index + 1] !== 61)
        bytes.push(Math.floor((accumulator % 65536) / 256));
      break;
    }
  }
  const result = Buffer.from(bytes);
  if (hash(result) !== profile.stageHash)
    throw new Error("第二层解码结果与加载器配置不匹配。");
  return result;
}

function patchStage(stage, profile) {
  let source = stage.toString("utf8");
  for (const patch of profile.patches) {
    if (source.split(patch.find).length !== 2)
      throw new Error(`加载器补丁锚点不唯一：${patch.find}`);
    source = source.replace(patch.find, patch.replace);
  }
  return source;
}

function reverseDecode(source, symbols, outputHex) {
  const output = Buffer.from(outputHex, "hex");
  if (
    output.length !== symbols.length ||
    new Set(symbols).size !== symbols.length
  )
    throw new Error("加载器字节映射不完整。");
  const mapping = new Map(
    symbols.map((symbol, index) => [symbol, output[output.length - 1 - index]]),
  );
  const result = Buffer.alloc(source.length);
  for (let index = 0; index < source.length; index++) {
    if (!mapping.has(source[index]))
      throw new Error(`密文包含未捕获的字节：${source[index]}`);
    result[source.length - 1 - index] = mapping.get(source[index]);
  }
  return result;
}

export { decodeStage, patchStage, reverseDecode };
