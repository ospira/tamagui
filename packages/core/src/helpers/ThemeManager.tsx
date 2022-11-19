import { isWeb } from '@tamagui/constants'
import { createContext } from 'react'

import { getThemes } from '../config'
import { THEME_CLASSNAME_PREFIX, THEME_NAME_SEPARATOR } from '../constants/constants'
import { getThemeUnwrapped } from '../hooks/getThemeUnwrapped'
import { ThemeParsed, ThemeProps } from '../types'
import { inverseTheme } from '../views/ThemeInverse'

type ThemeListener = (name: string | null, themeManager: ThemeManager) => void

export type SetActiveThemeProps = {
  className?: string
  parentManager?: ThemeManager | null
  name?: string | null
  theme?: any
  reset?: boolean
}

type ThemeManagerState = {
  name: string
  theme?: ThemeParsed | null
  className?: string
}

const emptyState: ThemeManagerState = { name: '-' }

export class ThemeManager {
  keys = new Map<any, Set<string>>()
  listeners = new Map<any, Function>()
  themeListeners = new Set<ThemeListener>()
  originalParentManager: ThemeManager | null = null
  parentManager: ThemeManager | null = null
  state: ThemeManagerState = emptyState

  constructor(
    ogParentManager?: ThemeManager | 'root' | null | undefined,
    public props?: ThemeProps
  ) {
    if (ogParentManager && ogParentManager !== 'root') {
      this.originalParentManager = ogParentManager
    }
    if (ogParentManager === 'root') {
      this.updateState(props, false, false)
      return
    }
    this.parentManager = ogParentManager || null
    const didUpdate = this.updateState(props, false, false)
    if (!didUpdate && ogParentManager) {
      return ogParentManager
    }
  }

  updateState(
    props: ThemeProps & { forceTheme?: ThemeParsed } = this.props || {},
    forceUpdate = false,
    notify = true
  ) {
    let shouldTryUpdate = forceUpdate || !this.parentManager
    if (!shouldTryUpdate) {
      const nextKey = this.getKey(props)
      if (
        (this.parentManager && nextKey !== this.parentManager.getKey()) ||
        this.getKey() !== nextKey
      ) {
        shouldTryUpdate = true
      }
    }
    if (props.forceTheme) {
      this.state.theme = props.forceTheme
      this.state.name = props.name || ''
      notify && this.notify()
      return true
    }
    if (shouldTryUpdate) {
      const nextState = this.getState(props)
      if (nextState) {
        this.state = nextState
        notify && this.notify()
        return true
      }
    }
    return false
  }

  getState(props: ThemeProps | undefined = this.props): ThemeManagerState | null {
    if (!props) {
      return null
    }
    const next = getNextThemeState(props, this.parentManager)
    if (!next || !next.theme) {
      return null
    }
    if (this.parentManager && next && next.theme === this.parentManager.state.theme) {
      return null
    }
    return next
  }

  #key: string | null = null
  getKey(props: ThemeProps | undefined = this.props) {
    if (!props) {
      if (process.env.NODE_ENV === 'development') {
        throw new Error(`No props given to ThemeManager.getKey()`)
      }
      return ``
    }
    if (this.#key) return this.#key
    const { name, inverse, reset, componentName } = props
    const key = `${name || 0}${inverse || 0}${reset || 0}${componentName || 0}`
    this.#key ??= key
    return key
  }

  #allKeys: Set<string> | null = null
  get allKeys() {
    if (!this.#allKeys) {
      this.#allKeys = new Set([
        ...(this.originalParentManager?.allKeys || []),
        ...Object.keys(this.state.theme || {}),
      ])
    }
    return this.#allKeys
  }

  get parentName() {
    return this.parentManager?.state.name || null
  }

  get fullName(): string {
    return this.state?.name || this.props?.name || ''
  }

  // gets value going up to parents
  getValue(key: string) {
    let theme = this.state.theme
    let manager = this as ThemeManager | null
    while (theme && manager) {
      if (key in theme) {
        return theme[key]
      }
      manager = manager.parentManager
      theme = manager?.state.theme
    }
  }

  isTracking(uuid: Object) {
    return Boolean(this.keys.get(uuid)?.size)
  }

  track(uuid: any, keys: Set<string>) {
    if (!this.state.name) return
    this.keys.set(uuid, keys)
  }

  notify() {
    if (!this.themeListeners.size || !this.keys.size) return
    // for (const [uuid, keys] of this.keys.entries()) {
    //   if (keys.size) {
    //     this.listeners.get(uuid)?.()
    //   }
    // }
    // debugger
    console.warn('notify')
    // this.themeListeners.forEach((cb) => cb(this.state.name, this))
  }

  onChangeTheme(cb: ThemeListener) {
    this.themeListeners.add(cb)
    return () => {
      this.themeListeners.delete(cb)
    }
  }
}

function getNextThemeClassName(name: string, disableRemoveScheme = false) {
  const next = `${THEME_CLASSNAME_PREFIX}${name}`
  if (disableRemoveScheme) return next
  return next.replace('light_', '').replace('dark_', '')
}

function getNextThemeState(
  props: ThemeProps,
  parentManager?: ThemeManager | null
): ThemeManagerState | null {
  const themes = getThemes()

  if (props.reset && props.name) {
    return {
      name: props.name,
      theme: themes[props.name] as ThemeParsed,
      className: getNextThemeClassName(props.name),
    }
  }

  const parentName = parentManager?.state.name || ''
  let nextName = parentManager?.props?.reset ? parentName || '' : props.name || ''

  const parentParts = parentName.split(THEME_NAME_SEPARATOR)
  const prefixes = parentParts
    .map((_, i) => {
      return parentParts.slice(0, i + 1).join(THEME_NAME_SEPARATOR)
    })
    // most specific first
    .reverse()

  const potentialComponent = props.componentName
    ? nextName
      ? `${withoutComponentName(nextName)}_${props.componentName}`
      : props.componentName
    : null

  // order important (most specific to least)
  const newPotentials = prefixes.flatMap((prefix) => {
    const res: string[] = []
    if (potentialComponent && nextName) {
      res.push([prefix, nextName, potentialComponent].join(THEME_NAME_SEPARATOR))
    }
    if (nextName) {
      res.push([prefix, nextName].join(THEME_NAME_SEPARATOR))
    }
    if (potentialComponent) {
      res.push([prefix, potentialComponent].join(THEME_NAME_SEPARATOR))
    }
    return res
  })

  let potentials = [...newPotentials, nextName]
  if (props.inverse) {
    potentials = potentials.map(inverseTheme)
  }

  for (const name of potentials) {
    if (name && name in themes) {
      nextName = name
      break
    }
  }

  const theme = themes[nextName]

  return {
    name: nextName,
    theme: getThemeUnwrapped(theme),
    className: getNextThemeClassName(nextName, !!props.inverse),
  }
}

export const ThemeManagerContext = createContext<ThemeManager | null>(null)

const withoutComponentName = (name: string) => name.replace(/(_[A-Z][a-zA-Z]+)+$/g, '')
