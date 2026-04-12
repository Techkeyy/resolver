import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBet, getBestVault } from '../api'

export default function Home() {
  const navigate = useNavigate()
  const [wallet, setWallet] = useState(null)
  const [statement, setStatement] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [vault, setVault] = useState(null)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('resolver_wallet')
    if (saved) setWallet(saved)
    getBestVault().then(setVault).catch(() => {})
  }, [])

  async function connectWallet() {
    if (!window.ethereum) {
      alert('Please install MetaMask to use Resolver')
      return
    }
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    })
    setWallet(accounts[0])
    localStorage.setItem('resolver_wallet', accounts[0])
  }

  async function handleCreate() {
    if (!wallet) { setError('Connect your wallet first'); return }
    if (!statement.trim()) { setError('Enter the argument'); return }
    if (!amount || Number(amount) <= 0) {
      setError('Enter a valid amount'); return
    }
    setError('')
    setLoading(true)
    try {
      const bet = await createBet(wallet, statement.trim(), Number(amount))
      setCreated(bet)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  function copyLink() {
    const url = `${window.location.origin}/bet/${created.invite_code}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp() {
    const url = `${window.location.origin}/bet/${created.invite_code}`
    const text = `I bet you $${created.amount_usdc} USDC that: "${created.statement}" — accept here: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`)
  }

  const shortWallet = wallet
    ? wallet.slice(0, 6) + '...' + wallet.slice(-4)
    : null

  if (created) {
    const shareUrl = `${window.location.origin}/bet/${created.invite_code}`
    return (
      <div className="app-container">
        <div className="header">
          <div>
            <div className="logo">RESOLVER</div>
            <div className="tagline">Stop arguing. Lock it in.</div>
          </div>
          <button className={`wallet-btn ${wallet ? 'wallet-connected' : ''}`} onClick={connectWallet}>
            {wallet ? shortWallet : 'Connect Wallet'}
          </button>
        </div>
        <div className="card card-glow">
          <div className="label">Bet Created ✅</div>
          <p style={{ fontSize: '18px', fontWeight: '700', margin: '12px 0' }}>
            "{created.statement}"
          </p>
          <p style={{ color: '#888', fontSize: '14px' }}>
            ${created.amount_usdc} USDC each · ${created.amount_usdc * 2} total pot
          </p>
          {vault && (
            <div className="yield-badge" style={{ marginTop: '12px' }}>
              ⚡ Earning {vault.analytics?.apy?.total?.toFixed(1)}% APY while bet runs
            </div>
          )}
        </div>

        <div className="share-box">
          <div className="label">Share this link</div>
          <div className="share-url">{shareUrl}</div>
          <button className="btn btn-primary" onClick={copyLink}>
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
          <button className="btn btn-secondary" onClick={shareWhatsApp}>
            Share on WhatsApp
          </button>
        </div>

        <p className="pulse" style={{
          textAlign: 'center', color: '#666',
          fontSize: '13px', marginTop: '24px'
        }}>
          Waiting for opponent to accept...
        </p>

        <button
          className="btn btn-secondary"
          style={{ marginTop: '16px' }}
          onClick={() => navigate(`/bet/${created.invite_code}`)}
        >
          View Bet →
        </button>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="header">
        <div>
          <div className="logo">RESOLVER</div>
          <div className="tagline">Stop arguing. Lock it in.</div>
        </div>
        <button className={`wallet-btn ${wallet ? 'wallet-connected' : ''}`} onClick={connectWallet}>
          {wallet ? shortWallet : 'Connect Wallet'}
        </button>
      </div>

      {vault && (
        <div className="yield-badge">
          ⚡ Locked funds earn {vault.analytics?.apy?.total?.toFixed(1)}% APY on Base
        </div>
      )}

      <div className="input-group">
        <label className="input-label">What's the argument?</label>
        <textarea rows={4} placeholder="e.g. Man City will beat Arsenal on Sunday" value={statement} onChange={e => setStatement(e.target.value)} />
      </div>

      <div className="input-group">
        <label className="input-label">Bet amount (USDC)</label>
        <input type="number" placeholder="0.02" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>

      {error && <div className="error">{error}</div>}

      <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
        {loading ? 'Creating...' : 'Lock It In →'}
      </button>
    </div>
  )
}