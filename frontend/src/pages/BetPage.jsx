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
    setMsg('Getting deposit quote...')
    
    try {
      // Get the correct ethereum provider (prefer MetaMask)
      const getProvider = () => {
        if (window.ethereum?.providers) {
          // Multiple wallets installed - find MetaMask
          const metamask = window.ethereum.providers.find(p => p.isMetaMask && !p.isRabby)
          if (metamask) return metamask
        }
        // Single wallet or fallback
        return window.ethereum
      }

      const provider = getProvider()

      // Step 1: Switch to Base (chainId 8453)
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x2105' }], // 8453 in hex
        })
      } catch (switchError) {
        // Chain not added yet — add it
        if (switchError.code === 4902) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x2105',
              chainName: 'Base',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org']
            }]
          })
        } else {
          throw switchError
        }
      }

      // Step 2: Get deposit quote from LI.FI via our backend
      setMsg('Getting best vault rate...')
      const quote = await getDepositQuote(bet.id, wallet)
      console.log('Quote estimate:', JSON.stringify(quote.estimate, null, 2))
      console.log('Approval address:', quote.estimate?.approvalAddress)
      console.log('TX to:', quote.transactionRequest?.to)
      
      if (!quote.transactionRequest) {
        throw new Error('No transaction data in quote')
      }

      const tx = quote.transactionRequest

      // Step 3: Handle token approval using LI.FI's approvalAddress
      const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      const amountInUnits = Math.floor(bet.amount_usdc * 1_000_000).toString()
      const spender = quote.estimate?.approvalAddress || tx.to

      // Check current allowance using eth_call
      const paddedOwner = wallet.slice(2).padStart(64, '0')
      const paddedSpender = spender.slice(2).padStart(64, '0')
      const allowanceCallData = '0xdd62ed3e' + paddedOwner + paddedSpender

      let currentAllowance = 0
      try {
        const allowanceResult = await provider.request({
          method: 'eth_call',
          params: [{
            to: USDC_ADDRESS,
            data: allowanceCallData
          }, 'latest']
        })
        currentAllowance = parseInt(allowanceResult || '0x0', 16)
      } catch(e) {
        currentAllowance = 0
      }

      const neededAmount = parseInt(amountInUnits)

      console.log('Allowance check:', { allowance: currentAllowance, needed: neededAmount, needsApproval: currentAllowance < neededAmount })

      if (currentAllowance < neededAmount) {
        setMsg('Approving USDC spend...')
        
        // Encode approve(spender, amount) correctly
        // Function selector: keccak256("approve(address,uint256)") = 0x095ea7b3
        const paddedSpenderForApprove = spender.replace('0x', '').padStart(64, '0')
        // Use exact amount not max - safer and cleaner
        const paddedAmount = BigInt(amountInUnits).toString(16).padStart(64, '0')
        const approveCallData = '0x095ea7b3' + paddedSpenderForApprove + paddedAmount

        setMsg('Please approve USDC in MetaMask...')
        
        const approveTxHash = await provider.request({
          method: 'eth_sendTransaction',
          params: [{
            from: wallet,
            to: USDC_ADDRESS,
            data: approveCallData
          }]
        })
        
        console.log('Approval tx hash:', approveTxHash)
        setMsg('Approval confirmed, depositing...')
        await new Promise(resolve => setTimeout(resolve, 4000))
        console.log('Approval done, now sending deposit...')
        console.log('TX object:', JSON.stringify(tx, null, 2))
      }

      // Step 4: Send the deposit transaction
      setMsg('Depositing into vault...')
      // Clean and format transaction params properly
      const depositParams = {
        from: wallet,
        to: tx.to,
        data: tx.data,
      }

      // Only add value if it exists and is not zero
      if (tx.value && tx.value !== '0x0' && tx.value !== '0') {
        depositParams.value = tx.value
      }

      // Only add gas if it exists - let MetaMask estimate if not
      if (tx.gasLimit || tx.gas) {
        // Convert to hex if it's a number
        const gasValue = tx.gasLimit || tx.gas
        depositParams.gas = typeof gasValue === 'number' 
          ? '0x' + gasValue.toString(16)
          : gasValue
      }

      let depositTx
      try {
        console.log('Deposit params being sent:', JSON.stringify(depositParams, null, 2))
        depositTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [depositParams]
        })

        console.log('Deposit TX hash:', depositTx)
      } catch(depositError) {
        console.log('DEPOSIT FAILED:', depositError.code, depositError.message)
        throw depositError
      }

      if (!depositTx || depositTx.length < 10) {
        throw new Error('Invalid transaction hash: ' + depositTx)
      }

      // Step 5: Record the lock in our backend
      setMsg('Confirming...')
      const updated = await lockFunds(bet.id, wallet, depositTx)
      setBet(updated)
      setMsg('Funds locked into vault! 🔒')

    } catch (e) {
      if (e.code === 4001) {
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