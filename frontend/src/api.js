const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function createBet(creator_address, statement, amount_usdc) {
	const res = await fetch(`${BASE}/bets`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ creator_address, statement, amount_usdc })
	});
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function getBetByInviteCode(invite_code) {
	const res = await fetch(`${BASE}/bets/invite/${invite_code}`);
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function acceptBet(invite_code, opponent_address) {
	const res = await fetch(`${BASE}/bets/invite/${invite_code}/accept`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ opponent_address })
	});
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function lockFunds(bet_id, user_address, tx_hash) {
	const res = await fetch(`${BASE}/bets/${bet_id}/lock`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ user_address, tx_hash })
	});
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function getDepositQuote(bet_id, user_address) {
	const res = await fetch(`${BASE}/bets/${bet_id}/quote`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ user_address })
	});
	if (!res.ok) throw new Error((await res.json()).error || 'Quote failed');
	return res.json();
}

export async function resolveBet(bet_id, resolver_address, winner_address) {
	const res = await fetch(`${BASE}/bets/${bet_id}/resolve`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ resolver_address, winner_address })
	});
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function confirmResolution(bet_id, confirmer_address) {
	const res = await fetch(`${BASE}/bets/${bet_id}/confirm`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ confirmer_address })
	});
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function disputeBet(bet_id, disputer_address) {
	const res = await fetch(`${BASE}/bets/${bet_id}/dispute`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ disputer_address })
	});
	if (!res.ok) throw new Error((await res.json()).error);
	return res.json();
}

export async function getBestVault() {
	const res = await fetch(`${BASE}/earn/best-vault`);
	if (!res.ok) throw new Error('Failed to fetch vault');
	return res.json();
}

export async function getUserBets(wallet_address) {
	const res = await fetch(`${BASE}/bets?wallet=${encodeURIComponent(wallet_address)}`)
	if (!res.ok) return []
	return res.json()
}

export async function getWalletBalance(wallet_address) {
	const res = await fetch(`${BASE}/wallet/balance?address=${encodeURIComponent(wallet_address)}`)
	if (!res.ok) return null
	return res.json()
}
