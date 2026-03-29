import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const nextVersion = process.argv[2]?.trim();

if (!nextVersion) {
  console.error("用法: node scripts/set-version.mjs <version>");
  process.exit(1);
}

const jsonFiles = [
  "package.json",
  "src-tauri/tauri.conf.json",
];

const cargoTomlPath = "Cargo.toml";

async function updateJsonVersion(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const versionPattern = /("version"\s*:\s*")([^"]+)(")/;
  if (!versionPattern.test(raw)) {
    throw new Error(`未在 ${relativePath} 中找到 version 字段`);
  }

  const updated = raw.replace(versionPattern, `$1${nextVersion}$3`);
  if (updated === raw) {
    console.log(`skipped ${relativePath}`);
    return;
  }
  await fs.writeFile(absolutePath, updated, "utf8");
  console.log(`updated ${relativePath}`);
}

async function updateCargoWorkspaceVersion(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const versionPattern = /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/;
  if (!versionPattern.test(raw)) {
    throw new Error(`未在 ${relativePath} 中找到 [workspace.package] version 字段`);
  }

  const updated = raw.replace(versionPattern, `$1${nextVersion}$3`);
  if (updated === raw) {
    console.log(`skipped ${relativePath}`);
    return;
  }
  await fs.writeFile(absolutePath, updated, "utf8");
  console.log(`updated ${relativePath}`);
}

await Promise.all(jsonFiles.map(updateJsonVersion));
await updateCargoWorkspaceVersion(cargoTomlPath);

console.log(`version synced to ${nextVersion}`);
