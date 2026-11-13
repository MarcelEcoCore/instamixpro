import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STAGE = { planowana:'Zaplanowana', pobrana:'Pobrana', wyprodukowana:'Wyprodukowana', zaakceptowana:'Zaakceptowana' }
const NEXT = { planowana:{ stage:'pobrana', label:'Potwierdź pobranie', who:'Magazynier' },
               pobrana:{ stage:'wyprodukowana', label:'Potwierdź wykonanie', who:'Operator' },
               wyprodukowana:{ stage:'zaakceptowana', label:'Akceptuj wykonanie', who:'Planista' } }

export default function Produkcja() {
  const { profile } = useAuth()
  const canEdit = true

  const [orders, setOrders] = useState([])
  const [done, setDone] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [bbCache, setBbCache] = useState({})

  const [modal, setModal] = useState(null)   // { order, from }
  const [name, setName] = useState('')
  const [foreman, setForeman] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const sel = 'id,lot_number,recipe_id,quantity_kg,client,prod_stage,planned_by,picked_by,picked_at,operator,foreman,produced_at,accepted_by,accepted_at,recipes(code,name,version),production_wsady(id,wsad_no,planned_kg,bb_plan_no),production_order_sales(order_id,orders(order_number))'
    const [{ data: o }, { data: d }] = await Promise.all([
      supabase.from('production_batches').select(sel).in('prod_stage',['planowana','pobrana','wyprodukowana']).order('lot_number'),
      supabase.from('production_batches').select('id,lot_number,quantity_kg,prod_stage,produced_at,accepted_by,recipes(code,name)').eq('prod_stage','zaakceptowana').order('accepted_at',{ascending:false}).limit(20),
    ])
    setOrders(o||[]); setDone(d||[])
    setLoading(false)
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})
  const bbCountOf = o => new Set((o.production_wsady||[]).map(w=>w.bb_plan_no||1)).size

  function openStage(order) {
    setModal({ order, from: order.prod_stage }); setName(''); setForeman(''); setError('')
  }

  async function confirmStage() {
    const { order, from } = modal
    const step = NEXT[from]
    if (!name.trim()) { setError('Podaj imię i nazwisko'); return }
    setSaving(true); setError('')
    const nowISO = new Date().toISOString()

    if (from === 'planowana') {
      await supabase.from('production_batches').update({ prod_stage:'pobrana', picked_by:name.trim(), picked_at:nowISO }).eq('id', order.id)
    } else if (from === 'pobrana') {
      // Wykonanie: utwórz bigbagi (luz) + LOT
      const seq = order.lot_number.split('-')[2] || ''
      const groups={}; (order.production_wsady||[]).forEach(w=>{const b=w.bb_plan_no||1;(groups[b]=groups[b]||[]).push(w)})
      const now=new Date(), yy=String(now.getFullYear()).slice(2), mm=String(now.getMonth()+1).padStart(2,'0'), dd=String(now.getDate()).padStart(2,'0')
      for (const bb of Object.keys(groups).map(Number).sort((a,b)=>a-b)) {
        const list=groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no)
        const mass=parseFloat(list.reduce((s,w)=>s+parseFloat(w.planned_kg||0),0).toFixed(3))
        const bb_code=`${order.recipes?.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`
        const lot=`L${yy}${mm}${dd}${seq}${String(bb).padStart(2,'0')}`
        const { data: fg, error: e2 } = await supabase.from('finished_goods').insert({ production_batch_id:order.id, received_date:now.toISOString().slice(0,10), quantity_kg:mass, form:'luz', unit_type:'big_bag', unit_count:1, unit_weight_kg:mass, bb_code, bb_no:bb, lot_code:lot, created_by:profile?.id }).select().single()
        if (e2) { setError(e2.message); setSaving(false); return }
        await supabase.from('bigbag_wsady').insert(list.map(w=>({ finished_good_id:fg.id, wsad_id:w.id })))
      }
      await supabase.from('production_batches').update({ prod_stage:'wyprodukowana', operator:name.trim(), foreman:foreman.trim()||null, produced_at:nowISO }).eq('id', order.id)
    } else if (from === 'wyprodukowana') {
      await supabase.from('production_batches').update({ prod_stage:'zaakceptowana', accepted_by:name.trim(), accepted_at:nowISO }).eq('id', order.id)
      const orderIds=(order.production_order_sales||[]).map(x=>x.order_id)
      if (orderIds.length) await supabase.from('orders').update({ status:'wyprodukowane', produced_at:nowISO }).in('id', orderIds)
    }
    setSaving(false); setModal(null); load()
  }

  async function cofnijPobranie(order) {
    await supabase.from('production_batches').update({ prod_stage:'planowana', picked_by:null, picked_at:null }).eq('id', order.id)
    load()
  }

  async function toggleExpand(id) {
    if (expanded===id) { setExpanded(null); return }
    setExpanded(id)
    if (!bbCache[id]) {
      const { data } = await supabase.from('finished_goods').select('bb_code,lot_code,quantity_kg,bb_no').eq('production_batch_id',id).eq('form','luz').order('bb_no')
      setBbCache(c=>({ ...c, [id]: data||[] }))
    }
  }

  async function printOrder(po) {
    const [{ data: pbi }, { data: ws }] = await Promise.all([
      supabase.from('production_batch_items').select('wsad_id,quantity_used_kg,ingredients(code,name),ingredient_batches(delivery_lot)').eq('production_batch_id', po.id),
      supabase.from('production_wsady').select('id,wsad_no,planned_kg,bb_plan_no').eq('production_batch_id', po.id).order('wsad_no'),
    ])
    const seq=po.lot_number.split('-')[2]||''
    const byWsad={}; (pbi||[]).forEach(r=>{(byWsad[r.wsad_id]=byWsad[r.wsad_id]||[]).push(r)})
    const groups={}; (ws||[]).forEach(w=>{const b=w.bb_plan_no||1;(groups[b]=groups[b]||[]).push(w)})
    const bbBlocks=Object.keys(groups).map(Number).sort((a,b)=>a-b).map(bb=>{
      const list=groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no)
      const code=`${po.recipes?.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`
      const wrows=list.map(w=>{const rows=(byWsad[w.id]||[]).map(r=>`<tr><td>${r.ingredients?.code||''}</td><td>${r.ingredients?.name||''}</td><td style="font-family:monospace">${r.ingredient_batches?.delivery_lot||''}</td><td style="text-align:right">${parseFloat(r.quantity_used_kg).toFixed(3)}</td><td style="width:70px"></td></tr>`).join('');return `<tr class="wsad"><td colspan="5">Wsad W${w.wsad_no} — ${parseFloat(w.planned_kg).toFixed(3)} kg</td></tr>${rows}`}).join('')
      return `<div class="bb-h">Bigbag ${code}</div><table><thead><tr><th>Kod</th><th>Składnik</th><th>Nr partii</th><th style="text-align:right">Ilość (kg)</th><th>Pobrano ✓</th></tr></thead><tbody>${wrows}</tbody></table>`
    }).join('')
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Zlecenie ${po.lot_number}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:10px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.lot{font-size:14px;font-weight:bold;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#F1EFE8;font-size:9px;text-transform:uppercase;padding:4px 6px;border:1px solid #D3D1C7;text-align:left}td{padding:4px 6px;border:1px solid #D3D1C7;font-size:10px}.wsad td{background:#E1F5EE;font-weight:bold}.bb-h{font-weight:bold;margin:8px 0 4px;font-size:12px}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-top:20px}.sl{border-bottom:1.5px solid #333;margin-top:28px;margin-bottom:4px}.sn{font-size:9px;color:#888}@media print{@page{margin:10mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div style="font-weight:bold;margin-top:3px">Zlecenie produkcji — karta dozowania</div><div class="lot" style="margin-top:3px">${po.lot_number}</div></div>
<div style="text-align:right;font-size:10px;color:#555"><div>Produkt: <b>${po.recipes?.code} — ${po.recipes?.name}</b></div><div>Masa plan.: <b>${parseFloat(po.quantity_kg).toFixed(3)} kg</b></div><div>Data druku: ${new Date().toLocaleDateString('pl-PL')}</div></div></div>
${bbBlocks}
<div class="sig-grid"><div><div class="sn">PLANISTA — plan</div><div class="sl"></div><div class="sn">${po.planned_by||'podpis · data'}</div></div><div><div class="sn">MAGAZYNIER — pobranie</div><div class="sl"></div><div class="sn">${po.picked_by||'podpis · data'}</div></div><div><div class="sn">OPERATOR — wykonanie</div><div class="sl"></div><div class="sn">${po.operator||'podpis · data'}</div></div><div><div class="sn">PLANISTA — akceptacja</div><div class="sl"></div><div class="sn">${po.accepted_by||'podpis · data'}</div></div></div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  const section = (title, color, list, emptyTxt) => (
    <>
      <div style={{fontSize:13,fontWeight:600,color,margin:'4px 0 8px'}}>{title} ({list.length})</div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto',marginBottom:18}}>
        <table style={{minWidth:900}}>
          <thead><tr><th style={{width:32}}></th><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'center'}}>Wsady</th><th style={{textAlign:'center'}}>Bigbagi</th><th style={{textAlign:'right'}}>Masa</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{textAlign:'center',padding:20,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && list.length===0 && <tr><td colSpan={8} style={{textAlign:'center',padding:20,color:'#888'}}>{emptyTxt}</td></tr>}
            {list.map(po=>{
              const step=NEXT[po.prod_stage]
              return (
                <React.Fragment key={po.id}>
                  <tr>
                    <td style={{textAlign:'center'}}><button onClick={()=>toggleExpand(po.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#5F5E5A'}}>{expanded===po.id?'▲':'▼'}</button></td>
                    <td><span className="lot">{po.lot_number}</span></td>
                    <td style={{fontSize:12,fontWeight:500}}>{po.recipes?.code} — {po.recipes?.name}</td>
                    <td style={{textAlign:'center'}}>{po.production_wsady?.length||0}</td>
                    <td style={{textAlign:'center'}}>{bbCountOf(po)}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{fmt(po.quantity_kg)} kg</td>
                    <td><span className="badge b-warn" style={{fontSize:10}}>{STAGE[po.prod_stage]}</span></td>
                    <td><div className="flex" style={{gap:4}}>
                      <button className="btn btn-sm" onClick={()=>printOrder(po)}>🖨</button>
                      {po.prod_stage==='pobrana' && <button className="btn btn-sm" onClick={()=>cofnijPobranie(po)}>Cofnij</button>}
                      {canEdit && step && <button className="btn btn-sm btn-primary" onClick={()=>openStage(po)}>{step.label}</button>}
                    </div></td>
                  </tr>
                  {expanded===po.id && (
                    <tr><td colSpan={8} style={{padding:0,background:'#F9F8F5'}}>
                      <div style={{padding:'10px 16px 12px 40px',fontSize:12}}>
                        <div style={{marginBottom:6}}><b>Podpisy:</b> Planista(plan): {po.planned_by||'—'} · Magazynier: {po.picked_by||'—'}{po.picked_at?` (${po.picked_at.slice(0,10)})`:''} · Operator: {po.operator||'—'}{po.produced_at?` (${po.produced_at.slice(0,10)})`:''} · Akceptacja: {po.accepted_by||'—'}</div>
                        {(po.production_order_sales||[]).length>0 && <div className="muted">Sprzedaż: {(po.production_order_sales||[]).map(x=>x.orders?.order_number).join(', ')}</div>}
                        {bbCache[po.id] && bbCache[po.id].length>0 && <div style={{marginTop:6}}><b>Bigbagi (LOT):</b> {bbCache[po.id].map(b=>`${b.bb_code} / ${b.lot_code}`).join(' · ')}</div>}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )

  const doPobrania = orders.filter(o=>o.prod_stage==='planowana')
  const doWykonania = orders.filter(o=>o.prod_stage==='pobrana')
  const doAkceptacji = orders.filter(o=>o.prod_stage==='wyprodukowana')

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Produkcja</div><div className="page-sub">Realizacja zleceń: pobranie → wykonanie → akceptacja (podpisy)</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>

      {section('Do pobrania (magazynier)', '#BA7517', doPobrania, 'Brak')}
      {section('Do wykonania (operator)', '#0F6E56', doWykonania, 'Brak')}
      {section('Do akceptacji (planista)', '#0C447C', doAkceptacji, 'Brak')}

      <div style={{fontSize:13,fontWeight:600,color:'#5F5E5A',margin:'4px 0 8px'}}>Zaakceptowane — ostatnie ({done.length})</div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto'}}>
        <table style={{minWidth:560}}>
          <thead><tr><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'right'}}>Masa</th><th>Akceptacja</th></tr></thead>
          <tbody>
            {done.length===0 && <tr><td colSpan={4} style={{textAlign:'center',padding:16,color:'#888'}}>Brak</td></tr>}
            {done.map(o=>(<tr key={o.id}><td><span className="lot">{o.lot_number}</span></td><td style={{fontSize:12}}>{o.recipes?.code} — {o.recipes?.name}</td><td style={{textAlign:'right'}}>{fmt(o.quantity_kg)} kg</td><td className="muted" style={{fontSize:11}}>{o.accepted_by||'—'}</td></tr>))}
          </tbody>
        </table>
      </div>

      {/* Modal etapu */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e=>e.target===e.currentTarget && setModal(null)}>
        <div className="modal" style={{maxWidth:460}}>
          {modal && (()=>{ const step=NEXT[modal.from]; return (
            <>
              <div className="modal-title">{step.label} — {modal.order.lot_number}</div>
              <div style={{background:'#F1EFE8',borderRadius:8,padding:10,marginBottom:10,fontSize:13}}>
                {modal.order.recipes?.code} — {modal.order.recipes?.name} · {fmt(modal.order.quantity_kg)} kg
                {modal.from==='pobrana' && <div className="muted" style={{fontSize:11,marginTop:4}}>Po potwierdzeniu powstaną bigbagi z numerami LOT jako luz w Magazynie WG.</div>}
                {modal.from==='wyprodukowana' && (modal.order.production_order_sales||[]).length>0 && <div className="muted" style={{fontSize:11,marginTop:4}}>Przypięte zlecenia sprzedaży przejdą na „Wyprodukowane".</div>}
              </div>
              {error && <div className="err-box">{error}</div>}
              <div><label>{step.who} — imię i nazwisko *</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="np. Jan Kowalski" /></div>
              {modal.from==='pobrana' && <div style={{marginTop:8}}><label>Brygadzista (opc.)</label><input value={foreman} onChange={e=>setForeman(e.target.value)} /></div>}
              <div className="modal-footer">
                <button className="btn" onClick={()=>setModal(null)}>Anuluj</button>
                <button className="btn btn-primary" onClick={confirmStage} disabled={saving}>{saving?'Zapisywanie...':step.label}</button>
              </div>
            </>
          )})()}
        </div>
      </div>
    </div>
  )
}
