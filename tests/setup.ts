import { resolve } from 'node:path'
import { config } from 'dotenv'

// Load .env from project root
config({ path: resolve(__dirname, '..', '.env'), quiet: true })
