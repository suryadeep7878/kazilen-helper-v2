'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Crown, Loader2 } from 'lucide-react'
import BackHeader from '../components/BackHeader'
import BottomNav from '../../components/BottomNav'
import { API_BASE_URL, apiFetch } from '@/lib/api'

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      resolve(true)
      return
    }
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => reject(new Error('Gateway failed to load')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => reject(new Error('Payment gateway failed to load. Check connection and retry.'))
    document.body.appendChild(script)
  })
}

export default function RechargePage() {
  const router = useRouter()
  const [plans, setPlans] = useState([])
  const [quota, setQuota] = useState(null)
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState(null)
  const [paying, setPaying] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [plansRes, quotaRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/membership/plans`),
        apiFetch(`${API_BASE_URL}/membership/quota`),
      ])
      if (plansRes.status === 401 || quotaRes.status === 401) {
        router.push('/login')
        return
      }
      const plansData = plansRes.ok ? await plansRes.json() : { plans: [] }
      const quotaData = quotaRes.ok ? await quotaRes.json() : null
      setPlans(plansData.plans || [])
      setQuota(quotaData?.quota || null)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Existing manual/demo activation — kept as-is (admin manual flow untouched).
  const subscribe = async (planId) => {
    setSubscribing(planId)
    setError('')
    setNotice('')
    try {
      const res = await apiFetch(`${API_BASE_URL}/membership/subscribe?plan_id=${planId}`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Subscription failed. Please try again.')
        return
      }
      setNotice(data.message || 'Subscribed successfully. Quota reset.')
      setQuota(data.quota || null)
      await load()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubscribing(null)
    }
  }

  // New: Razorpay online payment (wahhtrips pattern: order -> checkout -> verify).
  const payOnline = async (plan) => {
    setPaying(plan.id)
    setError('')
    setNotice('')
    try {
      await loadRazorpayScript()
      const orderRes = await apiFetch(`${API_BASE_URL}/payments/subscription/order?plan_id=${plan.id}`, {
        method: 'POST',
      })
      const orderData = await orderRes.json().catch(() => ({}))
      if (!orderRes.ok) {
        setError(orderData.detail || 'Could not start online payment. Try manual activation or contact admin.')
        return
      }
      const options = {
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency || 'INR',
        order_id: orderData.order_id,
        name: 'Kazilen',
        description: `${plan.name} membership (${plan.duration_days} days)`,
        theme: { color: '#ff8a4c' },
        modal: { ondismiss: () => setPaying(null) },
        handler: async (resp) => {
          try {
            const verifyRes = await apiFetch(`${API_BASE_URL}/payments/subscription/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              }),
            })
            const verifyData = await verifyRes.json().catch(() => ({}))
            if (!verifyRes.ok) {
              setError(verifyData.detail || 'Payment verification failed. If money was debited it will auto-confirm shortly — check again in a minute.')
              return
            }
            setNotice('Payment successful. Subscription activated.')
            setQuota(verifyData.quota || null)
            await load()
          } catch {
            setError('Verification failed. If money was debited it will auto-confirm via webhook — check again shortly.')
          } finally {
            setPaying(null)
          }
        },
      }
      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', () => setPaying(null))
      rzp.open()
    } catch (err) {
      setError(err?.message || 'Online payment could not start. Please try again.')
      setPaying(null)
    }
  }

  const quotaLine = quota
    ? quota.subscribed
      ? `${quota.plan_used}/${quota.plan_limit ?? '∞'} used on ${quota.plan_name || 'plan'}`
      : `${quota.free_used}/${quota.free_limit} free bookings used`
    : ''

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <BackHeader title="Recharge & Membership" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Membership Plans</h1>
          <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
            {quotaLine || 'Each worker gets 2 free bookings, then a plan is required.'}
          </p>
        </div>

        {notice && (
          <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-sm px-3 py-2 flex items-center gap-2">
            <CheckCircle2 size={14} /> {notice}
          </p>
        )}
        {error && (
          <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-xs font-semibold">
            <Loader2 size={16} className="animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plans
              .filter((p) => p.is_active !== false)
              .sort((a, b) => {
                const aCurrent = quota?.subscribed && quota?.subscription?.plan_id === a.id ? 0 : 1
                const bCurrent = quota?.subscribed && quota?.subscription?.plan_id === b.id ? 0 : 1
                return aCurrent - bCurrent
              })
              .map((plan) => {
              const isCurrent = quota?.subscribed && quota?.subscription?.plan_id === plan.id
              const isPaid = (plan.price || 0) > 0
              const busy = subscribing === plan.id || paying === plan.id
              return (
                <div key={plan.id} className={`bg-white rounded-md border p-5 shadow-2xs space-y-3 ${isCurrent ? 'border-emerald-300' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 rounded-sm bg-orange-50 text-[#ff8a4c]">
                        <Crown size={16} />
                      </span>
                      <div>
                        <h3 className="text-sm font-bold">{plan.name}</h3>
                        <p className="text-[11px] text-slate-500">
                          {plan.bookings_included ?? '∞'} bookings · {plan.duration_days} days
                        </p>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200">
                        CURRENT
                      </span>
                    )}
                  </div>

                  <p className="text-xl font-extrabold">
                    ₹{plan.price} <span className="text-xs font-normal text-slate-500">/ {plan.duration_days} days</span>
                  </p>
                  {plan.description && <p className="text-xs text-slate-600 leading-relaxed">{plan.description}</p>}
                  {(plan.features || []).length > 0 && (
                    <ul className="text-xs text-slate-600 list-disc pl-4 space-y-0.5">
                      {plan.features.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}

                  {isPaid && (
                    <button
                      onClick={() => payOnline(plan)}
                      disabled={busy}
                      className="w-full py-2.5 rounded-sm bg-[#ff8a4c] hover:bg-[#f07432] text-white text-xs font-bold transition disabled:opacity-60 cursor-pointer"
                    >
                      {paying === plan.id ? 'Opening payment…' : isCurrent ? 'Renew with UPI / Card' : 'Pay Online (UPI / Card)'}
                    </button>
                  )}
                  <button
                    onClick={() => subscribe(plan.id)}
                    disabled={busy}
                    className="w-full py-2 rounded-sm bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-300 transition disabled:opacity-60 cursor-pointer"
                  >
                    {subscribing === plan.id ? 'Activating…' : isPaid ? 'Or activate manually (demo)' : 'Subscribe'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!loading && plans.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-8">No plans available right now.</p>
        )}

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Online payments are processed securely by Razorpay (UPI, cards, netbanking). If money is debited but the plan does not activate instantly, it auto-confirms within a few minutes — just reopen this page.
        </p>
      </main>

      <BottomNav />
    </div>
  )
}
