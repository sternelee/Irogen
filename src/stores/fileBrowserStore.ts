/**
 * File Browser Store
 *
 * Manages file browser state for P2P file operations including:
 * - Directory listings
 * - File contents
 * - Navigation history
 * - Loading and error states
 */

import { createStore, produce } from 'solid-js/store'

// ============================================================================
// Types
// ============================================================================

export interface FileEntry {
  name: string
  isDir: boolean
  size: number
}

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  content: string
}

export type NavigationAction =
  | { type: 'navigate'; path: string }
  | { type: 'back' }
  | { type: 'forward' }

// ============================================================================
// Store
// ============================================================================

interface FileBrowserState {
  // Current directory listing
  currentPath: string
  entries: FileEntry[]

  // File content being viewed
  viewingFile: FileContent | null

  // Navigation history
  history: string[]
  historyIndex: number

  // Loading states
  isLoading: boolean
  isLoadingFile: boolean

  // Error states
  error: string | null

  // Selection state
  selectedPath: string | null

  // View mode
  viewMode: 'list' | 'grid'
}

const initialState: FileBrowserState = {
  currentPath: '.',
  entries: [],
  viewingFile: null,
  history: ['.'],
  historyIndex: 0,
  isLoading: false,
  isLoadingFile: false,
  error: null,
  selectedPath: null,
  viewMode: 'list',
}

export const createFileBrowserStore = () => {
  const [state, setState] = createStore<FileBrowserState>(initialState)

  // ========================================================================
  // Directory Operations
  // ========================================================================

  const setCurrentPath = (path: string) => {
    setState('currentPath', path)
  }

  const setEntries = (entries: FileEntry[]) => {
    setState('entries', entries)
  }

  const setLoading = (loading: boolean) => {
    setState('isLoading', loading)
  }

  const setError = (error: string | null) => {
    setState('error', error)
  }

  const navigateToPath = (path: string) => {
    setState(
      produce((s: FileBrowserState) => {
        // Trim history after current index
        s.history = s.history.slice(0, s.historyIndex + 1)
        // Add new path
        s.history.push(path)
        s.historyIndex = s.history.length - 1
        s.currentPath = path
        s.viewingFile = null
      }),
    )
  }

  const navigateBack = () => {
    if (state.historyIndex > 0) {
      setState(
        produce((s: FileBrowserState) => {
          s.historyIndex -= 1
          s.currentPath = s.history[s.historyIndex]
          s.viewingFile = null
        }),
      )
    }
  }

  const navigateForward = () => {
    if (state.historyIndex < state.history.length - 1) {
      setState(
        produce((s: FileBrowserState) => {
          s.historyIndex += 1
          s.currentPath = s.history[s.historyIndex]
          s.viewingFile = null
        }),
      )
    }
  }

  const navigateUp = () => {
    if (state.currentPath === '.') return
    const parts = state.currentPath.split('/').filter(Boolean)
    parts.pop()
    const parentPath = parts.join('/') || '.'
    navigateToPath(parentPath)
  }

  // ========================================================================
  // File Operations
  // ========================================================================

  const viewFile = (path: string, content: string) => {
    setState('viewingFile', { path, content })
  }

  const closeFile = () => {
    setState('viewingFile', null)
  }

  const setLoadingFile = (loading: boolean) => {
    setState('isLoadingFile', loading)
  }

  // ========================================================================
  // Selection
  // ========================================================================

  const selectPath = (path: string | null) => {
    setState('selectedPath', path)
  }

  // ========================================================================
  // View Mode
  // ========================================================================

  const setViewMode = (mode: 'list' | 'grid') => {
    setState('viewMode', mode)
  }

  // ========================================================================
  // Derived State
  // ========================================================================

  const canGoBack = () => state.historyIndex > 0
  const canGoForward = () => state.historyIndex < state.history.length - 1
  const canGoUp = () => state.currentPath !== '.'

  const getSelectedEntry = (): FileEntry | undefined => {
    if (!state.selectedPath) return undefined
    return state.entries.find((e) => `${state.currentPath}/${e.name}` === state.selectedPath)
  }

  const getDirectories = (): FileEntry[] => {
    return state.entries.filter((e) => e.isDir)
  }

  const getFiles = (): FileEntry[] => {
    return state.entries.filter((e) => !e.isDir)
  }

  return {
    // State
    state,

    // Directory
    setCurrentPath,
    setEntries,
    navigateToPath,
    navigateBack,
    navigateForward,
    navigateUp,

    // File
    viewFile,
    closeFile,

    // Loading
    setLoading,
    setLoadingFile,

    // Error
    setError,

    // Selection
    selectPath,

    // View Mode
    setViewMode,

    // Derived
    canGoBack,
    canGoForward,
    canGoUp,
    getSelectedEntry,
    getDirectories,
    getFiles,
  }
}

// Global store instance
export const fileBrowserStore = createFileBrowserStore()
