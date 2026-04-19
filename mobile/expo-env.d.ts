/// <reference types="expo/types" />

// Ambient types for EXPO_PUBLIC_* env vars (consumed in src/lib/config.ts).
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_BASE?: string
    EXPO_PUBLIC_API_KEY?: string
  }
}
