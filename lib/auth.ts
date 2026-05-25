import type { NextAuthOptions, Session } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

function parseAllowlist(): string[] {
  const raw = process.env.ADMIN_ALLOWLIST ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowlistedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return parseAllowlist().includes(email.toLowerCase())
}

const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_MAX_AGE_SECONDS,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  callbacks: {
    async signIn({ user }) {
      return isAllowlistedEmail(user.email)
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email.toLowerCase()
      }
      return token
    },
    async session({ session, token }): Promise<Session> {
      if (session.user && typeof token.email === 'string') {
        session.user.email = token.email
      }
      return session
    },
  },
}
