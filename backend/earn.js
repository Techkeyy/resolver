const BASE_EARN_URL = 'https://earn.li.fi';
const COMPOSER_URL = 'https://li.quest';
const BASE_CHAIN_ID = 8453;
const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedBestVault = null;
let cachedBestVaultAt = 0;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.message || JSON.stringify(payload);
    const error = new Error(message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function earnHeaders() {
  const headers = {
    accept: 'application/json',
    'x-lifi-api-key': process.env.LIFI_API_KEY || ''
  };

  return headers;
}

function toVaultList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
}

async function getVaults() {
  const url = new URL('/v1/earn/vaults', BASE_EARN_URL);
  url.searchParams.set('chainId', String(BASE_CHAIN_ID));
  url.searchParams.set('asset', 'USDC');
  url.searchParams.set('sortBy', 'apy');
  url.searchParams.set('limit', '10');

  const payload = await fetchJson(url.toString(), {
    method: 'GET',
    headers: earnHeaders()
  });

  return toVaultList(payload);
}

async function getBestUSDCVault() {
  if (cachedBestVault && Date.now() - cachedBestVaultAt < CACHE_TTL_MS) {
    return cachedBestVault;
  }

  const url = new URL('/v1/earn/vaults', BASE_EARN_URL);
  url.searchParams.set('chainId', String(BASE_CHAIN_ID));
  url.searchParams.set('asset', 'USDC');
  url.searchParams.set('sortBy', 'apy');
  url.searchParams.set('limit', '20');

  const payload = await fetchJson(url.toString(), {
    method: 'GET',
    headers: earnHeaders()
  });

  const vaults = toVaultList(payload);
  const bestVault = vaults.find((vault) => vault.isTransactional === true);

  if (!bestVault) {
    throw new Error('No suitable USDC vault found on Base');
  }

  const apy = bestVault.analytics?.apy?.total || bestVault.analytics?.apy?.base || 'n/a';

  cachedBestVault = bestVault;
  cachedBestVaultAt = Date.now();
  console.log(`Best vault: ${bestVault.name} | APY: ${apy}%`);
  return bestVault;
}

async function getVaultByAddress(chainId, address) {
  const url = new URL(`/v1/earn/vaults/${chainId}/${address}`, BASE_EARN_URL);

  const payload = await fetchJson(url.toString(), {
    method: 'GET',
    headers: earnHeaders()
  });

  return payload?.data ?? payload;
}

async function getDepositQuote(fromWalletAddress, amountUSDC) {
  const vault = await getBestUSDCVault();
  // Convert USDC amount to 6-decimal units
  const fromAmount = Math.floor(amountUSDC * 1_000_000).toString();

  // Use vault.address directly as toToken per LI.FI docs
  const params = new URLSearchParams({
    fromChain: '8453',
    toChain: '8453',
    fromToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    toToken: vault.address,
    fromAddress: fromWalletAddress,
    toAddress: fromWalletAddress,
    fromAmount: fromAmount
  });

  console.log(`Getting Composer quote for ${amountUSDC} USDC into vault ${vault.address}`);

  const res = await fetch(
    `https://li.quest/v1/quote?${params}`,
    { headers: { 'x-lifi-api-key': process.env.LIFI_API_KEY } }
  );

  const quote = await res.json();

  if (quote.message || quote.error) {
    throw new Error(quote.message || quote.error);
  }

  if (!quote.transactionRequest) {
    console.log('Quote response:', JSON.stringify(quote, null, 2));
    throw new Error('No transaction request in quote response');
  }

  console.log('Quote received successfully, tx to:', quote.transactionRequest.to);
  return quote;
}

async function getUserPositions(walletAddress) {
  try {
    const url = new URL(`/v1/earn/portfolio/${walletAddress}/positions`, BASE_EARN_URL);
    const payload = await fetchJson(url.toString(), {
      method: 'GET',
      headers: earnHeaders()
    });

    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload?.data)) {
      return payload.data;
    }

    return [];
  } catch (error) {
    return [];
  }
}

module.exports = {
  getBestUSDCVault,
  getVaultByAddress,
  getDepositQuote,
  getUserPositions,
  getVaults
};
