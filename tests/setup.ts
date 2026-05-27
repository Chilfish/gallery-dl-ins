import { config } from 'dotenv'
import { resolve } from 'node:path'

// Load .env from project root
config({ path: resolve(__dirname, '..', '.env') })
