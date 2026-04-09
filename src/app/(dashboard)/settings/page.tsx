'use client'

import { useState } from 'react'
import { Switch, Input, Button, Select } from 'antd'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { useSession } from 'next-auth/react'

interface NotificationSetting {
  label: string
  description: string
  enabled: boolean
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const [notifications, setNotifications] = useState<NotificationSetting[]>([
    { label: 'Deal Stage Changes', description: 'Alert when a deal moves to a new stage', enabled: true },
    { label: 'New Policy Updates', description: 'Regulatory and policy news from MNRE/CERC', enabled: true },
    { label: 'Price Alerts', description: 'Watchlist company price movements > 3%', enabled: false },
    { label: 'Valuation Triggers', description: 'When target EV is reached for watchlist items', enabled: true },
    { label: 'Weekly Digest', description: 'Weekly portfolio & pipeline summary email', enabled: false },
    { label: 'M&A Alerts', description: 'M&A news in the renewable energy space', enabled: true },
  ])

  const toggleNotification = (index: number) => {
    setNotifications((prev) =>
      prev.map((n, i) => (i === index ? { ...n, enabled: !n.enabled } : n))
    )
  }

  const username = (session?.user as { username?: string })?.username || session?.user?.name || 'User'
  const role = (session?.user as { role?: string })?.role || 'analyst'

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Configuration
        </div>
        <h1
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          Settings
        </h1>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
        }}
      >
        {/* Account Settings */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: '20px',
          }}
        >
          <SectionTitle title="Account Settings" subtitle="Profile" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Full Name
              </label>
              <Input
                defaultValue={session?.user?.name || ''}
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Username
              </label>
              <Input
                defaultValue={username}
                disabled
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt3)',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Email
              </label>
              <Input
                defaultValue={session?.user?.email || ''}
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Role
              </label>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(247,183,49,0.1)',
                  border: '1px solid rgba(247,183,49,0.3)',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontSize: 12,
                  color: 'var(--gold2)',
                  textTransform: 'capitalize',
                }}
              >
                {role}
              </div>
            </div>

            <Button
              type="primary"
              style={{
                background: 'var(--gold2)',
                border: 'none',
                color: '#000',
                fontWeight: 600,
                alignSelf: 'flex-start',
              }}
            >
              Save Changes
            </Button>
          </div>
        </div>

        {/* Notification Preferences */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: '20px',
          }}
        >
          <SectionTitle title="Notifications" subtitle="Alerts & Preferences" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {notifications.map((n, i) => (
              <div
                key={n.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  background: 'var(--s3)',
                  borderRadius: 6,
                  marginBottom: 4,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500, marginBottom: 2 }}>
                    {n.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{n.description}</div>
                </div>
                <Switch
                  checked={n.enabled}
                  onChange={() => toggleNotification(i)}
                  style={{
                    background: n.enabled ? 'var(--green)' : 'var(--s4)',
                    flexShrink: 0,
                    marginLeft: 16,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Display Settings */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: '20px',
          }}
        >
          <SectionTitle title="Display" subtitle="Interface Preferences" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500, marginBottom: 2 }}>
                  Dark Mode
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Always on for institutional use</div>
              </div>
              <Switch
                checked={true}
                disabled
                style={{ background: 'var(--cyan)' }}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Currency Display
              </label>
              <Select
                defaultValue="inr"
                style={{ width: '100%' }}
                options={[
                  { value: 'inr', label: 'Indian Rupee (₹)' },
                  { value: 'usd', label: 'US Dollar ($)' },
                  { value: 'eur', label: 'Euro (€)' },
                ]}
              />
            </div>

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Date Format
              </label>
              <Select
                defaultValue="dd-mmm-yyyy"
                style={{ width: '100%' }}
                options={[
                  { value: 'dd-mmm-yyyy', label: 'DD MMM YYYY' },
                  { value: 'mm-dd-yyyy', label: 'MM/DD/YYYY' },
                  { value: 'yyyy-mm-dd', label: 'YYYY-MM-DD' },
                ]}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500, marginBottom: 2 }}>
                  Animated Charts
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Enable chart animations</div>
              </div>
              <Switch defaultChecked style={{ background: 'var(--cyan)' }} />
            </div>
          </div>
        </div>

        {/* API Keys */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: '20px',
          }}
        >
          <SectionTitle title="API Access" subtitle="Integrations" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                background: 'var(--golddim)',
                border: '1px solid rgba(247,183,49,0.2)',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--txt2)',
              }}
            >
              ⚡ API access is available for Enterprise tier accounts. Contact your administrator to enable data integrations.
            </div>

            {[
              { label: 'Bloomberg Terminal', status: 'Not Connected' },
              { label: 'NSE Data Feed', status: 'Not Connected' },
              { label: 'Refinitiv Eikon', status: 'Not Connected' },
            ].map(({ label, status }) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  background: 'var(--s3)',
                  borderRadius: 6,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt4)' }}>{status}</div>
                </div>
                <Button
                  size="small"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--br2)',
                    color: 'var(--txt3)',
                    fontSize: 11,
                  }}
                >
                  Connect
                </Button>
              </div>
            ))}

            <div>
              <label
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Your API Key
              </label>
              <Input
                defaultValue="dn_live_••••••••••••••••••••••••••••••"
                readOnly
                addonAfter={
                  <span style={{ fontSize: 11, color: 'var(--cyan)', cursor: 'pointer' }}>
                    Regenerate
                  </span>
                }
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt3)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
