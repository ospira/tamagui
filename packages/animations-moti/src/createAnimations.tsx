import { PresenceContext, usePresence } from '@tamagui/use-presence'
import { AnimationDriver, UniversalAnimatedNumber } from '@tamagui/web'
import type { MotiTransition } from 'moti'
import { useMotify } from 'moti/author'
import { useCallback, useContext, useMemo } from 'react'
import Animated, {
  SharedValue,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

type ReanimatedAnimatedNumber = SharedValue<number>

export function createAnimations<A extends Record<string, MotiTransition>>(
  animations: A
): AnimationDriver<A> {
  return {
    View: Animated.View,
    Text: Animated.Text,
    isReactNative: true,
    keepStyleSSR: true,
    supportsCSSVars: true,
    animations,
    usePresence,
    supportsZeroRenderPseudos: true,

    useAnimatedNumber(initial): UniversalAnimatedNumber<ReanimatedAnimatedNumber> {
      const sharedValue = useSharedValue(initial)

      return useMemo(
        () => ({
          getInstance() {
            'worklet'
            return sharedValue
          },
          getValue() {
            'worklet'
            return sharedValue.value
          },
          setValue(next, config = { type: 'spring' }) {
            'worklet'
            if (config.type === 'direct') {
              sharedValue.value = next
            } else if (config.type === 'spring') {
              sharedValue.value = withSpring(next, config)
            } else {
              sharedValue.value = withTiming(next, config)
            }
          },
          stop() {
            'worklet'
            cancelAnimation(sharedValue)
          },
        }),
        [sharedValue]
      )
    },

    useAnimatedNumberReaction({ value }, onValue) {
      const instance = value.getInstance()
      return useAnimatedReaction(
        () => {
          return instance.value
        },
        (next, prev) => {
          if (prev !== next) {
            // @nate what is the point of this hook? is this necessary?
            // without runOnJS, onValue would need to be a worklet
            runOnJS(onValue)(next)
          }
        },
        // dependency array is very important here
        [onValue, instance]
      )
    },

    /**
     * `getStyle` must be a worklet
     */
    useAnimatedNumberStyle(val, getStyle) {
      const instance = val.getInstance()

      // this seems wrong but it works
      const derivedValue = useDerivedValue(() => {
        return instance.value
        // dependency array is very important here
      }, [instance, getStyle])

      return useAnimatedStyle(() => {
        return getStyle(derivedValue.value)
        // dependency array is very important here
      }, [val, getStyle, derivedValue, instance])
    },

    useAnimations: ({ props, presence, style, onDidAnimate, pseudos }) => {
      const pseudoState = useSharedValue({
        hover: false,
        press: false,
        focus: false,
      })
      const animationKey = Array.isArray(props.animation)
        ? props.animation[0]
        : props.animation

      let animate: Object | undefined
      let dontAnimate: Object | undefined

      const animateOnly = props.animateOnly
      if (animateOnly) {
        animate = {}
        dontAnimate = { ...style }
        for (const key of animateOnly) {
          if (!(key in style)) continue
          animate[key] = style[key]
          delete dontAnimate[key]
        }
      } else {
        animate = { ...style }
        dontAnimate = {}
      }

      // without this, the driver breaks on native
      // stringifying -> parsing fixes that
      const animateStr = JSON.stringify(animate)
      const styles = useMemo(() => JSON.parse(animateStr), [animateStr])
      const isExiting = Boolean(presence?.[1])
      const sendExitComplete = presence?.[1]
      const transition = animations[animationKey as keyof typeof animations]

      const onDidAnimateCombined = useCallback(() => {
        onDidAnimate?.()
        sendExitComplete?.()
      }, [])

      const animateWithPseudos = useDerivedValue<any>(() => {
        let final = Object.assign({}, styles)

        const { hover: hovered, press: pressed, focus: focused } = pseudoState.value
        console.log('[moti] animateWithPseudos', pseudoState.value, transition)

        if (hovered && pseudos?.hoverStyle) {
          console.log('[moti] [hover]', pseudos.hoverStyle)
          final = Object.assign(final, pseudos.hoverStyle)
        }

        if (pressed && pseudos?.pressStyle) {
          console.log('[moti] [press]', pseudos.pressStyle)
          final = Object.assign(final, pseudos.pressStyle)
        }

        if (focused && pseudos?.focusStyle) {
          final = Object.assign(final, pseudos.focusStyle)
        }

        console.log('[moti] [final]', final)

        return final
      }, [pseudoState, pseudos, styles])

      const moti = useMotify({
        animate: isExiting ? undefined : animateWithPseudos,
        transition,
        onDidAnimate: onDidAnimateCombined,
        usePresenceValue: presence as any,
        presenceContext: useContext(PresenceContext),
        exit: isExiting ? styles : undefined,
      })

      if (process.env.NODE_ENV === 'development' && props['debug'] === 'verbose') {
        // rome-ignore lint/nursery/noConsoleLog: <explanation>
        console.log(`Moti animation:`, {
          animate,
          transition,
          styles,
          moti,
          dontAnimate,
          isExiting,
          animateStr,
        })
      }

      return {
        style: [dontAnimate, moti.style],
        updatePseudoState: useMemo(
          // useCallback doesn't infer param types of optional functions 🤷‍♂️
          // i tried: https://github.com/DefinitelyTyped/DefinitelyTyped/pull/64606
          // - fernando
          () => (next) => {
            pseudoState.value = {
              ...pseudoState.value,
              ...next,
            }
          },
          []
        ),
      }
    },
  }
}
