import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const hash = (data) =>
  crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function walk(root, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`目录中存在特殊文件或链接：${relative}`);
  }
  return files.sort();
}

function put(root, relative, data) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data, { flag: "wx" });
  if (!fs.readFileSync(destination).equals(Buffer.from(data))) {
    throw new Error(`写入校验失败：${relative}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function isInside(parent, child) {
  const relative = path.relative(
    path.resolve(parent).toLowerCase(),
    path.resolve(child).toLowerCase(),
  );
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function newDirectory(destination, sources) {
  for (const source of sources) {
    if (isInside(source, destination) || isInside(destination, source)) {
      throw new Error(`目标目录与来源重叠：${destination}`);
    }
  }
  if (fs.existsSync(destination))
    throw new Error(`目标目录已存在，请指定新目录：${destination}`);
  fs.mkdirSync(destination, { recursive: true });
}

function snapshot(root) {
  return walk(root).map((file) => {
    const bytes = fs.readFileSync(path.join(root, file));
    return { path: file, bytes: bytes.length, sha256: hash(bytes) };
  });
}

function checkSnapshot(root, expected) {
  const actual = snapshot(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`目录文件或哈希发生变化：${root}`);
}

export {
  hash,
  readJson,
  walk,
  put,
  writeJson,
  newDirectory,
  snapshot,
  checkSnapshot,
};
