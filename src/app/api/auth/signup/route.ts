import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { geoFromRequest } from '@/lib/ip-location'

/** Generate a 6-char uppercase alphanumeric auth code (e.g., DN7K2P) */
function generateAuthCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // exclude confusing chars: 0/O, 1/I
  const bytes = crypto.randomBytes(6)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

export async function POST(request: NextRequest) {
  try {
    await ensureSchema()
    const body = await request.json()
    const {
      username,
      email,
      password,
      fullName,
      phone,
      organization,
      designation,
      officialEmail,
    } = body

    // Validate required fields
    if (!username || !email || !password) {
      return NextResponse.json(
        { error: 'Username, email, and password are required' },
        { status: 400 }
      )
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { error: 'Username must be between 3 and 50 characters' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    // Optional phone validation (accepts +, digits, spaces, hyphens, 7..20 chars)
    let normalizedPhone: string | null = null
    if (phone) {
      const trimmed = String(phone).trim()
      if (!/^[+\d][\d\s\-().]{6,20}$/.test(trimmed)) {
        return NextResponse.json(
          { error: 'Invalid phone number format' },
          { status: 400 }
        )
      }
      normalizedPhone = trimmed
    }

    // Optional organization details
    const normOrg =
      typeof organization === 'string' && organization.trim()
        ? organization.trim().slice(0, 160)
        : null
    const normDesignation =
      typeof designation === 'string' && designation.trim()
        ? designation.trim().slice(0, 120)
        : null

    // Optional official email (validated with same regex; may differ from login email)
    let normOfficialEmail: string | null = null
    if (officialEmail && String(officialEmail).trim()) {
      const trimmed = String(officialEmail).trim()
      if (!emailRegex.test(trimmed)) {
        return NextResponse.json(
          { error: 'Invalid official email address' },
          { status: 400 }
        )
      }
      normOfficialEmail = trimmed.slice(0, 160)
    }

    // Check for duplicate username or email
    const existing = await sql`
      SELECT id FROM users
      WHERE username = ${username} OR email = ${email}
      LIMIT 1
    `

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Username or email already exists' },
        { status: 409 }
      )
    }

    // Capture client IP + location (best-effort, non-blocking on failure)
    const { ip, location } = await geoFromRequest(request)

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10)

    // Generate unique auth code for admin-approved activation
    const authCode = generateAuthCode()

    // Insert user as INACTIVE (pending admin approval)
    const newUser = await sql`
      INSERT INTO users (
        username, email, password_hash, full_name, role,
        phone, signup_ip, signup_location,
        organization, designation, official_email,
        is_active, auth_code, auth_code_used
      )
      VALUES (
        ${username}, ${email}, ${passwordHash}, ${fullName || null}, 'analyst',
        ${normalizedPhone}, ${ip}, ${location},
        ${normOrg}, ${normDesignation}, ${normOfficialEmail},
        false, ${authCode}, false
      )
      RETURNING id, username, email, full_name, role, created_at
    `

    const user = newUser[0]

    // Welcome email is NOT sent here — it's sent when admin approves the user

    return NextResponse.json({
      success: true,
      pendingApproval: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        createdAt: user.created_at,
      },
    })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
