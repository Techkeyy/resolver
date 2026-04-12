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
    const bestVault = vaults.find((vault) =>
    vault.lpTokens &&
    vault.lpTokens.length > 0 &&
    vault.lpTokens[0].address &&
    vault.lpTokens[0].address.length > 10
    ) || vaults[0];

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
    const lpTokenAddress = vault?.lpTokens?.[0]?.address || vault?.address;

  if (!lpTokenAddress) {
    throw new Error('Best vault does not expose an LP token address');
  }

  const url = new URL('/v1/quote', COMPOSER_URL);
  url.searchParams.set('fromChain', String(BASE_CHAIN_ID));
  url.searchParams.set('toChain', String(BASE_CHAIN_ID));
  url.searchParams.set('fromToken', USDC_ADDRESS_BASE);
  url.searchParams.set('toToken', lpTokenAddress);
  url.searchParams.set('fromAddress', fromWalletAddress);
  url.searchParams.set('toAddress', fromWalletAddress);
  url.searchParams.set('fromAmount', String(amountUSDC));

  return fetchJson(url.toString(), {
    method: 'GET',
    headers: earnHeaders()
  });
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
