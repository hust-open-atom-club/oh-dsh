declare module '@deepseek-ai/dsh-client-store' {
  export interface EngineStoreInstance<State> {
    getSnapshot(): State
    subscribe(listener: () => void): () => void
    actions: Record<string, (...args: any[]) => void>
  }

  export interface EngineStoreHandle<State> {
    create(scopeKey?: string): EngineStoreInstance<State>
    readonly __state?: State
  }

  export function defineStore<State>(definition: {
    init: () => State
    actions: Record<string, (draft: State, ...args: any[]) => void>
  }): EngineStoreHandle<State>
}
