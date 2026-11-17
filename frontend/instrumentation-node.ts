import { startAutoSync } from './lib/autoSync'

// Node runtime only (see instrumentation.ts). startAutoSync is idempotent and
// does nothing with AUTO_SYNC_DISABLED=1 or DATABASE_READ_ONLY=1.
startAutoSync()
