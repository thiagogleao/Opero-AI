/**
 * lib/period — the single source of the period rules for the desktop site
 * and the phone (D:/opero-tmp/period/spec.md). Pure and isomorphic: no
 * `new Date()`, no `Date.now()`, no window, no DB; every function takes `now`
 * and the store facts. The client-only companions live in ./client.
 */

export * from './types'
export * from './clock'
export * from './value'
export * from './compare'
export * from './facts'
export * from './resolve'
export * from './carry'
export * from './url'
export * from './notes'
export * from './landing'
export * from './push'
export * from './decision'
export * from './viewer'
export * as phone from './phone'
export * from './windows'
export * from './feed'
