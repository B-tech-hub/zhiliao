import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stablePattern = "(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)";
const stableVersion = new RegExp(`^${stablePattern}$`);
const releaseTag = new RegExp(`^v(${stablePattern})(?:-(?:rc|beta|alpha)(?:[1-9][0-9]*|\\.(?:0|[1-9][0-9]*)))?$`);

/**
 * 只读检查固定分发文件，不扫描或改写历史版本、恢复样例和验收证据。
 * @param {{ root?: string, tag?: string }} [options]
 */
export function checkReleaseVersion({ root = projectRoot, tag } = {}) {
  function read(file, parse = (source) => source) {
    try {
      return parse(fs.readFileSync(path.join(root, file), "utf8"));
    } catch (error) {
      throw new Error(`${file} 无法读取或解析：${error.message}`);
    }
  }

  const version = read("package.json", JSON.parse)?.version;
  if (typeof version !== "string" || version.match(stableVersion)?.[0] !== version) {
    throw new Error("package.json.version 必须是完整的正式基础版本，例如 0.6.1");
  }
  const errors = [];
  if (tag !== undefined) {
    const matched = typeof tag === "string" ? tag.match(releaseTag) : null;
    if (!matched || matched[0] !== tag) errors.push("tag 必须为 vX.Y.Z 或对应的 rc/beta/alpha 版本，例如 v0.6.1-rc1");
    else if (matched[1] !== version) errors.push(`tag ${tag} 的基础版本与 package.json ${version} 不一致`);
  }

  const lock = read("package-lock.json", JSON.parse);
  for (const [name, value] of [
    ["package-lock.json.version", lock?.version],
    ['package-lock.json.packages[""].version', lock?.packages?.[""]?.version],
  ]) {
    if (value !== version) errors.push(`${name} 应为 ${version}，实际为 ${String(value)}`);
  }

  const image = `ghcr.io/b-tech-hub/zhiliao:${version}`;
  for (const [file, services] of [
    ["docker-compose.yml", ["app"]],
    ["docker-compose.demo.yml", ["app", "mockllm"]],
  ]) {
    const compose = read(file, YAML.parse);
    for (const service of services) {
      const actual = compose?.services?.[service]?.image;
      if (actual !== image) errors.push(`${file} services.${service}.image 应为 ${image}，实际为 ${String(actual)}`);
    }
  }
  const windows = read("docker-compose.win.yml", YAML.parse);
  const windowsImage = windows?.services?.app?.image;
  if (windowsImage !== undefined && windowsImage !== image) {
    errors.push(`docker-compose.win.yml 覆盖了应用版本，应继承主文件或固定为 ${image}`);
  }

  const notes = `docs/releases/v${version}.md`;
  const notesHeading = read(notes).split(/\r?\n/).find((line) => line.startsWith("# "));
  const escapedVersion = version.replaceAll(".", "\\.");
  if (!notesHeading || !new RegExp(`^# v${escapedVersion}(?:\\s|[：:（(]|$)`).test(notesHeading)) {
    errors.push(`${notes} 的一级标题必须标明 v${version}`);
  }
  const changelogHeading = read("CHANGELOG.md").split(/\r?\n/).find((line) => line.startsWith("## "));
  if (changelogHeading !== `## [未发布] - ${version} 候选`
    && !new RegExp(`^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`).test(changelogHeading ?? "")) {
    errors.push(`CHANGELOG.md 首个版本段必须为 ${version}，或「## [未发布] - ${version} 候选」`);
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return { version, image, notes, ...(tag === undefined ? {} : { tag }) };
}

function main(args) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--tag" || !args[1])) {
    throw new Error("用法：node scripts/check-release-version.mjs [--tag vX.Y.Z[-rc1]]");
  }
  const result = checkReleaseVersion({ tag: args[1] });
  console.log(`版本一致：${result.version}${result.tag ? `（${result.tag}）` : ""}；发布材料：${result.notes}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`版本校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
