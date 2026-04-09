import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const protectedPaths = ['/dashboard', '/deal-tracker', '/valuation', '/watchlist', '/news', '/settings']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = protectedPaths.some((p) => pathname.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })

  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/deal-tracker/:path*', '/valuation/:path*', '/watchlist/:path*', '/news/:path*', '/settings/:path*'],
}
