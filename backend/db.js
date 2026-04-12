const { Pool } = require('pg')

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: { rejectUnauthorized: false }
})

async function initDB() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS bets (
			id TEXT PRIMARY KEY,
			invite_code TEXT UNIQUE NOT NULL,
			statement TEXT NOT NULL,
			amount_usdc REAL NOT NULL,
			creator_address TEXT NOT NULL,
			opponent_address TEXT,
			status TEXT DEFAULT 'CREATED',
			creator_locked BOOLEAN DEFAULT FALSE,
			opponent_locked BOOLEAN DEFAULT FALSE,
			vault_address TEXT,
			vault_chain_id INTEGER DEFAULT 8453,
			creator_deposit_tx TEXT,
			opponent_deposit_tx TEXT,
			proposed_winner_address TEXT,
			proposed_by_address TEXT,
			winner_address TEXT,
			payout_tx TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			resolved_at TIMESTAMPTZ
		)
	`)

	await pool.query(`
		CREATE TABLE IF NOT EXISTS transactions (
			id TEXT PRIMARY KEY,
			bet_id TEXT NOT NULL,
			wallet_address TEXT NOT NULL,
			type TEXT NOT NULL,
			amount_usdc REAL NOT NULL,
			tx_hash TEXT,
			chain_id INTEGER DEFAULT 8453,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)
	console.log('PostgreSQL initialized')
}

module.exports = { pool, initDB }
