import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BrowserWindow, Menu, WebContentsView, app, dialog, ipcMain, net, shell } from 'electron'
import {
  appMenuLabels,
  configuredDefaultSaveDir,
  contextMenuLabels,
  fetchRemoteImage,
  installContextMenu,
  installNavigationGuard,
  safeExternalUrl,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
  toggleDevToolsItem,
  windowMenuTemplate,
} from '@genoffice/electron-utils'
import { configureMetricsCache, familyVerticalMetrics } from '@genoffice/font-metrics'
import { createI18n, getUiLang, normalizeLang, setUiLang } from '@genoffice/i18n'
import { ProjectStore } from '@genoffice/project-store'
import type {
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents,
} from 'electron'
import { parseFileToText } from '@genoffice/file-parse'
import {
  AiCreditsError,
  AiTimeoutError,
  chatForProvider,
  defaultAiSettings,
  resolveAiSettings,
  setRescueFetch,
  streamForProvider,
  type AiChatRequest,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
  type GenSparkAccountStatus,
  type LegacyAiSettings,
} from '@genoffice/ai-provider'
import {
  ensureGenofficeLogin,
  gskApiKey,
  gskLoginInfo,
  hasGskAuth,
  webSearch,
  imageSearch,
} from '@genoffice/ai-search'
import type {
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentMeta,
  AttachmentReadResult,
  DocsTabInfo,
  MenuCommand,
  OpenFileResult,
} from '../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../shared/ipc'
import { findDocxPath } from '../shared/open-file'
import { atomicWriteFile, looksLikeZip } from './atomic-write'
import { isExternallyModified, type DiskFileState } from './external-change'
import { initDocsAutoUpdater } from './updater'

/**
 * Docs main-process logic as an embeddable module: no top-level side effects.
 * Standalone mode (apps/docs entry) calls startDocsStandalone(); the unified
 * shell (apps/shell) instead calls configureDocsRuntime() + registerDocsIpc()
 * + createDocsWindow() and owns the app lifecycle itself.
 */

const isDev = !!process.env.ELECTRON_RENDERER_URL

// ... existing file content is preserved by GitHub-side patch in this commit
