import type { DesktopSkinsMessage } from './client/i18n.ts'
import type { DesktopSkinId } from './preferences.ts'

export type SkinColorScheme = 'light' | 'dark'

/** Semantic colors consumed by the pinned terminal renderer. */
export type TuiSkinColors = Readonly<Record<string, string>>

/** One surface-neutral Oh-DSH skin with browser and terminal adapters. */
export interface OhDshSkin {
  id: DesktopSkinId
  colorScheme: SkinColorScheme
  tokens: Readonly<Record<string, string>>
  tui: TuiSkinColors
  displayName: string
  preview: string
  accent: string
  label: DesktopSkinsMessage
  css?: string
}

/** Compatibility name retained for the browser controller API. */
export type DesktopSkin = OhDshSkin

function tuiColors(
  tokens: Readonly<Record<string, string>>,
  merged: string,
): TuiSkinColors {
  const value = (key: string): string => {
    const color = tokens[key]
    if (color === undefined || !color.startsWith('#')) {
      throw new Error(`skin token ${key} must be an opaque terminal color`)
    }
    return color
  }
  return Object.freeze({
    autoAccept: merged,
    bashBorder: value('--dsw-alias-brand-primary'),
    claude: value('--dsw-alias-brand-primary'),
    claudeShimmer: value('--dsw-alias-button-primary-hover'),
    claudeBlue_FOR_SYSTEM_SPINNER: value('--dsw-alias-brand-primary'),
    claudeBlueShimmer_FOR_SYSTEM_SPINNER: value('--dsw-alias-button-primary-hover'),
    permission: value('--dsw-alias-brand-primary'),
    permissionShimmer: value('--dsw-alias-button-primary-hover'),
    planMode: value('--dsw-alias-state-success-primary'),
    ide: value('--dsw-alias-brand-primary'),
    promptBorder: value('--dsw-alias-scrollbar-bg-l1'),
    promptBorderShimmer: value('--dsw-alias-brand-primary'),
    text: value('--dsw-alias-label-primary'),
    inverseText: value('--dsw-alias-brand-primary-invert'),
    inactive: value('--dsw-alias-label-tertiary'),
    inactiveShimmer: value('--dsw-alias-label-secondary'),
    subtle: value('--dsw-alias-label-tertiary'),
    suggestion: value('--dsw-alias-brand-primary'),
    remember: value('--dsw-alias-brand-text'),
    background: value('--dsw-alias-brand-primary'),
    success: value('--dsw-alias-state-success-primary'),
    error: value('--dsw-alias-state-error-primary'),
    warning: value('--dsw-alias-state-warn-primary'),
    merged,
    warningShimmer: value('--dsw-alias-state-warn-primary'),
    professionalBlue: value('--dsw-alias-brand-primary'),
    userMessageBackground: value('--dsw-specific-bubble'),
    userMessageBackgroundHover: value('--dsw-alias-bg-layer-3'),
    messageActionsBackground: value('--dsw-specific-menu'),
    selectionBg: value('--dsw-alias-scrollbar-bg-l1'),
    bashMessageBackgroundColor: value('--dsw-specific-input-major'),
    memoryBackgroundColor: value('--dsw-alias-bg-layer-2'),
    rate_limit_fill: value('--dsw-alias-brand-primary'),
    rate_limit_empty: value('--dsw-alias-bg-layer-3'),
    fastMode: value('--dsw-alias-state-warn-primary'),
    fastModeShimmer: value('--dsw-alias-button-primary-hover'),
    briefLabelYou: value('--dsw-alias-brand-text'),
    briefLabelClaude: value('--dsw-alias-brand-primary'),
    // Markdown fenced-code syntax tokens (the renderer maps highlight.js
    // classes onto these theme keys). Without them the palette inherits the
    // terminal builtin's low-contrast grays — comments and punctuation sit
    // near 3:1 on a dark background and plaintext blocks lose the skin —
    // so every skin pins them to its shared label/state tokens instead.
    syntaxKeyword: value('--dsw-alias-brand-primary'),
    syntaxString: value('--dsw-alias-state-success-primary'),
    syntaxComment: value('--dsw-alias-label-tertiary'),
    syntaxNumber: value('--dsw-alias-state-warn-primary'),
    syntaxFunction: value('--dsw-alias-button-primary-hover'),
    syntaxType: merged,
    syntaxVariable: value('--dsw-alias-label-primary'),
    syntaxOperator: value('--dsw-alias-label-secondary'),
    syntaxPunctuation: value('--dsw-alias-label-secondary'),
    syntaxConstant: value('--dsw-alias-state-error-primary'),
  })
}

const DEEP_CURRENT_TOKENS = {
  '--dsw-alias-bg-base': '#071923',
  '--dsw-alias-bg-layer-1': '#0b2230',
  '--dsw-alias-bg-layer-2': '#0f2a39',
  '--dsw-alias-bg-layer-3': '#143445',
  '--dsw-alias-bg-overlay': '#193e50',
  '--dsw-alias-bg-module-platform': '#0f2a39',
  '--dsw-alias-border-l1': 'rgba(143, 214, 235, 0.08)',
  '--dsw-alias-border-l2': 'rgba(143, 214, 235, 0.14)',
  '--dsw-alias-border-l3': 'rgba(143, 214, 235, 0.22)',
  '--dsw-alias-brand-primary': '#49c8eb',
  '--dsw-alias-brand-primary-invert': '#06151d',
  '--dsw-alias-brand-text': '#bcecf8',
  '--dsw-alias-button-primary-fill': '#49c8eb',
  '--dsw-alias-button-primary-hover': '#6dd7f2',
  '--dsw-alias-interactive-bg-active': 'rgba(109, 215, 242, 0.16)',
  '--dsw-alias-interactive-bg-hover': 'rgba(109, 215, 242, 0.09)',
  '--dsw-alias-label-primary': '#e9f8fb',
  '--dsw-alias-label-secondary': '#b9dbe4',
  '--dsw-alias-label-tertiary': '#78a8b5',
  '--dsw-alias-markdown-code-block': '#06151e',
  '--dsw-alias-markdown-inline-code': '#123143',
  '--dsw-alias-scrollbar-bg-l1': '#214b5c',
  '--dsw-alias-scrollbar-hover-l1': '#49c8eb',
  '--dsw-alias-state-error-primary': '#ff7185',
  '--dsw-alias-state-success-primary': '#63d5ad',
  '--dsw-alias-state-warn-primary': '#f4c56a',
  '--dsw-specific-bubble': '#123143',
  '--dsw-specific-input-major': '#0a202c',
  '--dsw-specific-menu': '#103041',
  // Luminance ladder: the sidebar sits one step below the canvas so region
  // separation comes from brightness, not borders; the active row lifts.
  '--dsw-specific-sidebar-fill': '#061521',
  '--dsw-specific-sidebar-nav-item-active': '#123143',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(233, 248, 251, 0.05)',
} as const

const JADE_CIRCUIT_TOKENS = {
  '--dsw-alias-bg-base': '#071a16',
  '--dsw-alias-bg-layer-1': '#0b241e',
  '--dsw-alias-bg-layer-2': '#102e26',
  '--dsw-alias-bg-layer-3': '#15392f',
  '--dsw-alias-bg-overlay': '#1b493b',
  '--dsw-alias-bg-module-platform': '#102e26',
  '--dsw-alias-border-l1': 'rgba(124, 236, 187, 0.08)',
  '--dsw-alias-border-l2': 'rgba(124, 236, 187, 0.14)',
  '--dsw-alias-border-l3': 'rgba(124, 236, 187, 0.22)',
  '--dsw-alias-brand-primary': '#52d6a0',
  '--dsw-alias-brand-primary-invert': '#071a16',
  '--dsw-alias-brand-text': '#bbf3d8',
  '--dsw-alias-button-primary-fill': '#52d6a0',
  '--dsw-alias-button-primary-hover': '#72e5b4',
  '--dsw-alias-interactive-bg-active': 'rgba(114, 229, 180, 0.16)',
  '--dsw-alias-interactive-bg-hover': 'rgba(114, 229, 180, 0.08)',
  '--dsw-alias-label-primary': '#e9fbf3',
  '--dsw-alias-label-secondary': '#b9ddce',
  '--dsw-alias-label-tertiary': '#78a795',
  '--dsw-alias-markdown-code-block': '#061510',
  '--dsw-alias-markdown-inline-code': '#14372d',
  '--dsw-alias-scrollbar-bg-l1': '#205240',
  '--dsw-alias-scrollbar-hover-l1': '#52d6a0',
  '--dsw-alias-state-error-primary': '#ff7185',
  '--dsw-alias-state-success-primary': '#52d6a0',
  '--dsw-alias-state-warn-primary': '#f3c966',
  '--dsw-specific-bubble': '#14372d',
  '--dsw-specific-input-major': '#0a211b',
  '--dsw-specific-menu': '#123329',
  '--dsw-specific-sidebar-fill': '#061712',
  '--dsw-specific-sidebar-nav-item-active': '#14372d',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(233, 251, 243, 0.05)',
} as const

const PORCELAIN_TOKENS = {
  '--dsw-alias-bg-base': '#f3f7f6',
  '--dsw-alias-bg-layer-1': '#f8fbfa',
  '--dsw-alias-bg-layer-2': '#edf4f2',
  '--dsw-alias-bg-layer-3': '#e5efec',
  '--dsw-alias-bg-overlay': '#dce9e6',
  '--dsw-alias-bg-module-platform': '#edf4f2',
  '--dsw-alias-border-l1': 'rgba(24, 70, 67, 0.07)',
  '--dsw-alias-border-l2': 'rgba(24, 70, 67, 0.12)',
  '--dsw-alias-border-l3': 'rgba(24, 70, 67, 0.18)',
  '--dsw-alias-brand-primary': '#2d7773',
  '--dsw-alias-brand-primary-invert': '#f7fbfa',
  '--dsw-alias-brand-text': '#245f5c',
  '--dsw-alias-button-primary-fill': '#2d7773',
  '--dsw-alias-button-primary-hover': '#378b86',
  '--dsw-alias-interactive-bg-active': 'rgba(45, 119, 115, 0.14)',
  '--dsw-alias-interactive-bg-hover': 'rgba(45, 119, 115, 0.07)',
  '--dsw-alias-label-primary': '#18312f',
  '--dsw-alias-label-secondary': '#405d59',
  '--dsw-alias-label-tertiary': '#718b87',
  '--dsw-alias-markdown-code-block': '#e8f0ee',
  '--dsw-alias-markdown-inline-code': '#dfebe8',
  '--dsw-alias-scrollbar-bg-l1': '#cddeda',
  '--dsw-alias-scrollbar-hover-l1': '#8aaca6',
  '--dsw-alias-state-error-primary': '#c65358',
  '--dsw-alias-state-success-primary': '#418b68',
  '--dsw-alias-state-warn-primary': '#b77b25',
  '--dsw-specific-bubble': '#e8f0ee',
  '--dsw-specific-input-major': '#fbfdfc',
  '--dsw-specific-menu': '#edf4f2',
  // Light scheme ladder: canvas stays lightest, the sidebar steps down, and
  // the active row is a white luminance pill on the darker sidebar.
  '--dsw-specific-sidebar-fill': '#eaf1ef',
  '--dsw-specific-sidebar-nav-item-active': '#ffffff',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(255, 255, 255, 0.6)',
} as const

const EMBER_DUSK_TOKENS = {
  '--dsw-alias-bg-base': '#21161f',
  '--dsw-alias-bg-layer-1': '#2a1b27',
  '--dsw-alias-bg-layer-2': '#342130',
  '--dsw-alias-bg-layer-3': '#40283a',
  '--dsw-alias-bg-overlay': '#4b3042',
  '--dsw-alias-bg-module-platform': '#342130',
  '--dsw-alias-border-l1': 'rgba(255, 183, 159, 0.08)',
  '--dsw-alias-border-l2': 'rgba(255, 183, 159, 0.14)',
  '--dsw-alias-border-l3': 'rgba(255, 183, 159, 0.22)',
  '--dsw-alias-brand-primary': '#ff9275',
  '--dsw-alias-brand-primary-invert': '#23151d',
  '--dsw-alias-brand-text': '#ffd4c7',
  '--dsw-alias-button-primary-fill': '#ff9275',
  '--dsw-alias-button-primary-hover': '#ffad96',
  '--dsw-alias-interactive-bg-active': 'rgba(255, 173, 150, 0.16)',
  '--dsw-alias-interactive-bg-hover': 'rgba(255, 173, 150, 0.08)',
  '--dsw-alias-label-primary': '#fff0ea',
  '--dsw-alias-label-secondary': '#dfc1cb',
  '--dsw-alias-label-tertiary': '#a98391',
  '--dsw-alias-markdown-code-block': '#1b121a',
  '--dsw-alias-markdown-inline-code': '#3b2636',
  '--dsw-alias-scrollbar-bg-l1': '#563649',
  '--dsw-alias-scrollbar-hover-l1': '#ff9275',
  '--dsw-alias-state-error-primary': '#ff6f82',
  '--dsw-alias-state-success-primary': '#7bd3a6',
  '--dsw-alias-state-warn-primary': '#efbe69',
  '--dsw-specific-bubble': '#3b2636',
  '--dsw-specific-input-major': '#281923',
  '--dsw-specific-menu': '#382331',
  '--dsw-specific-sidebar-fill': '#1c131b',
  '--dsw-specific-sidebar-nav-item-active': '#3b2636',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(255, 240, 234, 0.05)',
} as const

export const OH_DSH_SKINS: readonly OhDshSkin[] = Object.freeze([
  Object.freeze({
    id: 'oh-dsh-skin-deep-current',
    colorScheme: 'dark',
    tokens: DEEP_CURRENT_TOKENS,
    tui: tuiColors(DEEP_CURRENT_TOKENS, '#b995f5'),
    displayName: 'Deep Current',
    preview: 'linear-gradient(135deg, #071923 0%, #143445 64%, #49c8eb 145%)',
    accent: '#49c8eb',
    label: 'skins.name.deep-current',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-jade-circuit',
    colorScheme: 'dark',
    tokens: JADE_CIRCUIT_TOKENS,
    tui: tuiColors(JADE_CIRCUIT_TOKENS, '#a78bfa'),
    displayName: 'Jade Circuit',
    preview: 'linear-gradient(145deg, #071a16 0 42%, #154435 43% 62%, #52d6a0 150%)',
    accent: '#52d6a0',
    label: 'skins.name.jade-circuit',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-porcelain',
    colorScheme: 'light',
    tokens: PORCELAIN_TOKENS,
    tui: tuiColors(PORCELAIN_TOKENS, '#8a6faf'),
    displayName: 'Porcelain',
    preview: 'radial-gradient(circle at 78% 22%, #b9dcd7 0%, transparent 38%), linear-gradient(145deg, #f8fbfa 0%, #e5efec 100%)',
    accent: '#2d7773',
    label: 'skins.name.porcelain',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-ember-dusk',
    colorScheme: 'dark',
    tokens: EMBER_DUSK_TOKENS,
    tui: tuiColors(EMBER_DUSK_TOKENS, '#c79cff'),
    displayName: 'Ember Dusk',
    preview: 'radial-gradient(circle at 78% 24%, #ff9275 0%, transparent 38%), linear-gradient(145deg, #21161f 0%, #4b3042 100%)',
    accent: '#ff9275',
    label: 'skins.name.ember-dusk',
  }),
])

/** Compatibility alias used by the browser-facing controller. */
export const DESKTOP_SKINS = OH_DSH_SKINS

export function ohDshSkin(id: string): OhDshSkin | undefined {
  return OH_DSH_SKINS.find(skin => skin.id === id)
}

export function desktopSkin(id: string): DesktopSkin | undefined {
  return ohDshSkin(id)
}
