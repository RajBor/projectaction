import type { AuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import sql from '@/lib/db'

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null
        try {
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
          await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`
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
