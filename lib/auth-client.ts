import { createAuthClient } from 'better-auth/react'

/** Same-origin Better Auth client (base `/api/auth`). Used by app/(auth), TopBar sign-out and settings. */
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
