import { useState, useEffect } from 'react'
import { getWalletBalance } from '../api'

export default function WalletBar({ wallet, onConnect, onDisconnect }) {
  const [balance, setBalance] = useState(null)
  const [copied, setCopied] = useState(false)
  const [networkOk, setNetworkOk] = useState(true)

  useEffect(() => {
    if (!wallet) return
    getWalletBalance(wallet).then(d => d && setBalance(d.usdc))
    checkNetwork()
  }, [wallet])

  async function checkNetwork() {
    if (!window.ethereum) return
    const chainId = await window.ethereum.request({ method: 'eth_chainId' })
    setNetworkOk(chainId === '0x2105')
  }

  async function switchToBase() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }]
      })
      setNetworkOk(true)
    } catch(e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x2105',
            chainName: 'Base',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org']
          }]
        })
        setNetworkOk(true)
      }
    }
  }

  function copyAddress() {
    navigator.clipboard.writeText(wallet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function short(addr) {
    return addr ? addr.slice(0,6) + '...' + addr.slice(-4) : ''
  }

  if (!wallet) {
    return (
      <button className="btn-connect" onClick={onConnect}>
        Connect Wallet
      </button>
    )
  }

  return (
    <div className="wallet-bar">
      {!networkOk && (
        <button className="network-badge wrong" onClick={switchToBase}>
          ⚠ Switch to Base
        </button>
      )}
      {networkOk && (
        <span className="network-badge ok">Base</span>
      )}
      {balance !== null && (
        <span className="wallet-balance">${balance} USDC</span>
      )}
      <div className="wallet-address-group">
        <span className="wallet-addr">{short(wallet)}</span>
        <button className="icon-btn" onClick={copyAddress} title="Copy address">
          {copied ? '✓' : '⧉'}
        </button>
        <button className="icon-btn" onClick={onDisconnect} title="Disconnect">
          ✕
        </button>
      </div>
    </div>
  )
}