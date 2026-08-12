import type { AiSettings } from '@genoffice/ai-provider'
import type { UpdateChannel } from './update-api'

/** UI language; kept self-contained here (mirrors Lang in @genoffice/i18n) */
export type UiLanguage =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar'
  | 'pt' | 'it' | 'pl' | 'nl' | 'ms' | 'he' | 'hi' | 'zh-TW'

/** UI theme preference */
export type UiTheme = 'light' | 'dark' | 'system'

export interface RecentEntry {
  path: string
  name: string
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
}

export interface RecentQuery { offset?: number; limit?: number; ext?: string }
export interface RecentPage { entries: RecentEntry[]; total: number; totalAll: number }

export interface HomeApi {
  recents(query?: RecentQuery): Promise<RecentPage>
  starred(query?: RecentQuery): Promise<RecentPage>
  statPaths(paths: string[]): Promise<RecentEntry[]>
  toggleStar(path: string): Promise<void>
  openPath(path: string): Promise<void>
  browse(): Promise<void>
  newDoc(opts?: { projectId?: string }): Promise<void>
  newSheet(opts?: { projectId?: string }): Promise<void>
  newSlide(opts?: { projectId?: string }): Promise<void>
  newMarkdown(opts?: { projectId?: string }): Promise<void>
  removeRecent(paths: string[]): Promise<void>
  revealPath(path: string): Promise<void>
  renameFile(path: string, newName: string): Promise<RenameResult>
  duplicateFile(path: string): Promise<void>
  deleteFiles(paths: string[]): Promise<void>
  openTrash(): Promise<void>
  getLanguage(): Promise<UiLanguage>
  setLanguage(lang: UiLanguage): Promise<void>
  getUpdateChannel(): Promise<UpdateChannel>
  setUpdateChannel(channel: UpdateChannel): Promise<void>
  accountStatus(): Promise<AccountStatus>
  accountLogin(): Promise<boolean>
  onAccountLogin(handler: (ev: AccountLoginEvent) => void): () => void
  openLoginUrl(): Promise<void>
  accountLogout(): Promise<void>
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<void>
  getAppVersion(): Promise<string>
  onboardingSeen(): Promise<boolean>
  setOnboardingSeen(): Promise<void>
  getTheme(): Promise<UiTheme>
  setTheme(theme: UiTheme): Promise<void>
  getDefaultSaveDir(): Promise<string>
  pickDefaultSaveDir(): Promise<string | null>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  openGenTeam(): Promise<void>
  openCreditUsage(): Promise<void>
  cloudProjectsCached(): Promise<CloudProjectsSnapshot | null>
  cloudProjectsSync(): Promise<CloudProjectsSnapshot | null>
  openCloudProject(projectUrl: string): Promise<void>
}

export type CloudProjectKind = 'docs' | 'sheets' | 'slides'
export interface CloudProjectEntry { projectId: string; title: string; kind: CloudProjectKind | 'other'; ctimeMs: number; projectUrl: string }
export interface CloudProjectsSnapshot { available: boolean; projects: CloudProjectEntry[]; syncedAt: number }
export interface AccountStatus { loggedIn: boolean; email?: string; creditBalance?: number }
export interface AccountLoginEvent { phase: 'launched' | 'url' | 'success' | 'error'; url?: string; expiresInSec?: number; error?: string }
export interface RenameResult { ok: boolean; path?: string; error?: string }

export interface ProjectSummaryEntry { id: string; name: string; createdAt: string; updatedAt: string; fileCount: number; lastActiveAt: string; isDefault: boolean }
export interface TimelineEntryItem { filePath: string; fileName: string; chatId: string; ts: string; role: 'user' | 'assistant'; preview: string; seq: number }
export interface ProjectHomeApi {
  listProjects(): Promise<ProjectSummaryEntry[]>
  listFiles(projectId: string): Promise<string[]>
  createProject(name: string): Promise<ProjectSummaryEntry>
  renameProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  moveFile(filePath: string, projectId: string): Promise<void>
  getTimeline(projectId: string, limit?: number): Promise<TimelineEntryItem[]>
}

export const HOME_CHANNELS = {
  recents: 'home:recents', starred: 'home:starred', statPaths: 'home:stat-paths', toggleStar: 'home:toggle-star',
  openPath: 'home:open-path', browse: 'home:browse', newDoc: 'home:new-doc', newSheet: 'home:new-sheet',
  newSlide: 'home:new-slide', newMarkdown: 'home:new-markdown', removeRecent: 'home:remove-recent', revealPath: 'home:reveal-path',
  renameFile: 'home:rename-file', duplicateFile: 'home:duplicate-file', deleteFiles: 'home:delete-files', openTrash: 'home:open-trash',
  getLanguage: 'home:get-language', setLanguage: 'home:set-language', getUpdateChannel: 'home:get-update-channel', setUpdateChannel: 'home:set-update-channel',
  accountStatus: 'home:account-status', accountLogin: 'home:account-login', accountLoginEvent: 'home:account-login-event', accountLoginOpenUrl: 'home:account-login-open-url', accountLogout: 'home:account-logout',
  getAppVersion: 'home:get-app-version', onboardingSeen: 'home:onboarding-seen', setOnboardingSeen: 'home:set-onboarding-seen',
  getTheme: 'home:get-theme', setTheme: 'home:set-theme', getDefaultSaveDir: 'home:get-default-save-dir', pickDefaultSaveDir: 'home:pick-default-save-dir',
  openGenTeam: 'home:open-genteam', openCreditUsage: 'home:open-credit-usage', cloudProjects: 'home:cloud-projects', cloudProjectsCached: 'home:cloud-projects-cached', openCloudProject: 'home:open-cloud-project',
} as const

export const PROJECT_CHANNELS = { list: 'project:list', files: 'project:files', create: 'project:create', rename: 'project:rename', delete: 'project:delete', moveFile: 'project:moveFile', timeline: 'project:timeline' } as const
