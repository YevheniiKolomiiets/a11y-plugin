export type Step = 'a11y:audit' | 'a11y:lab' | 'a11y:record'

declare module 'claude-code' {
  interface PluginState {
    a11y: {
      /** The step started last in this session: the one running now; null before any. */
      current: Step | null
      /** Every step started in this session. */
      ran: Step[]
      isOpen: boolean
    }
  }
}
