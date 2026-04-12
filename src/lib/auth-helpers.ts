/**
 * Shared auth helper — role checking for admin + subadmin.
 *
 * Roles:
 *   'admin'    — full access, can delete users, change passwords, manage roles
 *   'subadmin' — same as admin EXCEPT: cannot delete users, cannot delete admin,
 *                cannot generate access codes, cannot change admin password
 *   'analyst'  — regular user, no admin access
 *
 * Use isAdminOrSubadmin() for most admin API guards.
 * Use isFullAdmin() for destructive / security-sensitive operations.
 */

export type UserRole = 'admin' | 'subadmin' | 'analyst'

/** True for admin OR subadmin — use for non-destructive admin actions. */
export function isAdminOrSubadmin(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'subadmin'
}

/** True for admin ONLY — use for destructive actions (delete, password, role management). */
export function isFullAdmin(role: string | undefined | null): boolean {
  return role === 'admin'
}

/** Extract role from a NextAuth session user object. */
export function extractRole(user: unknown): string | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: string }).role
}
