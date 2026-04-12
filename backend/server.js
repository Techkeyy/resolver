require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { pool, initDB } = require('./db');
const {
  BEST_VAULT,
  getBestUSDCVault,
  getDepositQuote,
  getVaults
} = require('./earn');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ error: message });
}

function normalizeAddress(address) {
  return String(address || '').toLowerCase();
}

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function getBetById(id) {
  const r = await pool.query('SELECT * FROM bets WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function getBetByInviteCode(code) {
  const r = await pool.query(
    'SELECT * FROM bets WHERE UPPER(invite_code) = UPPER($1)', [code]
  );
  return r.rows[0] || null;
}

async function updateBet(id, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await pool.query(
    `UPDATE bets SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0];
}

function earnHeaders() {
  return {
    accept: 'application/json',
    'x-lifi-api-key': process.env.LIFI_API_KEY || ''
  };
}

async function fetchEarnVaults(params) {
  const url = new URL('https://earn.li.fi/v1/earn/vaults');

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: earnHeaders()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `LI.FI request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : payload?.data || payload?.items || [];

  return items;
}

function summarizeVaults(vaults) {
  return vaults.slice(0, 3).map((vault) => ({
    name: vault?.name,
    analytics: vault?.analytics
  }));
}

app.get('/health', async (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/earn/vaults', async (_req, res) => {
  try {
    const vaults = await getVaults();
    res.json(vaults);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/earn/best-vault', async (_req, res) => {
  try {
    const vault = await getBestUSDCVault();
    res.json(vault);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/earn/debug-vaults', async (_req, res) => {
  try {
    const [noFilter, usdcOnly, usdcWithTvl] = await Promise.all([
      fetchEarnVaults({ chainId: 8453, sortBy: 'apy', limit: 10 }),
      fetchEarnVaults({ chainId: 8453, asset: 'USDC', sortBy: 'apy', limit: 10 }),
      fetchEarnVaults({ chainId: 8453, asset: 'USDC', sortBy: 'apy', minTvlUsd: 100000, limit: 10 })
    ]);

    res.json({
      no_filter: summarizeVaults(noFilter),
      usdc_only: summarizeVaults(usdcOnly),
      usdc_with_tvl: summarizeVaults(usdcWithTvl)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/bets/:id/quote', async (req, res) => {
  const bet = await getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  if (!['CREATED', 'ACCEPTED'].includes(bet.status)) {
    return sendError(res, 400, 'Bet is no longer available');
  }

  const { user_address } = req.body || {};

  try {
    const quote = await getDepositQuote(user_address, bet.amount_usdc);
    res.json(quote);
  } catch (error) {
    sendError(res, error.status || 500, error.message);
  }
});

app.post('/bets', async (req, res) => {
  try {
    const { creator_address, statement, amount_usdc } = req.body || {};

    if (!creator_address || !statement || amount_usdc === undefined || amount_usdc === null) {
      return sendError(res, 400, 'Missing required fields');
    }

    if (Number(amount_usdc) <= 0) {
      return sendError(res, 400, 'amount_usdc must be greater than 0');
    }

    if (!String(creator_address).startsWith('0x')) {
      return sendError(res, 400, 'creator_address must start with 0x');
    }

    const vault = await getBestUSDCVault();
    const bet = {
      id: crypto.randomUUID(),
      invite_code: generateInviteCode(),
      statement,
      amount_usdc: Number(amount_usdc),
      creator_address,
      opponent_address: null,
      status: 'CREATED',
      creator_locked: false,
      opponent_locked: false,
      vault_address: vault.address,
      vault_chain_id: vault.chainId || 42161,
      creator_deposit_tx: null,
      opponent_deposit_tx: null,
      proposed_winner_address: null,
      proposed_by_address: null,
      winner_address: null,
      payout_tx: null,
      created_at: new Date().toISOString(),
      resolved_at: null
    };

    await pool.query(
      `INSERT INTO bets (id,invite_code,statement,amount_usdc,
       creator_address,opponent_address,status,creator_locked,
       opponent_locked,vault_address,vault_chain_id,
       creator_deposit_tx,opponent_deposit_tx,
       proposed_winner_address,proposed_by_address,
       winner_address,payout_tx)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [bet.id, bet.invite_code, bet.statement, bet.amount_usdc,
       bet.creator_address, null, 'CREATED', false, false,
       bet.vault_address, 8453, null, null, null, null, null, null]
    );

    return res.status(201).json({
      ...bet,
      invite_url: `http://localhost:5173/bet/${bet.invite_code}`
    });
  } catch (error) {
    return sendError(res, error.status || 500, error.message);
  }
});

app.get('/bets/invite/:invite_code', async (req, res) => {
  const bet = await getBetByInviteCode(req.params.invite_code);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  return res.json(bet);
});

app.get('/bets/:id', async (req, res) => {
  const bet = await getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  return res.json(bet);
});

app.post('/bets/invite/:invite_code/accept', async (req, res) => {
  const bet = await getBetByInviteCode(req.params.invite_code);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  const { opponent_address } = req.body || {};

  if (bet.status !== 'CREATED') {
    return sendError(res, 400, 'Bet is no longer available');
  }

  if (!opponent_address || !String(opponent_address).startsWith('0x')) {
    return sendError(res, 400, 'opponent_address must start with 0x');
  }

  if (normalizeAddress(opponent_address) === normalizeAddress(bet.creator_address)) {
    return sendError(res, 400, 'Cannot accept your own bet');
  }

  const updatedBet = await updateBet(bet.id, {
    opponent_address,
    status: 'ACCEPTED'
  });

  return res.json(updatedBet);
});

app.post('/bets/:id/lock', async (req, res) => {
  const bet = await getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  const { user_address, tx_hash } = req.body || {};

  if (!['ACCEPTED', 'CREATED'].includes(bet.status)) {
    return sendError(res, 400, 'Bet is no longer available');
  }

  const userAddress = normalizeAddress(user_address);
  const creatorAddress = normalizeAddress(bet.creator_address);
  const opponentAddress = normalizeAddress(bet.opponent_address);
  const isCreator = userAddress && userAddress === creatorAddress;
  const isOpponent = userAddress && userAddress === opponentAddress;

  if (!isCreator && !isOpponent) {
    return sendError(res, 400, 'Not a participant');
  }

  const updates = {};

  if (isCreator) {
    updates.creator_locked = true;
    updates.creator_deposit_tx = tx_hash;
  }

  if (isOpponent) {
    updates.opponent_locked = true;
    updates.opponent_deposit_tx = tx_hash;
  }

  if (updates.creator_locked && updates.opponent_locked) {
    updates.status = 'LOCKED';
  } else if ((isCreator ? true : bet.creator_locked) && (isOpponent ? true : bet.opponent_locked)) {
    updates.status = 'LOCKED';
  }

  const nextBet = await updateBet(bet.id, updates);

  return res.json(nextBet);
});

app.post('/bets/:id/resolve', async (req, res) => {
  const bet = await getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  if (bet.status !== 'LOCKED') {
    return sendError(res, 400, 'Bet is no longer available');
  }

  const { resolver_address, winner_address } = req.body || {};
  const resolverAddress = normalizeAddress(resolver_address);
  const creatorAddress = normalizeAddress(bet.creator_address);
  const opponentAddress = normalizeAddress(bet.opponent_address);
  const winnerAddress = normalizeAddress(winner_address);
  const isParticipant = resolverAddress && (resolverAddress === creatorAddress || resolverAddress === opponentAddress);
  const isWinnerParticipant = winnerAddress && (winnerAddress === creatorAddress || winnerAddress === opponentAddress);

  if (!isParticipant) {
    return sendError(res, 400, 'Not a participant');
  }

  if (!isWinnerParticipant) {
    return sendError(res, 400, 'Not a participant');
  }

  const updatedBet = await updateBet(bet.id, {
    proposed_winner_address: winner_address,
    proposed_by_address: resolver_address
  });

  return res.json(updatedBet);
});

app.post('/bets/:id/confirm', async (req, res) => {
  const bet = await getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  const { confirmer_address } = req.body || {};
  const confirmerAddress = normalizeAddress(confirmer_address);
  const creatorAddress = normalizeAddress(bet.creator_address);
  const opponentAddress = normalizeAddress(bet.opponent_address);
  const isParticipant = confirmerAddress && (confirmerAddress === creatorAddress || confirmerAddress === opponentAddress);

  if (!bet.proposed_winner_address) {
    return sendError(res, 400, 'No proposed winner');
  }

  if (!isParticipant) {
    return sendError(res, 400, 'Not a participant');
  }

  if (normalizeAddress(bet.proposed_by_address) === confirmerAddress) {
    return sendError(res, 400, 'Proposer cannot confirm their own resolution');
  }

  const updatedBet = await updateBet(bet.id, {
    winner_address: bet.proposed_winner_address,
    status: 'RESOLVED',
    resolved_at: new Date()
  });

  return res.json(updatedBet);
});

app.post('/bets/:id/dispute', async (req, res) => {
  const bet = await getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  const { disputer_address } = req.body || {};
  const disputerAddress = normalizeAddress(disputer_address);
  const creatorAddress = normalizeAddress(bet.creator_address);
  const opponentAddress = normalizeAddress(bet.opponent_address);
  const isParticipant = disputerAddress && (disputerAddress === creatorAddress || disputerAddress === opponentAddress);

  if (!isParticipant) {
    return sendError(res, 400, 'Not a participant');
  }

  if (normalizeAddress(bet.proposed_by_address) === disputerAddress) {
    return sendError(res, 400, 'Not a participant');
  }

  const updatedBet = await updateBet(bet.id, {
    status: 'DISPUTED'
  });

  return res.json(updatedBet);
});

app.get('/bets', async (_req, res) => {
  const r = await pool.query('SELECT * FROM bets ORDER BY created_at DESC');
  return res.json(r.rows);
});

async function start() {
  try {
    await initDB();
    app.listen(port, () => {
      console.log(`Resolver backend listening on port ${port}`);
      console.log(`Boot vault: ${BEST_VAULT.name} | APY: ${BEST_VAULT.analytics.apy.total}% | Morpho on Base`);
    });
  } catch (error) {
    console.error('Failed to initialize PostgreSQL');
    console.error(error.message);
    process.exit(1);
  }
}

start();

module.exports = app;
