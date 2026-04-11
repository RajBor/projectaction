import type { AuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { lookupLocation } from '@/lib/ip-location'

/** Extract the client IP from the NextAuth authorize() req object. */
function ipFromAuthorizeReq(req: unknown): string | null {
  if (!req || typeof req !== 'object') return null
  const r = req as {
    headers?: Record<string, string | string[] | undefined>
  }
  const h = r.headers || {}
  const read = (key: string): string | null => {
    const v = h[key] ?? h[key.toLowerCase()]
    if (!v) return null
    if (Array.isArray(v)) return v[0]?.split(',')[0]?.trim() ?? null
    return String(v).split(',')[0]?.trim() ?? null
  }
  return (
    read('x-forwarded-for') ||
    read('x-real-ip') ||
    read('cf-connecting-ip') ||
    null
  )
}

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) return null
        try {
          await ensureSchema()
          const rows = await sql`
            SELECT * FROM users
            WHERE (username = ${credentials.username} OR email = ${credentials.username})
            AND is_active = true
            LIMIT 1
          `
          if (!rows[0]) return null
          const user = rows[0]
          const valid = await bcrypt.compare(credentials.password, user.password_hash)
          if (!valid) return null

          // Best-effort IP + geolocation capture — never blocks sign-in
          let ip: string | null = null
          let location: string | null = null
          try {
            ip = ipFromAuthorizeReq(req)
            location = await lookupLocation(ip)
          } catch {
            /* ignore */
          }
          await sql`
            UPDATE users
            SET last_login = NOW(),
                last_login_ip = COALESCE(${ip}, last_login_ip),
                last_login_location = COALESCE(${location}, last_login_location)
            WHERE id = ${user.id}
          `
          return {
            id: String(user.id),
            name: user.full_name || user.username,
            email: user.email,
            username: user.username,
            role: user.role,
          }
        } catch {
          return null
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.username = (user as { username: string }).username
        token.role = (user as { role: string }).role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        ;(session.user as { username: string }).username = token.username as string
        ;(session.user as { role: string }).role = token.role as string
      }
      return session
    },
  },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
}
