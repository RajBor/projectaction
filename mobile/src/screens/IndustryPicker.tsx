import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fetchCatalogue, type NewsChannelMeta } from '@/lib/api'
import {
  loadSelectedChannels,
  saveSelectedChannels,
  loadApiBase,
  saveApiBase,
  loadApiKey,
  saveApiKey,
} from '@/lib/storage'
import { DEFAULT_API_BASE, DEFAULT_API_KEY } from '@/lib/config'
import type { RootStackParamList } from '../../App'

type Props = NativeStackScreenProps<RootStackParamList, 'IndustryPicker'>

const BRAND_NAVY = '#0b1e3a'
const BRAND_GOLD = '#c6a255'
const TEXT = '#f1f5f9'
const TEXT_MUTED = '#94a3b8'
const PANEL = '#132a4a'
const BORDER = '#1e3a66'

export default function IndustryPicker({ navigation }: Props) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE)
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY)
  const [channels, setChannels] = useState<NewsChannelMeta[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // Hydrate persisted config + picks on mount
  useEffect(() => {
    (async () => {
      const [persistedBase, persistedKey, persistedPicks] = await Promise.all([
        loadApiBase(),
        loadApiKey(),
        loadSelectedChannels(),
      ])
      if (persistedBase) setApiBase(persistedBase)
      if (persistedKey !== null) setApiKey(persistedKey)
      if (persistedPicks) setSelected(persistedPicks)
    })()
  }, [])

  // Fetch catalogue whenever the API target changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCatalogue(apiBase, apiKey)
      .then((list) => {
        if (cancelled) return
        setChannels(list)
        // If no user picks yet, default to the first three channels so
        // the feed isn't empty on first launch.
        if (selected.length === 0 && list.length > 0) {
          setSelected(list.slice(0, 3).map((c) => c.id))
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, apiKey])

  const toggleChannel = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      saveSelectedChannels(next)
      return next
    })
  }

  const openFeed = () => {
    if (selected.length === 0) return
    navigation.navigate('NewsFeed', { channels: selected, apiBase, apiKey })
  }

  const saveSettings = async () => {
    await saveApiBase(apiBase)
    await saveApiKey(apiKey)
    setShowSettings(false)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>DealNector · News Hub</Text>
          <Text style={styles.title}>Pick your industries</Text>
          <Text style={styles.sub}>
            Swipe through Flipboard-style cards for every channel you follow.
          </Text>
        </View>
        <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.settingsBtn}>
          <Text style={styles.settingsBtnText}>⚙</Text>
        </Pressable>
      </View>

      {showSettings && (
        <View style={styles.settings}>
          <Text style={styles.settingsLabel}>API base URL</Text>
          <TextInput
            style={styles.input}
            value={apiBase}
            onChangeText={setApiBase}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://your-dealnector-host.example.com"
            placeholderTextColor={TEXT_MUTED}
          />
          <Text style={[styles.settingsLabel, { marginTop: 10 }]}>API key (optional)</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Leave blank if server is open"
            placeholderTextColor={TEXT_MUTED}
          />
          <Pressable onPress={saveSettings} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>Save + refresh</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND_GOLD} />
          <Text style={styles.centerText}>Loading channel catalogue…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Could not reach DealNector</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Text style={styles.errorHint}>
            Tap the ⚙ icon to set the API base URL and key.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {channels.map((ch) => {
            const on = selected.includes(ch.id)
            return (
              <Pressable
                key={ch.id}
                onPress={() => toggleChannel(ch.id)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: on ? ch.color : BORDER,
                    backgroundColor: on ? ch.color + '18' : PANEL,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.chipRow}>
                  <View style={[styles.dot, { backgroundColor: ch.color }]} />
                  <Text style={[styles.chipLabel, { color: on ? ch.color : TEXT }]}>
                    {on ? '✓ ' : ''}
                    {ch.label}
                  </Text>
                </View>
                {ch.tagline ? (
                  <Text style={styles.chipTagline}>{ch.tagline}</Text>
                ) : null}
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerCount}>
          {selected.length} of {channels.length} channels selected
        </Text>
        <Pressable
          onPress={openFeed}
          disabled={selected.length === 0}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: selected.length === 0 ? '#334155' : BRAND_GOLD,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.ctaText,
              { color: selected.length === 0 ? TEXT_MUTED : BRAND_NAVY },
            ]}
          >
            Open news flipboard →
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND_NAVY },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  eyebrow: {
    fontSize: 10,
    color: BRAND_GOLD,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    color: TEXT,
    fontWeight: '700',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginTop: 6,
    lineHeight: 19,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBtnText: { fontSize: 18, color: TEXT_MUTED },
  settings: {
    marginHorizontal: 20,
    padding: 14,
    backgroundColor: PANEL,
    borderRadius: 10,
    borderColor: BORDER,
    borderWidth: 1,
    marginBottom: 10,
  },
  settingsLabel: {
    fontSize: 11,
    color: TEXT_MUTED,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 5,
  },
  input: {
    backgroundColor: '#0d2040',
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 6,
    color: TEXT,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  saveBtn: {
    marginTop: 12,
    backgroundColor: BRAND_GOLD,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  saveBtnText: { color: BRAND_NAVY, fontWeight: '800', fontSize: 13, letterSpacing: 0.4 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  chip: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipLabel: { fontSize: 15, fontWeight: '700' },
  chipTagline: { color: TEXT_MUTED, fontSize: 12, marginTop: 5, lineHeight: 17 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  centerText: { color: TEXT_MUTED, marginTop: 10, fontSize: 13 },
  errorTitle: {
    color: '#fca5a5',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  errorBody: {
    color: TEXT_MUTED,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  errorHint: { color: TEXT_MUTED, fontSize: 11, fontStyle: 'italic' },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footerCount: { color: TEXT_MUTED, fontSize: 11, flex: 1 },
  cta: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
  },
  ctaText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
})
