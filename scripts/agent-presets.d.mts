export type AgentPresetSurface = 'desktop' | 'web' | 'tui'
export type AgentPresetPackageRole = 'agent' | 'host' | 'client'

export interface AgentPresetPackageManifest {
  directory: string
  name: string
  path: string
  role: AgentPresetPackageRole
  surfaces: AgentPresetSurface[]
}

export interface AgentPresetManifest {
  compositionPath: string
  directory: string
  id: string
  manifestPath: string
  packages: AgentPresetPackageManifest[]
  presetPath: string
  surfaces: Record<AgentPresetSurface, boolean>
}

export const AGENT_PRESET_ID: RegExp
export const AGENT_PRESET_MANIFEST: string
export const AGENT_PRESET_SURFACES: AgentPresetSurface[]
export const AGENT_PRESET_PACKAGE_ROLES: AgentPresetPackageRole[]

export function readAgentPresetManifest(repoRoot: string, directory: string): AgentPresetManifest
export function discoverAgentPresetManifests(
  repoRoot: string,
  sourceRoot?: string,
): AgentPresetManifest[]
