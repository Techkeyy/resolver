require('dotenv').config()

async function test() {
  // Try different amounts and vaults
  const testCases = [
    { amount: '200000', label: '0.2 USDC' },
    { amount: '1000000', label: '1 USDC' },
  ]
  
  // First get all vaults
  const res = await fetch(
    'https://earn.li.fi/v1/earn/vaults?chainId=8453&asset=USDC&sortBy=tvl&limit=50',
    { headers: { 'x-lifi-api-key': process.env.LIFI_API_KEY } }
  )
  const json = await res.json()
  const vaults = (json.data || []).filter(v => v.isTransactional)
  
  console.log(`Testing ${vaults.length} transactional vaults...`)
  
  for (const vault of vaults.slice(0, 15)) {
    for (const tc of testCases) {
      const params = new URLSearchParams({
        fromChain: '8453',
        toChain: '8453', 
        fromToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        toToken: vault.address,
        fromAddress: '0x0000000000000000000000000000000000000001',
        toAddress: '0x0000000000000000000000000000000000000001',
        fromAmount: tc.amount
      })
      
      try {
        const qRes = await fetch(`https://li.quest/v1/quote?${params}`)
        const q = await qRes.json()
        
        if (q.transactionRequest) {
          console.log(`✅ WORKS: ${vault.name} | ${vault.protocol?.name} | ${tc.label} | APY: ${vault.analytics?.apy?.total || vault.analytics?.apy?.base}%`)
          console.log(`   Vault address: ${vault.address}`)
          console.log(`   TX to: ${q.transactionRequest.to}`)
        } else {
          console.log(`❌ ${vault.name} | ${tc.label} | ${q.message || q.error || 'no tx'}`)
        }
      } catch(e) {
        console.log(`❌ ${vault.name} | ERROR: ${e.message}`)
      }
      
      await new Promise(r => setTimeout(r, 300))
    }
  }
}

test().catch(console.error)