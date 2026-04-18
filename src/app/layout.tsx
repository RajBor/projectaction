import type { Metadata } from 'next'
import './globals.css'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { Providers } from '@/components/Providers'

export const metadata: Metadata = {
  title: 'DealNector — Strategic M&A Intelligence Platform',
  description:
    'DealNector is a strategic-growth and deal-finding platform covering the energy value chain and adjacent industrial sectors — map targets, score acquisitions, and generate institutional-grade reports.',
  robots: { index: false, follow: false },
  other: {
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  },
  openGraph: {
    title: 'DealNector — Strategic M&A Intelligence Platform',
    description:
      'Strategic-growth and deal-finding platform for the energy value chain. Map targets, score acquisitions, generate institutional reports.',
    siteName: 'DealNector',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DealNector — Strategic M&A Intelligence Platform',
    description:
      'Strategic-growth and deal-finding platform for the energy value chain.',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
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
