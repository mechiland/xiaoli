import type { Metadata } from 'next'
import { AuthForm } from '../_components/AuthForm'

export const metadata: Metadata = { title: '注册' }

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />
}
