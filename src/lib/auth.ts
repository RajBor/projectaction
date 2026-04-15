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

        // ── Step 1: DB lookup + password check (wrapped in try/catch so a
        // DB/network failure returns null instead of crashing NextAuth).
        let user: Record<string, unknown> & {
          id: number
          username: string
          email: string
          full_name: string | null
          password_hash: string
          role: string
          is_active: boolean
          auth_code: string | null
          auth_code_used: boolean | null
        }
        try {
          await ensureSchema()
          const rows = await sql`
            SELECT * FROM users
            WHERE (username = ${credentials.username} OR email = ${credentials.username})
            LIMIT 1
          `
          if (!rows[0]) return null
          const valid = await bcrypt.compare(credentials.password, rows[0].password_hash)
          if (!valid) return null
          user = rows[0] as typeof user
        } catch (err) {
          console.error('[auth] DB/bcrypt failure during authorize:', err)
          return null
        }

        // ── Step 2: Business-logic errors — thrown OUTSIDE the try so they
        // propagate up to NextAuth and reach the client as result.error.
        // The login page decodes these prefixes to show the right UX
        // (pending-approval notice, or the auth-code prompt).
        if (!user.is_active) {
          throw new Error('PENDING_APPROVAL')
        }
        if (user.auth_code && user.auth_code_used === false) {
          throw new Error('AUTH_CODE_REQUIRED:' + user.email)
        }

        // ── Step 3: Successful login — best-effort IP + geolocation
        // capture. Failures here never block sign-in.
        try {
          const ip = ipFromAuthorizeReq(req)
          const location = await lookupLocation(ip).catch(() => null)
          await sql`
            UPDATE users
            SET last_login = NOW(),
                last_login_ip = COALESCE(${ip}, last_login_ip),
                last_login_location = COALESCE(${location}, last_login_location)
            WHERE id = ${user.id}
          `
        } catch {
          /* telemetry only — never block sign-in */
        }

        return {
          id: String(user.id),
          name: user.full_name || user.username,
          email: user.email,
          username: user.username,
          role: user.role,
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
