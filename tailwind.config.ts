import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0F17',
        s1: '#111827',
        s2: '#1A2233',
        s3: '#1F2A40',
        s4: '#243050',
        br: '#2A3A55',
        br2: '#35496A',
        br3: '#4A6480',
        gold: '#F0A500',
        gold2: '#F7B731',
        gold3: '#FDD270',
        cyan: '#00B4D8',
        cyan2: '#48CAE4',
        green: '#10B981',
        red: '#EF4444',
        purple: '#8B5CF6',
        orange: '#F59E0B',
        blue: '#3B82F6',
        txt: '#E8EDF5',
        txt2: '#9AAFC8',
        txt3: '#556880',
        txt4: '#3A4F68',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        grotesk: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
