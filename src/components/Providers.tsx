'use client'

import { SessionProvider } from 'next-auth/react'
import { ConfigProvider, theme } from 'antd'
import { WorkingPopupProvider } from './working/WorkingPopup'
import { NewsAckProvider } from './news/NewsAckProvider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: '#F7B731',
            colorBgBase: '#111827',
            colorBgContainer: '#1A2233',
            colorBorder: '#2A3A55',
            colorText: '#E8EDF5',
            colorTextSecondary: '#9AAFC8',
            borderRadius: 6,
            fontFamily: 'Inter, sans-serif',
          },
          components: {
            Button: {
              colorPrimary: '#F7B731',
            },
            Input: {
              colorBgContainer: '#1F2A40',
              colorBorder: '#2A3A55',
            },
            Table: {
              colorBgContainer: '#1A2233',
              headerBg: '#1F2A40',
            },
            Modal: {
              contentBg: '#1A2233',
              headerBg: '#1A2233',
            },
            Drawer: {
              colorBgElevated: '#1A2233',
            },
            Select: {
              colorBgContainer: '#1F2A40',
              colorBgElevated: '#1F2A40',
            },
          },
        }}
      >
        <WorkingPopupProvider>
          <NewsAckProvider>{children}</NewsAckProvider>
        </WorkingPopupProvider>
      </ConfigProvider>
    </SessionProvider>
  )
}
