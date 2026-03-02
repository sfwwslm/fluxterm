/**
 * 统计项目代码行数。
 *
 * 默认只统计代码文件：
 * - TypeScript (.ts)
 * - TSX (.tsx)
 * - Rust (.rs)
 * - CSS (.css)
 *
 * 默认忽略：
 * - node_modules / dist / target / docs / public / .git 等目录
 * - .d.ts 声明文件
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * @typedef {"TypeScript" | "TSX" | "Rust" | "CSS"} LanguageKind
 */

/**
 * @typedef {{
 *   totalLines: number;
 *   blankLines: number;
 *   commentLines: number;
 *   codeLines: number;
 * }} FileLineStats
 */

/**
 * @typedef {FileLineStats & {
 *   files: number;
 *   language: LanguageKind;
 * }} LanguageSummary
 */

/** @type {ReadonlySet<string>} */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "dist",
  "dist-ssr",
  "docs",
  "node_modules",
  "public",
  "target",
]);

/** @type {ReadonlyMap<string, LanguageKind>} */
const LANGUAGE_BY_EXTENSION = new Map([
  [".ts", "TypeScript"],
  [".tsx", "TSX"],
  [".rs", "Rust"],
  [".css", "CSS"],
]);

/**
 * 判断目录是否应被忽略。
 * @param {string} name
 */
function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name);
}

/**
 * 根据扩展名判断语言类型。
 * @param {string} filePath
 * @returns {LanguageKind | null}
 */
function detectLanguage(filePath) {
  if (filePath.endsWith(".d.ts")) {
    return null;
  }
  return LANGUAGE_BY_EXTENSION.get(path.extname(filePath)) ?? null;
}

/**
 * 递归收集需要统计的文件。
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
async function collectFiles(rootDir) {
  /** @type {string[]} */
  const files = [];
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) continue;
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!detectLanguage(fullPath)) continue;
    files.push(fullPath);
  }

  return files;
}

/**
 * 创建空统计对象。
 * @returns {FileLineStats}
 */
function createEmptyStats() {
  return {
    totalLines: 0,
    blankLines: 0,
    commentLines: 0,
    codeLines: 0,
  };
}

/**
 * 统计单个文件的行数信息。
 * @param {string} filePath
 * @param {LanguageKind} language
 * @returns {Promise<FileLineStats>}
 */
async function countFileLines(filePath, language) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  return countCommentAndCodeLines(lines, language);
}

/**
 * 按语言规则统计代码/注释/空行。
 * 采用工程化近似统计：
 * - 纯注释行算 comment
 * - 行尾注释所在行算 code
 * - 块注释逐行计 comment
 *
 * @param {string[]} lines
 * @param {LanguageKind} language
 * @returns {FileLineStats}
 */
function countCommentAndCodeLines(lines, language) {
  const stats = createEmptyStats();
  let inBlockComment = false;

  for (const line of lines) {
    stats.totalLines += 1;
    const trimmed = line.trim();

    if (!trimmed) {
      stats.blankLines += 1;
      continue;
    }

    if (inBlockComment) {
      stats.commentLines += 1;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (isLineComment(trimmed, language)) {
      stats.commentLines += 1;
      continue;
    }

    if (trimmed.startsWith("/*")) {
      stats.commentLines += 1;
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    stats.codeLines += 1;

    if (hasBlockCommentStart(trimmed)) {
      const startIndex = trimmed.indexOf("/*");
      const endIndex = trimmed.indexOf("*/", startIndex + 2);
      if (endIndex === -1) {
        inBlockComment = true;
      }
    }
  }

  return stats;
}

/**
 * 判断是否是整行注释。
 * @param {string} trimmed
 * @param {LanguageKind} language
 */
function isLineComment(trimmed, language) {
  if (trimmed.startsWith("//")) return true;
  if (
    language === "Rust" &&
    (trimmed.startsWith("//!") || trimmed.startsWith("///"))
  ) {
    return true;
  }
  return false;
}

/**
 * 判断代码行里是否含有块注释起点。
 * @param {string} trimmed
 */
function hasBlockCommentStart(trimmed) {
  const startIndex = trimmed.indexOf("/*");
  if (startIndex === -1) return false;
  const endIndex = trimmed.indexOf("*/", startIndex + 2);
  return endIndex === -1;
}

/**
 * 将一个文件统计合并到另一个对象。
 * @param {FileLineStats} target
 * @param {FileLineStats} next
 */
function mergeStats(target, next) {
  target.totalLines += next.totalLines;
  target.blankLines += next.blankLines;
  target.commentLines += next.commentLines;
  target.codeLines += next.codeLines;
}

/**
 * 数字格式化为右对齐字符串。
 * @param {number} value
 * @param {number} width
 */
function padNumber(value, width) {
  return String(value).padStart(width, " ");
}

/**
 * 文本格式化为左对齐字符串。
 * @param {string} value
 * @param {number} width
 */
function padText(value, width) {
  return value.padEnd(width, " ");
}

/**
 * 计算部分在总体中的百分比。
 * @param {number} part
 * @param {number} total
 */
function formatPercentValue(part, total) {
  if (total === 0) {
    return "0.0%";
  }
  return `${((part / total) * 100).toFixed(1)}%`;
}

/**
 * 右对齐百分比文本。
 * @param {string} value
 * @param {number} width
 */
function padPercent(value, width) {
  return value.padStart(width, " ");
}

/**
 * 生成语言汇总表格。
 * @param {LanguageSummary[]} rows
 * @param {number} totalCodeLines
 */
function formatLanguageTable(rows, totalCodeLines) {
  const languageWidth = Math.max(
    "Language".length,
    ...rows.map((row) => row.language.length),
  );
  const fileWidth = Math.max(
    "Files".length,
    ...rows.map((row) => String(row.files).length),
  );
  const totalWidth = Math.max(
    "Total".length,
    ...rows.map((row) => String(row.totalLines).length),
  );
  const codeWidth = Math.max(
    "Code".length,
    ...rows.map((row) => String(row.codeLines).length),
  );
  const commentWidth = Math.max(
    "Comment".length,
    ...rows.map((row) => String(row.commentLines).length),
  );
  const blankWidth = Math.max(
    "Blank".length,
    ...rows.map((row) => String(row.blankLines).length),
  );
  const codePercentValues = rows.map((row) =>
    formatPercentValue(row.codeLines, totalCodeLines),
  );
  const codePercentWidth = Math.max(
    "Code %".length,
    ...codePercentValues.map((value) => value.length),
  );

  const lines = [
    [
      padText("Language", languageWidth),
      padNumber("Files", fileWidth),
      padNumber("Total", totalWidth),
      padNumber("Code", codeWidth),
      padNumber("Comment", commentWidth),
      padNumber("Blank", blankWidth),
      padPercent("Code %", codePercentWidth),
    ].join("  "),
  ];

  for (const [index, row] of rows.entries()) {
    const codePercent = codePercentValues[index];
    lines.push(
      [
        padText(row.language, languageWidth),
        padNumber(row.files, fileWidth),
        padNumber(row.totalLines, totalWidth),
        padNumber(row.codeLines, codeWidth),
        padNumber(row.commentLines, commentWidth),
        padNumber(row.blankLines, blankWidth),
        padPercent(codePercent, codePercentWidth),
      ].join("  "),
    );
  }

  return lines.join("\n");
}

async function main() {
  const rootDir = process.cwd();
  const files = await collectFiles(rootDir);
  /** @type {Map<LanguageKind, LanguageSummary>} */
  const summaries = new Map();
  const total = createEmptyStats();
  let skippedFiles = 0;

  for (const filePath of files) {
    const language = detectLanguage(filePath);
    if (!language) continue;

    try {
      const stats = await countFileLines(filePath, language);
      mergeStats(total, stats);
      const existing = summaries.get(language) ?? {
        language,
        files: 0,
        ...createEmptyStats(),
      };
      existing.files += 1;
      mergeStats(existing, stats);
      summaries.set(language, existing);
    } catch (error) {
      skippedFiles += 1;
      console.warn(
        `[warn] skipped file: ${path.relative(rootDir, filePath)} (${String(error)})`,
      );
    }
  }

  const languageRows = Array.from(summaries.values()).sort(
    (left, right) => right.codeLines - left.codeLines,
  );

  const totalCodePercent = formatPercentValue(
    total.codeLines,
    total.totalLines,
  );
  const totalCommentPercent = formatPercentValue(
    total.commentLines,
    total.totalLines,
  );
  const totalBlankPercent = formatPercentValue(
    total.blankLines,
    total.totalLines,
  );

  console.log("FluxTerm Code Stats");
  console.log(`Root: ${rootDir}`);
  console.log("");
  console.log(`Files: ${files.length - skippedFiles}`);
  console.log(`Total lines: ${total.totalLines}`);
  console.log(`Code lines: ${total.codeLines} (${totalCodePercent})`);
  console.log(`Comment lines: ${total.commentLines} (${totalCommentPercent})`);
  console.log(`Blank lines: ${total.blankLines} (${totalBlankPercent})`);
  if (skippedFiles > 0) {
    console.log(`Warnings: ${skippedFiles} file(s) skipped`);
  }
  console.log("");
  console.log("By language");
  console.log(formatLanguageTable(languageRows, total.codeLines));
}

main().catch((error) => {
  console.error("[error] failed to count code lines");
  console.error(error);
  process.exitCode = 1;
});
