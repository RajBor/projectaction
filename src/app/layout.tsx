import type { Metadata } from 'next'
import './globals.css'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { Providers } from '@/components/Providers'

export const metadata: Metadata = {
  title: 'DealNector — Solar Intelligence Platform',
  description: 'Institutional renewable energy deal intelligence platform',
  robots: { index: false, follow: false }, // prevent search engine indexing
  other: {
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  )
}
