import { App as LiFiWidget } from '../../node_modules/@lifi/widget/dist/esm/App.js'
import { useEffect } from 'react'

const MORPHO_VAULT_ADDRESS = '0xbeefa7b88064feef0cee02aaebbd95d30df3878f'
const BASE_CHAIN_ID = 8453
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

export default function LiFiDepositWidget({ 
  betId, 
  userAddress, 
  amount, 
  onSuccess, 
  onClose 
}) {
  useEffect(() => {
    // ensure window.ethereum is available for widget
    if (!window.ethereum) {
      console.warn('No ethereum provider found')
    }
  }, [])

  const widgetConfig = {
    integrator: 'resolver-app',
    variant: 'compact',
    appearance: 'dark',
    
    // Pre-select source: USDC on Base
    fromChain: BASE_CHAIN_ID,
    fromToken: USDC_ADDRESS,
    fromAmount: amount.toString(),
    
    // Pre-select destination: Morpho vault on Base  
    toChain: BASE_CHAIN_ID,
    toToken: MORPHO_VAULT_ADDRESS,
    
    // Lock destination so user can't change it
    disabledUI: ['toToken', 'toAddress'],
    
    // Only allow Base chain
    chains: {
      allow: [BASE_CHAIN_ID]
    },
    
    // Dark theme matching Resolver UI
    theme: {
      palette: {
        primary: { main: '#00e676' },
        secondary: { main: '#00e676' },
        background: {
          default: '#0a0a0a',
          paper: '#141414'
        },
        text: {
          primary: '#ffffff',
          secondary: '#888888'
        }
      },
      shape: {
        borderRadius: 14,
        borderRadiusSecondary: 8
      }
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{ 
        background: '#0a0a0a', 
        borderRadius: '16px',
        border: '1px solid #1f1f1f',
        padding: '20px',
        width: '100%',
        maxWidth: '420px',
        position: 'relative'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <div>
            <h3 style={{ color: '#fff', margin: 0, fontSize: '1rem' }}>
              Lock ${amount} USDC into Morpho Vault
            </h3>
            <p style={{ color: '#888', fontSize: '0.75rem', margin: '4px 0 0' }}>
              Powered by LI.FI Earn
            </p>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #333',
              color: '#888',
              borderRadius: '8px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            Cancel
          </button>
        </div>

        <LiFiWidget
          integrator="resolver-app"
          config={widgetConfig}
          onRouteExecutionCompleted={(route) => {
            console.log('Deposit completed:', route)
            // Get the real tx hash from the route
            const txHash = route.steps?.[0]?.execution?.process?.[0]?.txHash
              || route.steps?.[0]?.execution?.process?.find(p => p.txHash)?.txHash
              || 'completed'
            console.log('TX Hash:', txHash)
            onSuccess(txHash)
          }}
          onRouteExecutionFailed={(route) => {
            console.error('Deposit failed:', route)
          }}
        />
      </div>
    </div>
  )
}