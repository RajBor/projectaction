import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import FlipCard from '@/components/FlipCard'
import { fetchFeed, type NewsChannelMeta, type NewsFlipCard } from '@/lib/api'
import type { RootStackParamList } from '../../App'

type Props = NativeStackScreenProps<RootStackParamList, 'NewsFeed'>

const BRAND_NAVY = '#0b1e3a'
const BRAND_GOLD = '#c6a255'
const TEXT = '#f1f5f9'
const TEXT_MUTED = '#94a3b8'
const BORDER = '#1e3a66'

export default function NewsFeed({ route, navigation }: Props) {
  const { channels, apiBase, apiKey } = route.params
  const [cards, setCards] = useState<NewsFlipCard[]>([])
  const [channelMeta, setChannelMeta] = useState<NewsChannelMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const load = useCallback(
    async (fresh: boolean) => {
      setError(null)
      try {
        const res = await fetchFeed(apiBase, apiKey, channels, { limit: 80, fresh })
        if (!res.ok) {
          throw new Error(res.error || 'Feed fetch failed')
        }
        setCards(res.data || [])
        setChannelMeta(res.channels || [])
        setFetchedAt(res.fetchedAt || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [apiBase, apiKey, channels],
  )

  useEffect(() => {
    setLoading(true)
    load(false).finally(() => setLoading(false))
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }, [load])

  const channelMap = useMemo(() => {
    const m: Record<string, NewsChannelMeta> = {}
    for (const c of channelMeta) m[c.id] = c
    return m
  }, [channelMeta])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>DealNector · Flipboard</Text>
          <Text style={styles.title}>
            {channels.length === 1
              ? channelMeta.find((c) => c.id === channels[0])?.label || 'News'
              : `${channels.length} channels`}
          </Text>
          {fetchedAt && (
            <Text style={styles.timestamp}>
              Refreshed {new Date(fetchedAt).toLocaleTimeString('en-IN')}
            </Text>
          )}
        </View>
        <Pressable onPress={onRefresh} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>↻</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND_GOLD} />
          <Text style={styles.centerText}>Fetching latest cards…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Feed error</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => { setLoading(true); load(true).finally(() => setLoading(false)) }} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : cards.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>No news on these channels yet.</Text>
          <Pressable onPress={onRefresh} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Refresh</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <FlipCard card={item} channelMap={channelMap} />}
          contentContainerStyle={styles.feed}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={BRAND_GOLD}
              colors={[BRAND_GOLD]}
              progressBackgroundColor={BRAND_NAVY}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND_NAVY },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  backBtnText: { fontSize: 22, color: TEXT, lineHeight: 22, marginTop: -2 },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  refreshBtnText: { fontSize: 16, color: BRAND_GOLD },
  eyebrow: {
    fontSize: 9,
    color: BRAND_GOLD,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  title: {
    fontSize: 20,
    color: TEXT,
    fontWeight: '700',
    marginTop: 3,
    letterSpacing: -0.3,
  },
  timestamp: { color: TEXT_MUTED, fontSize: 10, marginTop: 2 },
  feed: { paddingTop: 14, paddingBottom: 30 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  centerText: { color: TEXT_MUTED, marginTop: 10, fontSize: 13 },
  errorTitle: { color: '#fca5a5', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  errorBody: {
    color: TEXT_MUTED,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: BRAND_GOLD,
    borderRadius: 6,
  },
  retryBtnText: { color: BRAND_NAVY, fontWeight: '800', fontSize: 13 },
})
