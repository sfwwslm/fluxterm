/**
 * 文件打开能力。
 * 职责：统一处理本地文件打开，以及远端文件下载到缓存后再打开的流程。
 */
import { join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { info, warn } from "@tauri-apps/plugin-log";
import { callTauri } from "@/shared/tauri/commands";
import {
  getRemoteFileCacheDir as resolveRemoteFileCacheDir,
  getRemoteFilesCacheRootDir as resolveRemoteFilesCacheRootDir,
} from "@/shared/config/paths";
import type { SftpEntry } from "@/types";
import { sftpDownload } from "@/features/sftp/core/commands";
import { extractErrorMessage } from "@/shared/errors/appError";

const REMOTE_FILE_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REMOTE_FILE_CACHE_CLEANUP_MARKER = ".cleanup-meta.json";
const REMOTE_FILE_INSTANCE_META = ".fluxterm-remote.json";

function sanitizeFileName(name: string) {
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return sanitized || "file";
}

/** 获取远端文件缓存目录。 */
async function getRemoteFileCacheDir(sessionId: string) {
  return resolveRemoteFileCacheDir(sessionId);
}

async function getRemoteFileCacheRootDir() {
  return resolveRemoteFilesCacheRootDir();
}

function getCleanupDayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function buildInstanceDirName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}`;
}

async function getRemoteFileCacheCleanupMarkerPath() {
  const rootDir = await getRemoteFileCacheRootDir();
  return join(rootDir, REMOTE_FILE_CACHE_CLEANUP_MARKER);
}

async function collectExpiredCachePaths(path: string, expiredBefore: number) {
  const entries = await readDir(path);
  const expiredPaths: string[] = [];

  for (const entry of entries) {
    const entryPath = await join(path, entry.name);
    const fileInfo = await stat(entryPath);

    if (entry.isDirectory) {
      const modifiedAt = fileInfo.mtime?.getTime();
      if (modifiedAt !== undefined && modifiedAt < expiredBefore) {
        expiredPaths.push(entryPath);
        continue;
      }
      expiredPaths.push(
        ...(await collectExpiredCachePaths(entryPath, expiredBefore)),
      );
      continue;
    }

    const modifiedAt = fileInfo.mtime?.getTime();
    if (modifiedAt !== undefined && modifiedAt < expiredBefore) {
      expiredPaths.push(entryPath);
    }
  }

  return expiredPaths;
}

/**
 * 清理远端文件缓存目录中过期的旧文件。
 * 第一版只做基于最后修改时间的轻量清理，失败时仅记录日志，不打断当前打开流程。
 */
async function ensureRemoteFileCacheCleanup() {
  const rootDir = await getRemoteFileCacheRootDir();
  const markerPath = await getRemoteFileCacheCleanupMarkerPath();
  const currentDay = getCleanupDayStamp();
  await mkdir(rootDir, { recursive: true });

  try {
    if (await exists(markerPath)) {
      const raw = await readTextFile(markerPath);
      const parsed = JSON.parse(raw) as { lastCleanupDay?: string };
      if (parsed.lastCleanupDay === currentDay) {
        return;
      }
    }
  } catch (error) {
    await warn(
      JSON.stringify({
        event: "remote-file-cache:cleanup-marker-read-failed",
        markerPath,
        message: extractErrorMessage(error),
      }),
    );
  }

  const expiredBefore = Date.now() - REMOTE_FILE_CACHE_RETENTION_MS;
  await info(
    JSON.stringify({
      event: "remote-file-cache:cleanup-start",
      rootDir,
      expiredBefore,
      day: currentDay,
    }),
  );
  try {
    const expiredPaths = await collectExpiredCachePaths(rootDir, expiredBefore);
    for (const expiredPath of expiredPaths) {
      await remove(expiredPath);
    }
    await writeTextFile(
      markerPath,
      JSON.stringify({ lastCleanupDay: currentDay }, null, 2),
    );
    await info(
      JSON.stringify({
        event: "remote-file-cache:cleanup-complete",
        rootDir,
        removedCount: expiredPaths.length,
        day: currentDay,
      }),
    );
  } catch (error) {
    await warn(
      JSON.stringify({
        event: "remote-file-cache:cleanup-failed",
        rootDir,
        message: extractErrorMessage(error),
      }),
    );
  }
}

/** 使用默认编辑器或系统默认程序打开本地文件。 */
export async function openLocalFile(
  filePath: string,
  defaultEditorPath: string,
) {
  return callTauri("file_open", {
    filePath,
    defaultEditorPath: defaultEditorPath.trim() || null,
  });
}

/** 将远端文件下载到本地缓存目录后打开。 */
export async function openRemoteFileViaCache(
  sessionId: string,
  entry: SftpEntry,
  defaultEditorPath: string,
) {
  await ensureRemoteFileCacheCleanup();
  const cacheDir = await getRemoteFileCacheDir(sessionId);
  const instanceDir = await join(cacheDir, buildInstanceDirName());
  await mkdir(instanceDir, { recursive: true });
  const localPath = await join(instanceDir, sanitizeFileName(entry.name));
  const metaPath = await join(instanceDir, REMOTE_FILE_INSTANCE_META);
  await sftpDownload(sessionId, entry.path, localPath);
  await writeTextFile(
    metaPath,
    JSON.stringify(
      {
        sessionId,
        remotePath: entry.path,
        fileName: entry.name,
        downloadedAt: Date.now(),
      },
      null,
      2,
    ),
  );
  await openLocalFile(localPath, defaultEditorPath);
}
