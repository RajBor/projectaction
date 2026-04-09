import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/layout/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) {
    redirect('/login')
  }
  return (
    <DashboardShell
      user={session.user as { name?: string; email?: string; username?: string; role?: string }}
    >
      {children}
    </DashboardShell>
  )
}
