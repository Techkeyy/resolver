export default function HowItWorks() {
  const steps = [
    { n: '01', title: 'Make the call', desc: 'State the argument. Set the USDC amount.' },
    { n: '02', title: 'Share the link', desc: 'Send it. Opponent accepts with their wallet.' },
    { n: '03', title: 'Funds lock in', desc: 'Both sides deposit. USDC earns yield in Morpho vault.' },
    { n: '04', title: 'Winner takes all', desc: 'Confirm the outcome. Winner collects pot + yield.' },
  ]
  return (
    <div className="how-it-works">
      <p className="section-label">How it works</p>
      <div className="steps-row">
        {steps.map(s => (
          <div key={s.n} className="step-card">
            <span className="step-num">{s.n}</span>
            <span className="step-title">{s.title}</span>
            <span className="step-desc">{s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}