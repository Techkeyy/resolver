import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  getBetByInviteCode, acceptBet, lockFunds, getDepositQuote,
  resolveBet, confirmResolution, disputeBet
} from '../api'

function shortAddr(addr) {
  if (!addr) return '???'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

function StatusBar({ status }) {
  const steps = ['CREATED', 'ACCEPTED', 'LOCKED', 'RESOLVED', 'PAID']
  const current = steps.indexOf(status)
  return (
    <div className="status-bar">
      {steps.map((s, i) => (
        <div
          key={s}
          className={`status-step ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}
        >
          {s}
        </div>
      ))}
    </div>
  )
}

export default function BetPage() {
  const { invite_code } = useParams()
  const [bet, setBet] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const b = await getBetByInviteCode(invite_code)
      setBet(b)
    } catch (e) {
      setError('Bet not found')
    }
  }, [invite_code])

  useEffect(() => {
    const saved = localStorage.getItem('resolver_wallet')
    if (saved) setWallet(saved)
    load()
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
  }, [load])

  async function connectWallet() {
    if (!window.ethereum) { alert('Install MetaMask'); return }
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    })
    setWallet(accounts[0])
    localStorage.setItem('resolver_wallet', accounts[0])
  }

  async function handleAccept() {
    if (!wallet) { setError('Connect wallet first'); return }
    setLoading(true); setError('')
    try {
      const updated = await acceptBet(invite_code, wallet)
      setBet(updated)
      setMsg('Bet accepted! Now lock your funds.')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleLock() {
    if (!wallet) { setError('Connect wallet first'); return }
    setLoading(true); setError('')
    try {
      const { ethers } = await import('ethers')
      
      // Get provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()
      
      // Switch to Base if needed
      if (network.chainId !== 8453n) {
        setMsg('Switching to Base network...')
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x2105' }]
          })
        } catch(switchErr) {
          if (switchErr.code === 4902) {
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
          } else throw switchErr
        }
        // Re-get provider after chain switch
        await new Promise(r => setTimeout(r, 1000))
      }
      
      const signer = await provider.getSigner()
      
      // Get deposit quote from backend
      setMsg('Getting best vault rate...')
      const quote = await getDepositQuote(bet.id, wallet)
      
      if (!quote.transactionRequest) {
        throw new Error('No transaction data in quote')
      }
      
      const tx = quote.transactionRequest
      const spender = quote.estimate?.approvalAddress || tx.to
      
      // Check and set USDC allowance using ethers
      const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      const usdcAbi = [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)'
      ]
      
      const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer)
      const amountInUnits = BigInt(Math.floor(bet.amount_usdc * 1_000_000))
      
      setMsg('Checking USDC allowance...')
      const currentAllowance = await usdcContract.allowance(wallet, spender)
      console.log('Current allowance:', currentAllowance.toString())
      console.log('Needed:', amountInUnits.toString())
      
      if (currentAllowance < amountInUnits) {
        setMsg('Approving USDC — confirm in MetaMask...')
        const approveTx = await usdcContract.approve(spender, amountInUnits)
        setMsg('Waiting for approval confirmation...')
        await approveTx.wait()
        setMsg('Approved! Now depositing...')
      } else {
        setMsg('Depositing into vault...')
      }
      
      // Send deposit transaction
      setMsg('Confirm deposit in MetaMask...')
      const depositTx = await signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : 0n,
        gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined
      })
      
      setMsg('Waiting for deposit confirmation...')
      const receipt = await depositTx.wait()
      console.log('Deposit confirmed:', receipt.hash)
      
      // Record in backend
      const updated = await lockFunds(bet.id, wallet, receipt.hash)
      setBet(updated)
      setMsg('Funds locked into vault! 🔒')
      
    } catch(e) {
      console.error('Lock error:', e)
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') {
        setError('Transaction rejected by user')
      } else {
        setError(e.message || 'Transaction failed')
      }
    }
    setLoading(false)
  }

  async function handleResolve(winnerAddress) {
    if (!wallet) { setError('Connect wallet first'); return }
    setLoading(true); setError('')
    try {
      const updated = await resolveBet(bet.id, wallet, winnerAddress)
      setBet(updated)
      setMsg('Resolution proposed. Waiting for opponent to confirm.')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleConfirm() {
    setLoading(true); setError('')
    try {
      const updated = await confirmResolution(bet.id, wallet)
      setBet(updated)
      setMsg('Confirmed! Winner decided.')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleDispute() {
    setLoading(true); setError('')
    try {
      const updated = await disputeBet(bet.id, wallet)
      setBet(updated)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  if (error && !bet) return (
    <div className="app-container">
      <div className="logo">RESOLVER</div>
      <p style={{ color: '#ff4444', marginTop: '40px' }}>{error}</p>
    </div>
  )

  if (!bet) return (
    <div className="app-container">
      <div className="logo">RESOLVER</div>
      <p style={{ color: '#666', marginTop: '40px' }} className="pulse">
        Loading bet...
      </p>
    </div>
  )

  const isCreator = wallet?.toLowerCase() === bet.creator_address?.toLowerCase()
  const isOpponent = wallet?.toLowerCase() === bet.opponent_address?.toLowerCase()
  const isParticipant = isCreator || isOpponent
  const otherAddress = isCreator ? bet.opponent_address : bet.creator_address
  const creatorLocked = bet.creator_locked
  const opponentLocked = bet.opponent_locked
  const myLocked = isCreator ? creatorLocked : opponentLocked

  if (bet.status === 'PAID' || bet.status === 'RESOLVED') {
    const won = wallet?.toLowerCase() === bet.winner_address?.toLowerCase()
    return (
      <div className="app-container">
        <StatusBar status={bet.status} />
        <div className="big-winner">
          <div className="trophy">🏆</div>
          <div className="winner-amount">
            ${bet.amount_usdc * 2} USDC
          </div>
          <div className="winner-name">
            {won ? 'You won!' : `${shortAddr(bet.winner_address)} wins`}
          </div>
          {!won && (
            <p style={{ color: '#666', marginTop: '16px', fontSize: '14px' }}>
              Better luck next time
            </p>
          )}
        </div>
        <button
          className="btn btn-primary"
          onClick={() => window.location.href = '/'}
        >
          New Bet
        </button>
      </div>
    )
  }

  if (bet.status === 'DISPUTED') {
    return (
      <div className="app-container">
        <StatusBar status="DISPUTED" />
        <div className="card" style={{ borderColor: '#660000' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ fontWeight: '700', fontSize: '18px', marginBottom: '8px' }}>
            Bet Disputed
          </div>
          <p style={{ color: '#888', fontSize: '14px' }}>
            Both sides disagree. Funds are frozen pending manual review.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="header">
        <div>
          <div className="logo">RESOLVER</div>
        </div>
        <button
          className={`wallet-btn ${wallet ? 'wallet-connected' : ''}`}
          onClick={connectWallet}
        >
          {wallet ? shortAddr(wallet) : 'Connect'}
        </button>
      </div>

      <StatusBar status={bet.status} />

      <div className="card">
        <div className="label">The Bet</div>
        <p style={{ fontSize: '18px', fontWeight: '700', margin: '8px 0' }}>
          "{bet.statement}"
        </p>
        <p style={{ color: '#888', fontSize: '14px' }}>
          ${bet.amount_usdc} USDC each · ${bet.amount_usdc * 2} pot
        </p>
      </div>

      {bet.opponent_address && (
        <div className="participants">
          <div className={`participant ${creatorLocked ? 'locked' : ''}`}>
            <div className="lock-status">{creatorLocked ? '🔒' : '⏳'}</div>
            <div>Creator</div>
            <div className="participant-addr">{shortAddr(bet.creator_address)}</div>
          </div>
          <div className={`participant ${opponentLocked ? 'locked' : ''}`}>
            <div className="lock-status">{opponentLocked ? '🔒' : '⏳'}</div>
            <div>Opponent</div>
            <div className="participant-addr">{shortAddr(bet.opponent_address)}</div>
          </div>
        </div>
      )}

      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      {bet.status === 'CREATED' && (
        <div>
          {!isParticipant && (
            <button
              className="btn btn-primary"
              onClick={handleAccept}
              disabled={loading}
            >
              {loading ? 'Accepting...' : `Accept This Bet — $${bet.amount_usdc} USDC`}
            </button>
          )}
          {isCreator && (
            <p className="pulse" style={{
              color: '#666', fontSize: '13px', textAlign: 'center', marginTop: '16px'
            }}>
              Waiting for opponent to accept...
            </p>
          )}
        </div>
      )}

      {bet.status === 'ACCEPTED' && isParticipant && !myLocked && (
        <button
          className="btn btn-primary"
          onClick={handleLock}
          disabled={loading}
        >
          {loading ? 'Locking...' : `Lock My $${bet.amount_usdc} USDC`}
        </button>
      )}

      {bet.status === 'ACCEPTED' && isParticipant && myLocked && (
        <p className="pulse" style={{
          color: '#666', fontSize: '13px', textAlign: 'center', marginTop: '16px'
        }}>
          Waiting for {shortAddr(otherAddress)} to lock...
        </p>
      )}

      {bet.status === 'LOCKED' && isParticipant && !bet.proposed_winner_address && (
        <div>
          <div className="label" style={{ marginBottom: '12px' }}>
            Who won?
          </div>
          <button
            className="btn btn-primary"
            onClick={() => handleResolve(wallet)}
            disabled={loading}
          >
            🏆 I Won
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleResolve(otherAddress)}
            disabled={loading}
          >
            {shortAddr(otherAddress)} Won
          </button>
        </div>
      )}

      {bet.status === 'LOCKED' && bet.proposed_winner_address && (
        <div>
          {wallet?.toLowerCase() === bet.proposed_by_address?.toLowerCase() ? (
            <p className="pulse" style={{
              color: '#666', fontSize: '13px', textAlign: 'center'
            }}>
              Waiting for opponent to confirm...
            </p>
          ) : isParticipant ? (
            <div className="card" style={{ borderColor: '#444' }}>
              <div className="label">Resolution Proposed</div>
              <p style={{ margin: '8px 0', fontSize: '15px' }}>
                {shortAddr(bet.proposed_by_address)} says{' '}
                <strong>{shortAddr(bet.proposed_winner_address)}</strong> won.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={loading}
              >
                ✓ Confirm
              </button>
              <button
                className="btn-danger"
                onClick={handleDispute}
                disabled={loading}
              >
                ✗ Dispute
              </button>
            </div>
          ) : null}
        </div>
      )}

      {!wallet && (
        <button
          className="btn btn-secondary"
          onClick={connectWallet}
          style={{ marginTop: '16px' }}
        >
          Connect Wallet to Participate
        </button>
      )}
    </div>
  )
}