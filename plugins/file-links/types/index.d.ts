// The file the pane shows: its absolute path, the label drawn for it, and the line to scroll to.
// `opened` changes on every click, so the pane scrolls again when the same reference is clicked twice.
export type ShownFile = { path: string; label: string; line: number | null; opened: number }

declare module 'claude-code' {
  interface PluginState {
    'file-links': { shown: ShownFile | null; indexVersion: number }
  }
}
