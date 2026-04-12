require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');
const {
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

function getBetById(id) {
  return db.get('bets').find({ id }).value() || null;
}

function getBetByInviteCode(inviteCode) {
  const code = String(inviteCode || '').toUpperCase();
  return db.get('bets').find((bet) => String(bet.invite_code || '').toUpperCase() === code).value() || null;
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

app.get('/health', (_req, res) => {
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

app.post('/bets/:id/quote', (req, res) => {
  const bet = getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  if (!['CREATED', 'ACCEPTED'].includes(bet.status)) {
    return sendError(res, 400, 'Bet is no longer available');
  }

  const { user_address } = req.body || {};

  getDepositQuote(user_address, bet.amount_usdc)
    .then((quote) => res.json(quote))
    .catch((error) => sendError(res, error.status || 500, error.message));
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

    db.get('bets').push(bet).write();

    return res.status(201).json({
      ...bet,
      invite_url: `http://localhost:5173/bet/${bet.invite_code}`
    });
  } catch (error) {
    return sendError(res, error.status || 500, error.message);
  }
});

app.get('/bets/invite/:invite_code', (req, res) => {
  const bet = getBetByInviteCode(req.params.invite_code);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  return res.json(bet);
});

app.get('/bets/:id', (req, res) => {
  const bet = getBetById(req.params.id);

  if (!bet) {
    return sendError(res, 404, 'Bet not found');
  }

  return res.json(bet);
});

app.post('/bets/invite/:invite_code/accept', (req, res) => {
  const bet = getBetByInviteCode(req.params.invite_code);

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

  const updatedBet = db.get('bets')
    .find({ id: bet.id })
    .assign({
      opponent_address,
      status: 'ACCEPTED'
    })
    .write();

  return res.json(updatedBet);
});

app.post('/bets/:id/lock', (req, res) => {
  const bet = getBetById(req.params.id);

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
  } else if (bet.creator_locked && bet.opponent_locked) {
    updates.status = 'LOCKED';
  }

  const nextBet = db.get('bets')
    .find({ id: bet.id })
    .assign(updates)
    .write();

  if (nextBet.creator_locked && nextBet.opponent_locked && nextBet.status !== 'LOCKED') {
    db.get('bets')
      .find({ id: bet.id })
      .assign({ status: 'LOCKED' })
      .write();
    nextBet.status = 'LOCKED';
  }

  return res.json(nextBet);
});

app.post('/bets/:id/resolve', (req, res) => {
  const bet = getBetById(req.params.id);

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

  const updatedBet = db.get('bets')
    .find({ id: bet.id })
    .assign({
      proposed_winner_address: winner_address,
      proposed_by_address: resolver_address
    })
    .write();

  return res.json(updatedBet);
});

app.post('/bets/:id/confirm', (req, res) => {
  const bet = getBetById(req.params.id);

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

  const updatedBet = db.get('bets')
    .find({ id: bet.id })
    .assign({
      winner_address: bet.proposed_winner_address,
      status: 'RESOLVED',
      resolved_at: new Date().toISOString()
    })
    .write();

  return res.json(updatedBet);
});

app.post('/bets/:id/dispute', (req, res) => {
  const bet = getBetById(req.params.id);

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

  const updatedBet = db.get('bets')
    .find({ id: bet.id })
    .assign({
      status: 'DISPUTED'
    })
    .write();

  return res.json(updatedBet);
});

app.get('/bets', (_req, res) => {
  return res.json(db.get('bets').value());
});

app.listen(port, () => {
  console.log(`Resolver backend listening on port ${port}`);
  (async () => {
    try {
      const vault = await getBestUSDCVault();
      const apy = vault.analytics?.apy?.total || vault.analytics?.apy?.base || 'n/a';
      console.log(`Boot vault: ${vault.name} | APY: ${apy}%`);
    } catch (error) {
      console.error('Initial LI.FI Earn vault check failed');
      console.error(error.message);
    }
  })();
});

module.exports = app;
