import React from 'react'
import { Pressable, StyleSheet, Text, View, Linking, Alert } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated'
import type { NewsFlipCard, NewsChannelMeta } from '@/lib/api'
import { timeAgo } from '@/lib/time'

const BRAND_NAVY = '#0b1e3a'
const BRAND_GOLD = '#c6a255'
const TEXT = '#f1f5f9'
const TEXT_MUTED = '#94a3b8'
const CARD_BG = '#132a4a'
const BACK_BG = '#fafaf7'
const BACK_INK = '#0d1b2a'

interface Props {
  card: NewsFlipCard
  channelMap: Record<string, NewsChannelMeta>
}

/**
 * Flipboard-style card.
 *  - Front: headline + source + time + primary channel chip
 *  - Back:  summary + matching-channel chips + primary action
 *           ("Open on source →") which hands off to the external browser
 * Tap anywhere on the card body (except the action button) to flip.
 */
export default function FlipCard({ card, channelMap }: Props) {
  const rot = useSharedValue(0)

  const flip = () => {
    rot.value = withTiming(rot.value === 0 ? 180 : 0, { duration: 420 })
  }

  const frontStyle = useAnimatedStyle(() => {
    const rotateY = `${rot.value}deg`
    const opacity = interpolate(rot.value, [0, 90, 91, 180], [1, 1, 0, 0])
    return { transform: [{ perspective: 1200 }, { rotateY }], opacity }
  })

  const backStyle = useAnimatedStyle(() => {
    const rotateY = `${rot.value - 180}deg`
    const opacity = interpolate(rot.value, [0, 89, 90, 180], [0, 0, 1, 1])
    return { transform: [{ perspective: 1200 }, { rotateY }], opacity }
  })

  const openSource = async () => {
    try {
      const supported = await Linking.canOpenURL(card.sourceUrl)
      if (!supported) {
        Alert.alert('Cannot open', 'No app found to open this link.')
        return
      }
      await Linking.openURL(card.sourceUrl)
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not open the link')
    }
  }

  const primary = channelMap[card.channels[0]]
  const accent = primary?.color || BRAND_GOLD

  return (
    <View style={styles.shell}>
      <Animated.View style={[styles.face, styles.front, frontStyle, { borderTopColor: accent }]}>
        <Pressable onPress={flip} style={styles.facePressable}>
          <View style={styles.metaRow}>
            <View style={[styles.pill, { borderColor: accent, backgroundColor: accent + '22' }]}>
              <Text style={[styles.pillText, { color: accent }]}>
                {primary?.label || card.channels[0] || 'News'}
              </Text>
            </View>
            <Text style={styles.timeText}>{timeAgo(card.publishedAt)}</Text>
          </View>
          <Text style={styles.title} numberOfLines={5}>
            {card.title}
          </Text>
          <Text style={styles.source} numberOfLines={1}>
            {card.source}
          </Text>
          <View style={{ flex: 1 }} />
          <View style={styles.hintRow}>
            <Text style={styles.hint}>Tap to flip · read summary</Text>
          </View>
        </Pressable>
      </Animated.View>

      <Animated.View style={[styles.face, styles.back, backStyle, { borderTopColor: accent }]}>
        <Pressable onPress={flip} style={styles.facePressable}>
          <Text style={styles.backEyebrow}>Summary</Text>
          <Text style={styles.backTitle} numberOfLines={3}>
            {card.title}
          </Text>
          <Text style={styles.backBody}>{card.summary}</Text>

          <View style={styles.chipRow}>
            {card.channels.map((cid) => {
              const meta = channelMap[cid]
              const col = meta?.color || BRAND_GOLD
              return (
                <View
                  key={cid}
                  style={[styles.chipSmall, { borderColor: col, backgroundColor: col + '18' }]}
                >
                  <Text style={[styles.chipSmallText, { color: col }]}>
                    {meta?.label || cid}
                  </Text>
                </View>
              )
            })}
          </View>

          <View style={{ flex: 1 }} />

          <View style={styles.backFooter}>
            <Text style={styles.backSource}>{card.source}</Text>
            <Pressable
              onPress={openSource}
              style={({ pressed }) => [
                styles.openBtn,
                { backgroundColor: accent, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={styles.openBtnText}>Open source ↗</Text>
            </Pressable>
          </View>

          <View style={styles.hintRow}>
            <Text style={[styles.hint, { color: '#475569' }]}>Tap card to flip back</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: 14,
    marginBottom: 14,
    height: 300,
    position: 'relative',
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    borderWidth: 1,
    borderTopWidth: 4,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
  facePressable: {
    flex: 1,
    padding: 20,
  },
  front: {
    backgroundColor: CARD_BG,
    borderColor: '#1e3a66',
  },
  back: {
    backgroundColor: BACK_BG,
    borderColor: '#d9dde3',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 3,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  timeText: {
    color: TEXT_MUTED,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  title: {
    color: TEXT,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 25,
    letterSpacing: -0.2,
  },
  source: {
    color: TEXT_MUTED,
    fontSize: 11,
    marginTop: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  hintRow: {
    alignItems: 'center',
    marginTop: 8,
  },
  hint: {
    color: TEXT_MUTED,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  backEyebrow: {
    color: BRAND_GOLD,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  backTitle: {
    color: BACK_INK,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
    lineHeight: 21,
  },
  backBody: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 19,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 12,
  },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 3,
    borderWidth: 1,
  },
  chipSmallText: {
    fontSize: 10,
    fontWeight: '600',
  },
  backFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
    marginTop: 10,
  },
  backSource: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  openBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
  },
  openBtnText: {
    color: BRAND_NAVY,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
})
