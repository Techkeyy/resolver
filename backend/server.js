const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
require('dotenv').config()

const db = require('./db')
const { getBestUSDCVault, getDepositQuote, getVaults } = require('./earn')

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3001

function sendError(res, code, msg) {
  return res.status(code).json({ error: msg })
}

function getBetById(id) {
  return db.get('bets').find({ id }).value()
}

function getBetByInviteCode(code) {
  return db.get('bets').find(b => 
    b.invite_code?.toUpperCase() === code?.toUpperCase()
  ).value()
}

function updateBet(id, fields) {
  db.get('bets').find({ id }).assign(fields).write()
  return getBetById(id)
}

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// GET /earn/vaults
app.get('/earn/vaults', async (req, res) => {
  try {
    const vaults = await getVaults()
    res.json(vaults)
  } catch(e) {
    sendError(res, 500, e.message)
  }
})

// GET /earn/best-vault
app.get('/earn/best-vault', async (req, res) => {
  try {
    const vault = await getBestUSDCVault()
    res.json(vault)
  } catch(e) {
    sendError(res, 500, e.message)
  }
})

// GET /earn/debug-vaults
app.get('/earn/debug-vaults', async (req, res) => {
  try {
    const headers = { 'x-lifi-api-key': process.env.LIFI_API_KEY }
    const [a, b, c] = await Promise.all([
      fetch('https://earn.li.fi/v1/earn/vaults?chainId=8453&sortBy=apy&limit=10', { headers }).then(r => r.json()),
      fetch('https://earn.li.fi/v1/earn/vaults?chainId=8453&asset=USDC&sortBy=apy&limit=10', { headers }).then(r => r.json()),
      fetch('https://earn.li.fi/v1/earn/vaults?chainId=8453&asset=USDC&sortBy=apy&minTvlUsd=100000&limit=10', { headers }).then(r => r.json()),
    ])
    res.json({
      no_filter: (a.data||[]).slice(0,3).map(v=>({name:v.name,analytics:v.analytics})),
      usdc_only: (b.data||[]).slice(0,3).map(v=>({name:v.name,analytics:v.analytics})),
      usdc_with_tvl: (c.data||[]).slice(0,3).map(v=>({name:v.name,analytics:v.analytics})),
    })
  } catch(e) {
    sendError(res, 500, e.message)
  }
})

// POST /bets — create
app.post('/bets', async (req, res) => {
  const { creator_address, statement, amount_usdc } = req.body || {}
  if (!creator_address || !statement || amount_usdc === undefined)
    return sendError(res, 400, 'Missing required fields')
  if (!creator_address.startsWith('0x'))
    return sendError(res, 400, 'Invalid wallet address')
  if (Number(amount_usdc) <= 0)
    return sendError(res, 400, 'Amount must be greater than 0')
  try {
    const vault = await getBestUSDCVault()
    const id = crypto.randomUUID()
    const invite_code = Math.random().toString(36).substring(2,8).toUpperCase()
    const bet = {
      id, invite_code, statement,
      amount_usdc: Number(amount_usdc),
      creator_address,
      opponent_address: null,
      status: 'CREATED',
      creator_locked: false,
      opponent_locked: false,
      vault_address: vault.address,
      vault_chain_id: 8453,
      creator_deposit_tx: null,
      opponent_deposit_tx: null,
      proposed_winner_address: null,
      proposed_by_address: null,
      winner_address: null,
      payout_tx: null,
      created_at: new Date().toISOString(),
      resolved_at: null
    }
    db.get('bets').push(bet).write()
    res.status(201).json({ ...bet, invite_url: `/bet/${invite_code}` })
  } catch(e) {
    sendError(res, 500, e.message)
  }
})

// GET /bets — list (with optional wallet filter)
app.get('/bets', (req, res) => {
  const { wallet } = req.query
  const all = db.get('bets').value()
  if (!wallet) return res.json(all)
  const filtered = all.filter(b =>
    b.creator_address?.toLowerCase() === wallet.toLowerCase() ||
    b.opponent_address?.toLowerCase() === wallet.toLowerCase()
  )
  res.json(filtered)
})

// GET /bets/invite/:invite_code — MUST be before /bets/:id
app.get('/bets/invite/:invite_code', (req, res) => {
  const bet = getBetByInviteCode(req.params.invite_code)
  if (!bet) return sendError(res, 404, 'Bet not found')
  res.json(bet)
})

// GET /bets/:id
app.get('/bets/:id', (req, res) => {
  const bet = getBetById(req.params.id)
  if (!bet) return sendError(res, 404, 'Bet not found')
  res.json(bet)
})

// POST /bets/invite/:invite_code/accept
app.post('/bets/invite/:invite_code/accept', (req, res) => {
  const bet = getBetByInviteCode(req.params.invite_code)
  if (!bet) return sendError(res, 404, 'Bet not found')
  if (bet.status !== 'CREATED') return sendError(res, 400, 'Bet is no longer available')
  const { opponent_address } = req.body || {}
  if (!opponent_address) return sendError(res, 400, 'opponent_address required')
  if (opponent_address.toLowerCase() === bet.creator_address.toLowerCase())
    return sendError(res, 400, 'Cannot accept your own bet')
  const updated = updateBet(bet.id, { opponent_address, status: 'ACCEPTED' })
  res.json(updated)
})

// POST /bets/:id/lock
app.post('/bets/:id/lock', (req, res) => {
  const bet = getBetById(req.params.id)
  if (!bet) return sendError(res, 404, 'Bet not found')
  if (!['CREATED','ACCEPTED'].includes(bet.status))
    return sendError(res, 400, 'Cannot lock in current status')
  const { user_address, tx_hash } = req.body || {}
  if (!user_address) return sendError(res, 400, 'user_address required')
  const isCreator = user_address.toLowerCase() === bet.creator_address.toLowerCase()
  const isOpponent = bet.opponent_address && user_address.toLowerCase() === bet.opponent_address.toLowerCase()
  if (!isCreator && !isOpponent) return sendError(res, 400, 'Not a participant')
  const fields = {}
  if (isCreator) { fields.creator_locked = true; fields.creator_deposit_tx = tx_hash }
  if (isOpponent) { fields.opponent_locked = true; fields.opponent_deposit_tx = tx_hash }
  const current = { ...bet, ...fields }
  if (current.creator_locked && current.opponent_locked) fields.status = 'LOCKED'
  const updated = updateBet(bet.id, fields)
  res.json(updated)
})

// POST /bets/:id/quote
app.post('/bets/:id/quote', async (req, res) => {
  const bet = getBetById(req.params.id)
  if (!bet) return sendError(res, 404, 'Bet not found')
  if (!['CREATED','ACCEPTED'].includes(bet.status))
    return sendError(res, 400, 'Bet not in lockable state')
  const { user_address } = req.body || {}
  try {
    const quote = await getDepositQuote(user_address, bet.amount_usdc)
    res.json(quote)
  } catch(e) {
    sendError(res, 500, e.message)
  }
})

// POST /bets/:id/resolve
app.post('/bets/:id/resolve', (req, res) => {
  const bet = getBetById(req.params.id)
  if (!bet) return sendError(res, 404, 'Bet not found')
  if (bet.status !== 'LOCKED') return sendError(res, 400, 'Bet must be LOCKED to resolve')
  const { resolver_address, winner_address } = req.body || {}
  const isCreator = resolver_address?.toLowerCase() === bet.creator_address?.toLowerCase()
  const isOpponent = resolver_address?.toLowerCase() === bet.opponent_address?.toLowerCase()
  if (!isCreator && !isOpponent) return sendError(res, 400, 'Not a participant')
  const winnerIsCreator = winner_address?.toLowerCase() === bet.creator_address?.toLowerCase()
  const winnerIsOpponent = winner_address?.toLowerCase() === bet.opponent_address?.toLowerCase()
  if (!winnerIsCreator && !winnerIsOpponent) return sendError(res, 400, 'Winner must be a participant')
  const updated = updateBet(bet.id, {
    proposed_winner_address: winner_address,
    proposed_by_address: resolver_address
  })
  res.json(updated)
})

// POST /bets/:id/confirm
app.post('/bets/:id/confirm', (req, res) => {
  const bet = getBetById(req.params.id)
  if (!bet) return sendError(res, 404, 'Bet not found')
  if (!bet.proposed_winner_address) return sendError(res, 400, 'No resolution proposed yet')
  const { confirmer_address } = req.body || {}
  if (confirmer_address?.toLowerCase() === bet.proposed_by_address?.toLowerCase())
    return sendError(res, 400, 'Proposer cannot confirm their own resolution')
  const isParticipant = 
    confirmer_address?.toLowerCase() === bet.creator_address?.toLowerCase() ||
    confirmer_address?.toLowerCase() === bet.opponent_address?.toLowerCase()
  if (!isParticipant) return sendError(res, 400, 'Not a participant')
  const updated = updateBet(bet.id, {
    winner_address: bet.proposed_winner_address,
    status: 'PAID',
    resolved_at: new Date().toISOString()
  })
  res.json(updated)
})

// POST /bets/:id/dispute
app.post('/bets/:id/dispute', (req, res) => {
  const bet = getBetById(req.params.id)
  if (!bet) return sendError(res, 404, 'Bet not found')
  const { disputer_address } = req.body || {}
  const isParticipant =
    disputer_address?.toLowerCase() === bet.creator_address?.toLowerCase() ||
    disputer_address?.toLowerCase() === bet.opponent_address?.toLowerCase()
  if (!isParticipant) return sendError(res, 400, 'Not a participant')
  if (disputer_address?.toLowerCase() === bet.proposed_by_address?.toLowerCase())
    return sendError(res, 400, 'Proposer cannot dispute their own resolution')
  const updated = updateBet(bet.id, { status: 'DISPUTED' })
  res.json(updated)
})

// GET /wallet/balance
app.get('/wallet/balance', async (req, res) => {
  const { address } = req.query
  if (!address) return sendError(res, 400, 'address required')
  try {
    const resp = await fetch(
      `https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&address=${address}&tag=latest&apikey=YourApiKeyToken`
    )
    const data = await resp.json()
    const usdc = data.result ? (parseInt(data.result) / 1_000_000).toFixed(2) : '0.00'
    res.json({ usdc, address })
  } catch(e) {
    res.json({ usdc: '0.00', address })
  }
})

app.listen(PORT, () => {
  console.log(`Resolver backend listening on port ${PORT}`)
  getBestUSDCVault()
    .then(v => console.log(`Boot vault: ${v.name} | APY: ${v.analytics?.apy?.total || v.analytics?.apy?.base}%`))
    .catch(e => console.error('Boot vault check failed:', e.message))
})
