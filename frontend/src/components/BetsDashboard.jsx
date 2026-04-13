import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserBets } from '../api'

export default function BetsDashboard({ wallet }) {
  const [bets, setBets] = useState([])
  const [tab, setTab] = useState('live')
  const navigate = useNavigate()

  useEffect(() => {
    if (!wallet) return
    getUserBets(wallet).then(setBets)
    const interval = setInterval(() => getUserBets(wallet).then(setBets), 8000)
    return () => clearInterval(interval)
  }, [wallet])

  function short(addr) {
    if (!addr) return '?'
    return addr.slice(0,6) + '...' + addr.slice(-4)
  }

  const live = bets.filter(b => ['CREATED','ACCEPTED','LOCKED'].includes(b.status))
  const settled = bets.filter(b => ['RESOLVED','PAID'].includes(b.status))
  const disputed = bets.filter(b => b.status === 'DISPUTED')

  const tabs = [
    { key: 'live', label: 'Live', count: live.length },
    { key: 'settled', label: 'Settled', count: settled.length },
    { key: 'disputed', label: 'Disputed', count: disputed.length },
  ]

  const current = tab === 'live' ? live : tab === 'settled' ? settled : disputed

  // P&L: sum winnings minus losses
  const pnl = settled.reduce((acc, b) => {
    if (!wallet) return acc
    const won = b.winner_address?.toLowerCase() === wallet.toLowerCase()
    return acc + (won ? b.amount_usdc : -b.amount_usdc)
  }, 0)

  if (!wallet) return null

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="pnl-row">
          <span className="pnl-label">P&L</span>
          <span className={`pnl-value ${pnl >= 0 ? 'pos' : 'neg'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDC
          </span>
        </div>
        <div className="dash-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`dash-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className="tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {current.length === 0 ? (
        <p className="empty-state">No {tab} bets</p>
      ) : (
        <div className="bet-list">
          {current.map(b => {
            const isCreator = b.creator_address?.toLowerCase() === wallet.toLowerCase()
            const opponent = isCreator ? b.opponent_address : b.creator_address
            const won = b.winner_address?.toLowerCase() === wallet.toLowerCase()
            return (
              <div
                key={b.id}
                className="bet-row"
                onClick={() => navigate(`/bet/${b.invite_code}`)}
              >
                <div className="bet-row-main">
                  <span className="bet-statement">"{b.statement}"</span>
                  <span className={`bet-status-pill status-${b.status.toLowerCase()}`}>
                    {b.status}
                  </span>
                </div>
                <div className="bet-row-meta">
                  <span className="bet-amount">${b.amount_usdc} USDC each</span>
                  {opponent && <span className="bet-opponent">vs {short(opponent)}</span>}
                  {b.status === 'PAID' && (
                    <span className={won ? 'won-badge' : 'lost-badge'}>
                      {won ? `+$${b.amount_usdc}` : `-$${b.amount_usdc}`}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}