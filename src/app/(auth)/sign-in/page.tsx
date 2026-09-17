import type { Metadata } from 'next'
import { AuthForm } from '../_components/AuthForm'

export const metadata: Metadata = { title: '登录' }

export default function SignInPage() {
  return <AuthForm mode="sign-in" />
}
