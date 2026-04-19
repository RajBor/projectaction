/**
 * AsyncStorage wrapper — persists user preferences between app launches.
 * Keys are versioned so shape changes won't read stale data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const SELECTED_CHANNELS_KEY = 'dealnector:channels:v1'
const API_BASE_KEY = 'dealnector:apiBase:v1'
const API_KEY_KEY = 'dealnector:apiKey:v1'

export async function loadSelectedChannels(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(SELECTED_CHANNELS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null
  } catch {
    return null
  }
}

export async function saveSelectedChannels(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SELECTED_CHANNELS_KEY, JSON.stringify(ids))
  } catch {
    /* ignore quota errors */
  }
}

export async function loadApiBase(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(API_BASE_KEY)
  } catch {
    return null
  }
}

export async function saveApiBase(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(API_BASE_KEY, url)
  } catch {
    /* ignore */
  }
}

export async function loadApiKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(API_KEY_KEY)
  } catch {
    return null
  }
}

export async function saveApiKey(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(API_KEY_KEY, key)
  } catch {
    /* ignore */
  }
}
