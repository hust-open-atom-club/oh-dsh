export const STAGE_SURFACES: Set<string>

export function parseStageSurface(
  argv?: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
): string

export const SURFACE_PACKAGE_NAMES: Readonly<{
  desktop: Set<string>
  web: Set<string>
  tui: Set<string>
}>

export const ALL_SURFACE_PACKAGE_NAMES: Set<string>

export interface StageRuntimeAdapters {
  adaptTuiRendererPackage(packageDir: string): void
  adaptTuiLiangshenPresentation(packageDir: string): void
}

export interface StageRuntimeRun {
  (command: string, args: readonly string[], options?: object): void
}

export interface StageRuntimeContext {
  readonly root: string
  readonly stage: string
  readonly runtime: string
  readonly nodeRuntime: string
  readonly dshSource: string
  readonly isWindowsNode: boolean
  readonly nodePlatform: string
  readonly nodeArch: string
  readonly npmRelease: boolean
  readonly run: StageRuntimeRun
  readonly adapters?: StageRuntimeAdapters
}

export interface StageRuntime {
  installDesktopPackages(surface?: string): void
  stagePnpmIntoNodeRuntime(options: { pnpmSource: string }): void
  restoreExecutableHelpers(): void
  installCompiledPackageDependencies(sourceManifestPath: string, packageDir: string): void
  installCompiledPackageHostDependencies(sourceManifestPath: string, packageDir: string): void
  exposeHoistedPackages(): void
  recordExposedDependencies(): void
  ensureWindowsWorkspacePackages(): void
  rewriteWorkspaceLinks(): void
  relinkInstallationWorkspacePackages(): void
  normalizeRuntimeLinks(): void
  ensureLinuxLandlockLauncher(): void
  ensureLinuxPtyBuild(): void
  pruneRuntimeDevelopmentFiles(): void
  replaceDeprecatedDomExceptionShim(): void
  assertDeprecatedLockBranchesAreNotShipped(): void
  assertSelfContained(rootPath: string, label: string): void
}

export function createStageRuntime(context: StageRuntimeContext): StageRuntime
