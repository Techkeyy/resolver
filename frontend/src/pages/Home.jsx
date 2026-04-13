import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBet, getBestVault, getUserBets } from '../api'
import WalletBar from '../components/WalletBar'
import HowItWorks from '../components/HowItWorks'
import BetsDashboard from '../components/BetsDashboard'

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
    if (!window.ethereum) { alert('Please install MetaMask'); return }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
    setWallet(accounts[0])
    localStorage.setItem('resolver_wallet', accounts[0])
  }

  function disconnectWallet() {
    setWallet(null)
    localStorage.removeItem('resolver_wallet')
  }

  async function handleCreate() {
    if (!wallet) { setError('Connect your wallet first'); return }
    if (!statement.trim()) { setError('Enter the argument'); return }
    if (!amount || Number(amount) <= 0) { setError('Enter a valid amount'); return }
    setError('')
    setLoading(true)
    try {
      const bet = await createBet(wallet, statement.trim(), Number(amount))
      setCreated(bet)
    } catch(e) {
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

  if (created) {
    const shareUrl = `${window.location.origin}/bet/${created.invite_code}`
    return (
      <div className="app-container">
        <header className="header">
          <div>
            <div className="logo">RESOLVER</div>
            <div className="tagline">Stop arguing. Lock it in.</div>
          </div>
          <WalletBar wallet={wallet} onConnect={connectWallet} onDisconnect={disconnectWallet} />
        </header>

        <div className="card card-glow">
          <div className="input-label">Bet created</div>
          <p style={{fontSize:'1.1rem',fontWeight:'600',margin:'8px 0'}}>
            "{created.statement}"
          </p>
          <p style={{color:'var(--text-2)',fontSize:'0.875rem'}}>
            ${created.amount_usdc} USDC each · ${created.amount_usdc * 2} pot
          </p>
          {vault && (
            <div className="yield-badge" style={{marginTop:'12px'}}>
              ⚡ {vault.analytics?.apy?.total?.toFixed(1)}% APY in Morpho vault while bet runs
            </div>
          )}
        </div>

        <div className="share-box">
          <div className="input-label">Share this link</div>
          <div className="share-url">{shareUrl}</div>
          <button className="btn btn-primary" onClick={copyLink}>
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
          <button className="btn btn-secondary" onClick={shareWhatsApp}>
            Share on WhatsApp
          </button>
        </div>

        <p className="pulse" style={{textAlign:'center',color:'var(--text-2)',fontSize:'0.8rem',marginTop:'8px'}}>
          Waiting for opponent to accept...
        </p>

        <button className="btn btn-secondary" onClick={() => navigate(`/bet/${created.invite_code}`)}>
          View Bet →
        </button>
      </div>
    )
  }

  return (
    <div className="app-container">
      <header className="header">
        <div>
          <div className="logo">RESOLVER</div>
          <div className="tagline">Stop arguing. Lock it in.</div>
        </div>
        <WalletBar wallet={wallet} onConnect={connectWallet} onDisconnect={disconnectWallet} />
      </header>

      {vault && (
        <div className="yield-badge">
          ⚡ Locked funds earn {vault.analytics?.apy?.total?.toFixed(1)}% APY — Morpho on Base
        </div>
      )}

      <HowItWorks />

      <div className="create-section">
        <div className="section-label">Create a bet</div>
        <div className="input-group">
          <label className="input-label">What's the argument?</label>
          <textarea
            rows={3}
            placeholder="e.g. Man City will beat Arsenal on Sunday"
            value={statement}
            onChange={e => setStatement(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label className="input-label">Bet amount (USDC)</label>
          <input
            type="number"
            placeholder="0.20"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
          {loading ? 'Creating...' : 'Lock It In →'}
        </button>
      </div>

      {wallet && <BetsDashboard wallet={wallet} />}
    </div>
  )
}