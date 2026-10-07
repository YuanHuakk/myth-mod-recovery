import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash, readJson } from "./files.js";

const directory = fileURLToPath(new URL("../profiles/", import.meta.url));
const profiles = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => readJson(path.join(directory, file)));

function selectProfile(input, requested) {
  const candidates = requested
    ? profiles.filter((profile) => profile.id === requested)
    : profiles;
  if (!candidates.length) throw new Error(`未知配置：${requested}`);
  const matches = candidates.filter((profile) =>
    Object.entries(profile.loaderHashes).every(([file, expected]) => {
      const source = path.join(input, file);
      return (
        fs.existsSync(source) && hash(fs.readFileSync(source)) === expected
      );
    }),
  );
  if (matches.length !== 1)
    throw new Error(
      "加载器指纹与已有配置不匹配；请检查输入目录或为新版本增加配置。",
    );
  return matches[0];
}

export { profiles, selectProfile };
