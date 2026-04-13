import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  getBetByInviteCode, acceptBet, lockFunds, getDepositQuote,
  resolveBet, confirmResolution, disputeBet
} from '../api'
import WalletBar from '../components/WalletBar'

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

  function disconnectWallet() {
    setWallet(null)
    localStorage.removeItem('resolver_wallet')
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
    setLoading(true); setError(''); setMsg('')

    try {
      // Step 1: ensure Base network
      if (window.ethereum) {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' })
        if (chainId !== '0x2105') {
          setMsg('Switching to Base...')
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x2105' }]
            })
          } catch(sw) {
            if (sw.code === 4902) {
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
            } else throw sw
          }
          await new Promise(r => setTimeout(r, 800))
        }
      }

      // Step 2: get LI.FI Composer quote
      setMsg('Getting vault quote...')
      console.log('Bet ID for quote:', bet.id, 'Invite:', bet.invite_code)
      const quote = await getDepositQuote(bet.id, wallet)
      if (!quote?.transactionRequest) throw new Error('No transaction data returned')

      const tx = quote.transactionRequest
      const spender = quote.estimate?.approvalAddress || tx.to
      const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      const amountHex = '0x' + BigInt(Math.floor(bet.amount_usdc * 1_000_000)).toString(16)

      // Step 3: check allowance via eth_call
      setMsg('Checking USDC allowance...')
      const allowanceData = '0xdd62ed3e'
        + wallet.slice(2).padStart(64, '0')
        + spender.slice(2).padStart(64, '0')

      let needsApproval = true
      try {
        const result = await window.ethereum.request({
          method: 'eth_call',
          params: [{ to: USDC, data: allowanceData }, 'latest']
        })
        const current = BigInt(result || '0x0')
        const needed = BigInt(Math.floor(bet.amount_usdc * 1_000_000))
        needsApproval = current < needed
      } catch(e) {
        needsApproval = true
      }

      // Step 4: approve if needed
      if (needsApproval) {
        setMsg('Approve USDC in MetaMask...')
        const paddedSpender = spender.slice(2).padStart(64, '0')
        const paddedAmount = BigInt(Math.floor(bet.amount_usdc * 1_000_000))
          .toString(16).padStart(64, '0')
        const approveData = '0x095ea7b3' + paddedSpender + paddedAmount

        const approveTxHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: wallet,
            to: USDC,
            data: approveData
            // NO gasLimit — let MetaMask estimate
          }]
        })
        console.log('Approve tx:', approveTxHash)
        setMsg('Approval sent, waiting 5s...')
        await new Promise(r => setTimeout(r, 5000))
      }

      // Step 5: send deposit — NO gasLimit, NO chainId field
      setMsg('Confirm deposit in MetaMask...')
      console.log('Deposit to:', tx.to)
      console.log('Value:', tx.value)
      console.log('Data prefix:', tx.data?.slice(0, 10))

      const depositParams = {
        from: wallet,
        to: tx.to,
        data: tx.data,
      }
      // Only add value if it's a real non-zero amount
      const txValue = tx.value
      if (txValue && txValue !== '0x0' && txValue !== '0x' && txValue !== '0') {
        depositParams.value = txValue
      }

      const depositTxHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [depositParams]
      })

      console.log('Deposit tx hash:', depositTxHash)
      if (!depositTxHash || depositTxHash.length < 20) {
        throw new Error('Invalid tx hash returned: ' + depositTxHash)
      }

      // Step 6: wait for confirmation then record
      setMsg('Waiting for on-chain confirmation...')
      
      // Poll for receipt
      let receipt = null
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        try {
          receipt = await window.ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [depositTxHash]
          })
          if (receipt) break
        } catch(e) {}
      }

      if (!receipt) {
        // tx submitted but receipt not found yet — record anyway with submitted hash
        console.warn('Receipt not found after polling, recording with submitted hash')
      }

      const finalHash = receipt?.transactionHash || depositTxHash
      console.log('Final confirmed hash:', finalHash)

      // Step 7: record in backend
      setMsg('Recording deposit...')
      const updated = await lockFunds(bet.id, wallet, finalHash)
      setBet(updated)
      setMsg('Funds locked into vault! 🔒')

    } catch(e) {
      console.error('Lock failed:', e)
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') {
        setError('Transaction cancelled')
      } else if (e.message?.includes('insufficient funds')) {
        setError('Insufficient ETH for gas. Get ETH on Base first.')
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
        <WalletBar wallet={wallet} onConnect={connectWallet} onDisconnect={disconnectWallet} />
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