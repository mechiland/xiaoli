// The ONLY way modules build in-app URLs (ARCHITECTURE §1.1, §3).

export type AnchorType = 'claim' | 'relation' | 'date' | 'event' | 'handle' | 'loop' | 'segment'

/** DOM id of an item row, e.g. 'claim-345'. */
export function anchorId(type: AnchorType, id: number): string {
  return `${type}-${id}`
}

/** '/p/12' | '/p/12#claim-345' */
export function personHref(id: number, anchor?: { type: AnchorType; id: number }): string {
  return anchor ? `/p/${id}#${anchorId(anchor.type, anchor.id)}` : `/p/${id}`
}

/** '/chats/4' | '/chats/4?at=987' */
export function chatHref(chatId: number, messageId?: number): string {
  return messageId === undefined ? `/chats/${chatId}` : `/chats/${chatId}?at=${messageId}`
}

/** '/imports/3' */
export function importHref(importId: number): string {
  return `/imports/${importId}`
}

export const homeHref = '/'
export const peopleHref = '/people'
export const tasksHref = '/tasks'
export const tasksRangeHref = (days: 7 | 30) => `${tasksHref}?range=${days}`
export const settingsHref = '/settings'
export const signInHref = '/sign-in'
export const signUpHref = '/sign-up'
export const welcomeHref = '/welcome'
