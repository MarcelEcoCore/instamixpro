import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STAGE = { planowana:'Zaplanowana', pobrana:'Pobrana', wyprodukowana:'Wyprodukowana', zaakceptowana:'Zaakceptowana' }
const NEXT = { planowana:{ stage:'pobrana', label:'Potwierdź pobranie', who:'Magazynier' },
               pobrana:{ stage:'wyprodukowana', label:'Potwierdź wykonanie', who:'Operator' },
               wyprodukowana:{ stage:'zaakceptowana', label:'Akceptuj wykonanie', who:'Planista' } }
const num = v => { const n = parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?0:n }

export default function Produkcja() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = true

  const [all, setAll] = useState([])          // wszystkie produkcje (nagłówki + embeds)
  const [luzByProd, setLuzByProd] = useState({})
  const [packedByProd, setPackedByProd] = useState({})
  const [lotsByProd, setLotsByProd] = useState({})
  const [ingredients, setIngredients] = useState([])
  const [batches, setBatches] = useState([])  // ingredient_batches do ręcznej edycji partii
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState({})
  const [search, setSearch] = useState('')

  // Modal etapu (workflow)
  const [modal, setModal] = useState(null)
  const [name, setName] = useState('')
  const [foreman, setForeman] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Edycja nagłówka
  const [editH, setEditH] = useState(null)
  const [editHForm, setEditHForm] = useState({})
  // Edycja partii (ręczna)
  const [editI, setEditI] = useState(null)      // production object
  const [editIList, setEditIList] = useState([])
  const [editIWsady, setEditIWsady] = useState([])
  const [editIErr, setEditIErr] = useState('')
  // Usuwanie
  const [delProd, setDelProd] = useState(null)
  const [delErr, setDelErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const sel = '*, recipes(code,name,version), production_wsady(id,wsad_no,planned_kg,bb_plan_no), production_order_sales(order_id,orders(order_number))'
    const [{ data: pb }, { data: luz }, { data: pack }, { data: idx }, { data: ing }, { data: ib }] = await Promise.all([
      supabase.from('production_batches').select(sel).order('lot_number',{ascending:false}),
      supabase.from('finished_goods').select('production_batch_id,bb_code,lot_code,bb_no,quantity_kg').eq('form','luz'),
      supabase.from('finished_goods').select('production_batch_id,lot_code,quantity_kg,unit_count,order_id').eq('form','spakowane'),
      supabase.from('production_batch_items').select('production_batch_id, ingredient_batches(delivery_lot)'),
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('ingredient_batches').select('id,ingredient_id,delivery_lot,received_date,quantity_kg,status').order('received_date',{ascending:true}),
    ])
    setAll(pb||[])
    setIngredients(ing||[])
    setBatches(ib||[])
    const lm={}; (luz||[]).forEach(x=>{ (lm[x.production_batch_id]=lm[x.production_batch_id]||[]).push(x) })
    const pm={}; (pack||[]).forEach(x=>{ (pm[x.production_batch_id]=pm[x.production_batch_id]||[]).push(x) })
    const xm={}; (idx||[]).forEach(x=>{ const l=x.ingredient_batches?.delivery_lot; if(l){ (xm[x.production_batch_id]=xm[x.production_batch_id]||new Set()).add(l) } })
    setLuzByProd(lm); setPackedByProd(pm); setLotsByProd(xm)
    setLoading(false)
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})
  const pdate = p => { const d = p.produced_at || p.accepted_at || p.created_at; return d ? String(d).slice(0,10) : '—' }
  const bbCountOf = o => new Set((o.production_wsady||[]).map(w=>w.bb_plan_no||1)).size

  // ── Workflow (podpisy) ──
  function openStage(order) { setModal({ order, from: order.prod_stage }); setName(''); setForeman(''); setError('') }

  async function confirmStage() {
    const { order, from } = modal
    if (!name.trim()) { setError('Podaj imię i nazwisko'); return }
    setSaving(true); setError('')
    const nowISO = new Date().toISOString()
    if (from === 'planowana') {
      await supabase.from('production_batches').update({ prod_stage:'pobrana', picked_by:name.trim(), picked_at:nowISO }).eq('id', order.id)
    } else if (from === 'pobrana') {
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

  // ── Ślad / archiwum ──
  async function toggle(id) {
    if (expanded===id) { setExpanded(null); return }
    setExpanded(id)
    if (!detail[id]) {
      const [{ data: ws }, { data: it }, { data: pk }] = await Promise.all([
        supabase.from('production_wsady').select('id,wsad_no,planned_kg,actual_kg,bb_plan_no').eq('production_batch_id',id).order('wsad_no'),
        supabase.from('production_batch_items').select('wsad_id,quantity_used_kg,ingredients(code,name),ingredient_batches(delivery_lot,supplier_name,expiry_date)').eq('production_batch_id',id),
        supabase.from('finished_goods').select('lot_code,quantity_kg,unit_count,order_id,orders(order_number),packing_operations(pack_number,packing_date)').eq('production_batch_id',id).eq('form','spakowane'),
      ])
      setDetail(d=>({ ...d, [id]: { wsady:ws||[], items:it||[], packed:pk||[] } }))
    }
  }

  // ── Edycja nagłówka ──
  function openEditH(p) {
    setEditH(p)
    setEditHForm({ lot_number:p.lot_number||'', client:p.client||'', quantity_kg:p.quantity_kg??'', planned_by:p.planned_by||'', operator:p.operator||'', accepted_by:p.accepted_by||'', prod_stage:p.prod_stage||'planowana' })
    setError('')
  }
  async function saveEditH() {
    if (!editHForm.lot_number.trim()) { setError('Nr produkcji jest wymagany'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('production_batches').update({
      lot_number:editHForm.lot_number.trim(), client:editHForm.client||null, quantity_kg:num(editHForm.quantity_kg),
      planned_by:editHForm.planned_by||null, operator:editHForm.operator||null, accepted_by:editHForm.accepted_by||null,
      prod_stage:editHForm.prod_stage, updated_at:new Date().toISOString(),
    }).eq('id', editH.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setEditH(null); load()
  }

  // ── Edycja partii (ręczna, bez auto-FIFO) ──
  async function openEditI(p) {
    setEditI(p); setEditIErr('')
    const [{ data: items }, { data: ws }] = await Promise.all([
      supabase.from('production_batch_items').select('id,ingredient_id,ingredient_batch_id,quantity_used_kg,wsad_id').eq('production_batch_id', p.id),
      supabase.from('production_wsady').select('id,wsad_no').eq('production_batch_id', p.id).order('wsad_no'),
    ])
    setEditIWsady(ws||[])
    setEditIList((items||[]).map(it => ({ ingredient_id:it.ingredient_id||'', ingredient_batch_id:it.ingredient_batch_id||'', quantity_used_kg:it.quantity_used_kg??'', wsad_id:it.wsad_id||'' })))
  }
  const setIL = (idx,k,v) => setEditIList(p => p.map((r,i)=> i===idx ? { ...r, [k]:v, ...(k==='ingredient_id'?{ingredient_batch_id:''}:{}) } : r))
  const addIL = () => setEditIList(p => [...p, { ingredient_id:'', ingredient_batch_id:'', quantity_used_kg:'', wsad_id:'' }])
  const rmIL = idx => setEditIList(p => p.filter((_,i)=>i!==idx))
  async function saveEditI() {
    for (const r of editIList) { if (r.ingredient_id && (!r.ingredient_batch_id || !(num(r.quantity_used_kg)>0))) { setEditIErr('Każda pozycja musi mieć wybraną partię i ilość > 0'); return } }
    setSaving(true); setEditIErr('')
    await supabase.from('production_batch_items').delete().eq('production_batch_id', editI.id)
    const rows = editIList.filter(r => r.ingredient_id && r.ingredient_batch_id && num(r.quantity_used_kg)>0)
      .map(r => ({ production_batch_id:editI.id, ingredient_id:r.ingredient_id, ingredient_batch_id:r.ingredient_batch_id, quantity_used_kg:num(r.quantity_used_kg), wsad_id:r.wsad_id||null }))
    if (rows.length) { const { error: err } = await supabase.from('production_batch_items').insert(rows); if (err) { setEditIErr(err.message); setSaving(false); return } }
    setSaving(false); setEditI(null); setDetail(d=>{ const n={...d}; delete n[editI.id]; return n }); load()
  }

  // ── Usuwanie produkcji ──
  async function doDelete(p) {
    setDelErr('')
    // Pełna kaskada „od dołu" — usunięcie produkcji czyści WSZYSTKIE powiązania automatycznie.
    // 1) wyroby tej produkcji + operacje pakowania z nimi związane
    const { data: fgs } = await supabase.from('finished_goods').select('id,packing_operation_id').eq('production_batch_id', p.id)
    const fgIds = (fgs||[]).map(x=>x.id)
    const packIds = [...new Set((fgs||[]).map(x=>x.packing_operation_id).filter(Boolean))]
    // 2) rzeczy zależne od wyrobów (WZ, korekty, zużycia półproduktu, skład bigbagów)
    if (fgIds.length) {
      await supabase.from('wz_documents').delete().in('finished_good_id', fgIds)
      await supabase.from('fg_corrections').delete().in('finished_good_id', fgIds)
      await supabase.from('packing_consumed').delete().in('source_finished_good_id', fgIds)
      await supabase.from('bigbag_wsady').delete().in('finished_good_id', fgIds)
    }
    // 3) rzeczy zależne od operacji pakowania (zużycia opakowań/półproduktu)
    if (packIds.length) {
      await supabase.from('packing_consumed').delete().in('packing_operation_id', packIds)
      await supabase.from('packaging_consumed').delete().in('packing_operation_id', packIds)
    }
    // 4) usuń wyroby (luz + spakowane)
    await supabase.from('finished_goods').delete().eq('production_batch_id', p.id)
    // 5) usuń operacje pakowania (już bez powiązań)
    if (packIds.length) await supabase.from('packing_operations').delete().in('id', packIds)
    // 6) zlecenia sprzedaży → wróć na „nowe"
    const orderIds = (p.production_order_sales||[]).map(x=>x.order_id)
    if (orderIds.length) await supabase.from('orders').update({ status:'nowe', produced_at:null, updated_at:new Date().toISOString() }).in('id', orderIds)
    // 7) pozycje zużycia surowców
    await supabase.from('production_batch_items').delete().eq('production_batch_id', p.id)
    // 8) na końcu sama produkcja (kaskada: wsady, bigbag_wsady, order_sales)
    const { data: del, error: err } = await supabase.from('production_batches').delete().eq('id', p.id).select('id')
    if (err) {
      setDelErr(err.code==='23503'
        ? ('Pozostało powiązanie blokujące: ' + (err.details || err.message) + ' — podaj mi tę treść, dorobię kasowanie.')
        : err.message)
      return
    }
    if (!del || del.length===0) {
      setDelErr('Nie usunięto żadnego wiersza — brak uprawnień w bazie (RLS). Uruchom etap14 w Supabase i spróbuj ponownie.')
      return
    }
    setDelProd(null); load()
  }

  // ── Druk: karta dozowania ──
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

  // ── Druk: karta identyfikowalności (IFS) ──
  function printTrace(p) {
    const d = detail[p.id]; if (!d) return
    const byWsad={}; d.items.forEach(r=>{ (byWsad[r.wsad_id]=byWsad[r.wsad_id]||[]).push(r) })
    const rowHtml = r=>`<tr><td>${r.ingredients?.code||''}</td><td>${r.ingredients?.name||''}</td><td style="font-family:monospace">${r.ingredient_batches?.delivery_lot||'—'}</td><td>${r.ingredient_batches?.supplier_name||'—'}</td><td>${r.ingredient_batches?.expiry_date||'—'}</td><td style="text-align:right">${parseFloat(r.quantity_used_kg||0).toFixed(3)}</td></tr>`
    const wsadIds = new Set((d.wsady||[]).map(w=>w.id))
    const orphan = (d.items||[]).filter(r => !r.wsad_id || !wsadIds.has(r.wsad_id))
    let wsadRows = (d.wsady||[]).map(w=>{
      const rows=(byWsad[w.id]||[]).map(rowHtml).join('')
      return `<tr class="w"><td colspan="6">Wsad W${w.wsad_no} — plan ${parseFloat(w.planned_kg||0).toFixed(3)} kg</td></tr>${rows||'<tr><td colspan=6 style="color:#888">brak pozycji</td></tr>'}`
    }).join('')
    if (orphan.length) wsadRows += `${(d.wsady||[]).length?'<tr class="w"><td colspan="6">Pozycje bez przypisanego wsadu</td></tr>':''}${orphan.map(rowHtml).join('')}`
    if (!wsadRows) wsadRows = '<tr><td colspan=6 style="color:#888">brak zapisanego zużycia surowców</td></tr>'
    const luzRows=(luzByProd[p.id]||[]).map(b=>`<tr><td style="font-family:monospace">${b.bb_code||'—'}</td><td style="font-family:monospace">${b.lot_code||'—'}</td><td style="text-align:right">${parseFloat(b.quantity_kg||0).toFixed(3)} kg</td></tr>`).join('')||'<tr><td colspan=3 style="color:#888">brak</td></tr>'
    const packRows=(d.packed||[]).map(b=>`<tr><td style="font-family:monospace">${b.packing_operations?.pack_number||'—'}</td><td style="font-family:monospace">${b.lot_code||'—'}</td><td>${b.orders?.order_number||'—'}</td><td style="text-align:right">${b.unit_count||0} szt · ${parseFloat(b.quantity_kg||0).toFixed(3)} kg</td><td>${b.packing_operations?.packing_date||'—'}</td></tr>`).join('')||'<tr><td colspan=5 style="color:#888">brak</td></tr>'
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Identyfikowalność ${p.lot_number}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#1a1a18}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:12px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.lot{font-size:14px;font-weight:bold;color:#0F6E56}h3{font-size:12px;margin:12px 0 4px;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:6px}th{background:#F1EFE8;font-size:9px;text-transform:uppercase;padding:4px 6px;border:1px solid #D3D1C7;text-align:left}td{padding:4px 6px;border:1px solid #D3D1C7;font-size:10px}.w td{background:#E1F5EE;font-weight:bold}@media print{@page{margin:10mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div style="font-weight:bold;margin-top:3px">Karta identyfikowalności (IFS)</div><div class="lot" style="margin-top:3px">${p.lot_number}</div></div>
<div style="text-align:right;font-size:10px;color:#555"><div>Produkt: <b>${p.recipes?.code||''} — ${p.recipes?.name||''}</b></div><div>Masa: <b>${parseFloat(p.quantity_kg||0).toFixed(3)} kg</b></div><div>Data produkcji: ${pdate(p)}</div><div>Data druku: ${new Date().toLocaleDateString('pl-PL')}</div></div></div>
<h3>1. Surowce (wejście)</h3><table><thead><tr><th>Kod</th><th>Składnik</th><th>Nr partii dostawy</th><th>Dostawca</th><th>Ważny do</th><th style="text-align:right">Zużyto (kg)</th></tr></thead><tbody>${wsadRows}</tbody></table>
<h3>2. Półprodukt — bigbagi (LOT)</h3><table><thead><tr><th>Kod bigbaga</th><th>LOT</th><th style="text-align:right">Masa</th></tr></thead><tbody>${luzRows}</tbody></table>
<h3>3. Wyrób gotowy — pakowanie (LOT)</h3><table><thead><tr><th>Nr pakowania</th><th>LOT wyrobu</th><th>Zlecenie sprzedaży</th><th style="text-align:right">Ilość</th><th>Data</th></tr></thead><tbody>${packRows}</tbody></table>
<div style="margin-top:16px;font-size:9px;color:#888">Podpisy — Planista: ${p.planned_by||'—'} · Operator: ${p.operator||'—'} · Akceptacja: ${p.accepted_by||'—'}</div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  const itemTable = list => (
    <table style={{ width:'auto', minWidth:620, marginTop:4 }}>
      <thead><tr><th>Kod</th><th>Składnik</th><th>Nr partii dostawy</th><th>Dostawca</th><th>Ważny do</th><th style={{ textAlign:'right' }}>Zużyto (kg)</th></tr></thead>
      <tbody>{list.length===0 ? <tr><td colSpan={6} className="muted" style={{ fontSize:12 }}>brak pozycji</td></tr> : list.map((r,i)=>(
        <tr key={i}>
          <td><span className="lot" style={{ fontSize:11 }}>{r.ingredients?.code||'—'}</span></td>
          <td style={{ fontSize:12 }}>{r.ingredients?.name||'—'}</td>
          <td style={{ fontFamily:'monospace', fontSize:12 }}>{r.ingredient_batches?.delivery_lot||'—'}</td>
          <td style={{ fontSize:12 }}>{r.ingredient_batches?.supplier_name||'—'}</td>
          <td className="muted" style={{ fontSize:12 }}>{r.ingredient_batches?.expiry_date||'—'}</td>
          <td style={{ textAlign:'right', fontWeight:500 }}>{fmt(r.quantity_used_kg)}</td>
        </tr>
      ))}</tbody>
    </table>
  )

  // ── Sekcje workflow ──
  const doPobrania = all.filter(o=>o.prod_stage==='planowana')
  const doWykonania = all.filter(o=>o.prod_stage==='pobrana')
  const doAkceptacji = all.filter(o=>o.prod_stage==='wyprodukowana')

  const section = (title, color, list, emptyTxt) => (
    <>
      <div style={{fontSize:13,fontWeight:600,color,margin:'4px 0 8px'}}>{title} ({list.length})</div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto',marginBottom:18}}>
        <table style={{minWidth:860}}>
          <thead><tr><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'center'}}>Wsady</th><th style={{textAlign:'center'}}>Bigbagi</th><th style={{textAlign:'right'}}>Masa</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{textAlign:'center',padding:20,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && list.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:20,color:'#888'}}>{emptyTxt}</td></tr>}
            {list.map(po=>{ const step=NEXT[po.prod_stage]; return (
              <tr key={po.id}>
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
            )})}
          </tbody>
        </table>
      </div>
    </>
  )

  const archive = all.filter(p => {
    const q = search.trim().toLowerCase(); if (!q) return true
    if ((p.lot_number||'').toLowerCase().includes(q)) return true
    if ((`${p.recipes?.code} ${p.recipes?.name}`).toLowerCase().includes(q)) return true
    if ((p.client||'').toLowerCase().includes(q)) return true
    if ((luzByProd[p.id]||[]).some(b => (b.lot_code||'').toLowerCase().includes(q) || (b.bb_code||'').toLowerCase().includes(q))) return true
    if ((packedByProd[p.id]||[]).some(b => (b.lot_code||'').toLowerCase().includes(q))) return true
    if (lotsByProd[p.id] && [...lotsByProd[p.id]].some(l => (l||'').toLowerCase().includes(q))) return true
    return false
  })

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Produkcja</div><div className="page-sub">Realizacja (pobranie → wykonanie → akceptacja) oraz archiwum i identyfikowalność (IFS)</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>

      {section('Do pobrania (magazynier)', '#BA7517', doPobrania, 'Brak')}
      {section('Do wykonania (operator)', '#0F6E56', doWykonania, 'Brak')}
      {section('Do akceptacji (planista)', '#0C447C', doAkceptacji, 'Brak')}

      {/* ── Archiwum + identyfikowalność ── */}
      <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', margin:'10px 0 8px' }}>
        <div style={{fontSize:13,fontWeight:600,color:'#5F5E5A'}}>Archiwum produkcji — identyfikowalność ({archive.length})</div>
        <input className="search" placeholder="Nr partii surowca, LOT wyrobu, nr produkcji, produkt..." value={search} onChange={e=>setSearch(e.target.value)} style={{ width:320 }} />
      </div>
      <div className="info-box" style={{ marginBottom:10, fontSize:12 }}>
        Kliknij <b>▼</b> aby rozwinąć pełny ślad IFS (surowce z nr partii → bigbagi → pakowanie). Wyszukiwarka dopasowuje m.in. <b>nr partii surowca</b> (ślad wstecz) i LOT-y wyrobu.
        {isAdmin && <> Jako Admin możesz <b>edytować</b> nagłówek, <b>ręcznie poprawić partie</b> i <b>usunąć</b> błędnie wprowadzoną produkcję.</>}
      </div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto'}}>
        <table style={{minWidth:1000}}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{width:32}}></th><th>Nr produkcji</th><th>Produkt</th><th>Klient</th>
            <th style={{textAlign:'right'}}>Masa</th><th>Data</th><th>LOT-y wyrobu</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{textAlign:'center',padding:20,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && archive.length===0 && <tr><td colSpan={9} style={{textAlign:'center',padding:20,color:'#888'}}>Brak produkcji</td></tr>}
            {archive.map(p=>{
              const luz=luzByProd[p.id]||[], packed=packedByProd[p.id]||[]
              const d=detail[p.id]
              const byWsad={}; if(d) d.items.forEach(r=>{ (byWsad[r.wsad_id]=byWsad[r.wsad_id]||[]).push(r) })
              const wsadIds = d ? new Set((d.wsady||[]).map(w=>w.id)) : new Set()
              const orphan = d ? (d.items||[]).filter(r=>!r.wsad_id||!wsadIds.has(r.wsad_id)) : []
              return (
                <React.Fragment key={p.id}>
                  <tr>
                    <td style={{textAlign:'center'}}><button onClick={()=>toggle(p.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#5F5E5A'}}>{expanded===p.id?'▲':'▼'}</button></td>
                    <td><span className="lot">{p.lot_number}</span></td>
                    <td style={{fontSize:12,fontWeight:500}}>{p.recipes?.code} — {p.recipes?.name}</td>
                    <td style={{fontSize:12}}>{p.client||'—'}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{fmt(p.quantity_kg)} kg</td>
                    <td className="muted" style={{fontSize:12}}>{pdate(p)}</td>
                    <td style={{fontSize:11}}>
                      {luz.length>0 && <div>{luz.map(b=>b.lot_code).filter(Boolean).join(', ')||'—'}</div>}
                      {packed.length>0 && <div className="muted">pak.: {packed.map(b=>b.lot_code).filter(Boolean).join(', ')}</div>}
                      {luz.length===0 && packed.length===0 && <span className="muted">—</span>}
                    </td>
                    <td><span className={`badge ${p.prod_stage==='zaakceptowana'?'b-ok':'b-warn'}`} style={{fontSize:10}}>{STAGE[p.prod_stage]||p.prod_stage}</span></td>
                    <td><div className="flex" style={{gap:4}}>
                      <button className="btn btn-sm" onClick={()=>printOrder(p)} title="Karta dozowania">🖨</button>
                      {isAdmin && <button className="btn btn-sm" style={{background:'#E6F1FB',color:'#0C447C',border:'0.5px solid #B5D4F4'}} onClick={()=>openEditH(p)}>Edytuj</button>}
                      {isAdmin && <button className="btn btn-sm" style={{background:'#FFF3E0',color:'#E65100',border:'0.5px solid #FFCC80'}} onClick={()=>openEditI(p)} title="Ręczna edycja zużytych partii">Partie</button>}
                      {isAdmin && <button className="btn btn-sm btn-danger" onClick={()=>{ setDelErr(''); setDelProd(p) }}>Usuń</button>}
                    </div></td>
                  </tr>
                  {expanded===p.id && (
                    <tr><td colSpan={9} style={{padding:0,background:'#F9F8F5'}}>
                      <div style={{padding:'12px 16px 16px 40px'}}>
                        {!d ? <div className="muted" style={{fontSize:12}}>Ładowanie śladu...</div> : (
                          <>
                            <div className="flex" style={{justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                              <div style={{fontSize:12,fontWeight:600,color:'#0F6E56'}}>Pełny ślad identyfikowalności — {p.lot_number}</div>
                              <div className="flex" style={{gap:6}}>
                                <button className="btn btn-sm" onClick={()=>printTrace(p)}>🖨 Karta IFS (PDF)</button>
                                {isAdmin && <button className="btn btn-sm" style={{background:'#FFF3E0',color:'#E65100',border:'0.5px solid #FFCC80'}} onClick={()=>openEditI(p)}>Edytuj partie</button>}
                              </div>
                            </div>

                            <div style={{fontSize:11,fontWeight:600,color:'#5F5E5A',margin:'4px 0'}}>1. Surowce (wejście) — zużyte partie</div>
                            {(d.items||[]).length===0 && <div className="warn-box" style={{fontSize:12}}>Brak zapisanego zużycia surowców. Partie przypisuje się przy planowaniu — możesz je dodać ręcznie przyciskiem „Edytuj partie".</div>}
                            {(d.wsady||[]).map(w=>(
                              <div key={w.id} style={{marginBottom:8}}>
                                <div style={{fontSize:11,fontWeight:600,background:'#E1F5EE',padding:'3px 8px',borderRadius:4}}>Wsad W{w.wsad_no} — plan {fmt(w.planned_kg)} kg{w.actual_kg?` · rzecz. ${fmt(w.actual_kg)} kg`:''}</div>
                                {itemTable(byWsad[w.id]||[])}
                              </div>
                            ))}
                            {orphan.length>0 && <div style={{marginBottom:8}}>{(d.wsady||[]).length>0 && <div style={{fontSize:11,fontWeight:600,background:'#F1EFE8',padding:'3px 8px',borderRadius:4}}>Pozycje bez przypisanego wsadu</div>}{itemTable(orphan)}</div>}

                            <div style={{fontSize:11,fontWeight:600,color:'#5F5E5A',margin:'10px 0 4px'}}>2. Półprodukt — bigbagi (LOT)</div>
                            {luz.length===0 ? <div className="muted" style={{fontSize:12}}>Brak bigbagów.</div> : (
                              <table style={{width:'auto',minWidth:460}}><thead><tr><th>Kod bigbaga</th><th>LOT</th><th style={{textAlign:'right'}}>Masa</th></tr></thead>
                                <tbody>{luz.map((b,i)=>(<tr key={i}><td style={{fontFamily:'monospace',fontSize:11}}>{b.bb_code||'—'}</td><td style={{fontFamily:'monospace',fontSize:12}}>{b.lot_code||'—'}</td><td style={{textAlign:'right'}}>{fmt(b.quantity_kg)} kg</td></tr>))}</tbody></table>
                            )}

                            <div style={{fontSize:11,fontWeight:600,color:'#5F5E5A',margin:'10px 0 4px'}}>3. Wyrób gotowy — pakowanie (LOT)</div>
                            {(d.packed||[]).length===0 ? <div className="muted" style={{fontSize:12}}>Brak operacji pakowania.</div> : (
                              <table style={{width:'auto',minWidth:620}}><thead><tr><th>Nr pakowania</th><th>LOT wyrobu</th><th>Zlecenie sprzedaży</th><th style={{textAlign:'right'}}>Ilość</th><th>Data</th></tr></thead>
                                <tbody>{d.packed.map((b,i)=>(<tr key={i}><td style={{fontFamily:'monospace',fontSize:11}}>{b.packing_operations?.pack_number||'—'}</td><td style={{fontFamily:'monospace',fontSize:12}}>{b.lot_code||'—'}</td><td style={{fontSize:12}}>{b.orders?.order_number||'—'}</td><td style={{textAlign:'right'}}>{b.unit_count||0} szt · {fmt(b.quantity_kg)} kg</td><td className="muted" style={{fontSize:12}}>{b.packing_operations?.packing_date||'—'}</td></tr>))}</tbody></table>
                            )}

                            <div style={{fontSize:11,color:'#5F5E5A',marginTop:10}}><b>Podpisy:</b> Planista: {p.planned_by||'—'} · Magazynier: {p.picked_by||'—'} · Operator: {p.operator||'—'} · Akceptacja: {p.accepted_by||'—'}
                              {(p.production_order_sales||[]).length>0 && <> · Sprzedaż: {(p.production_order_sales||[]).map(x=>x.orders?.order_number).filter(Boolean).join(', ')}</>}
                            </div>
                          </>
                        )}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              )
            })}
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

      {/* Modal edycji nagłówka */}
      <div className={`modal-overlay ${editH?'open':''}`} onClick={e=>e.target===e.currentTarget && setEditH(null)}>
        <div className="modal" style={{maxWidth:540}}>
          <div className="modal-title">Edycja produkcji — {editH?.lot_number}</div>
          <div className="info-box" style={{marginBottom:10,fontSize:12}}>Edycja dostępna tylko dla Admina.</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Nr produkcji *</label><input value={editHForm.lot_number||''} onChange={e=>setEditHForm(f=>({...f,lot_number:e.target.value}))} /></div>
            <div><label>Klient</label><input value={editHForm.client||''} onChange={e=>setEditHForm(f=>({...f,client:e.target.value}))} /></div>
          </div>
          <div className="fr">
            <div><label>Masa (kg)</label><input type="text" inputMode="decimal" value={editHForm.quantity_kg||''} onChange={e=>setEditHForm(f=>({...f,quantity_kg:e.target.value}))} /></div>
            <div><label>Status</label>
              <select value={editHForm.prod_stage||'planowana'} onChange={e=>setEditHForm(f=>({...f,prod_stage:e.target.value}))}>
                {Object.entries(STAGE).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="fr3">
            <div><label>Planista</label><input value={editHForm.planned_by||''} onChange={e=>setEditHForm(f=>({...f,planned_by:e.target.value}))} /></div>
            <div><label>Operator</label><input value={editHForm.operator||''} onChange={e=>setEditHForm(f=>({...f,operator:e.target.value}))} /></div>
            <div><label>Akceptacja</label><input value={editHForm.accepted_by||''} onChange={e=>setEditHForm(f=>({...f,accepted_by:e.target.value}))} /></div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={()=>setEditH(null)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEditH} disabled={saving}>{saving?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      {/* Modal ręcznej edycji partii */}
      <div className={`modal-overlay ${editI?'open':''}`} onClick={e=>e.target===e.currentTarget && setEditI(null)}>
        <div className="modal" style={{maxWidth:820}}>
          <div className="modal-title">Ręczna edycja zużytych partii — {editI?.lot_number}</div>
          <div className="info-box" style={{marginBottom:10,fontSize:12}}>Sam wybierasz partię i ilość — program nic nie dobiera automatycznie. Zapis nadpisuje cały skład tej produkcji.</div>
          {editIErr && <div className="err-box">{editIErr}</div>}
          <div style={{maxHeight:'46vh',overflowY:'auto',marginBottom:8}}>
            <table style={{width:'100%'}}>
              <thead><tr><th>Składnik</th><th>Partia dostawy</th><th style={{width:110}}>Ilość (kg)</th><th style={{width:90}}>Wsad</th><th style={{width:40}}></th></tr></thead>
              <tbody>
                {editIList.length===0 && <tr><td colSpan={5} className="muted" style={{fontSize:12,padding:8}}>Brak pozycji — dodaj poniżej.</td></tr>}
                {editIList.map((r,idx)=>{
                  const batchOpts = batches.filter(b=>b.ingredient_id===r.ingredient_id)
                  return (
                    <tr key={idx}>
                      <td><select value={r.ingredient_id} onChange={e=>setIL(idx,'ingredient_id',e.target.value)} style={{minWidth:180}}>
                        <option value="">— składnik —</option>
                        {ingredients.map(i=><option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                      </select></td>
                      <td><select value={r.ingredient_batch_id} onChange={e=>setIL(idx,'ingredient_batch_id',e.target.value)} disabled={!r.ingredient_id} style={{minWidth:200}}>
                        <option value="">— partia —</option>
                        {batchOpts.map(b=><option key={b.id} value={b.id}>{b.delivery_lot} · {b.received_date} · {fmt(b.quantity_kg)}kg</option>)}
                      </select></td>
                      <td><input type="text" inputMode="decimal" value={r.quantity_used_kg} onChange={e=>setIL(idx,'quantity_used_kg',e.target.value)} style={{width:100}} /></td>
                      <td><select value={r.wsad_id} onChange={e=>setIL(idx,'wsad_id',e.target.value)} style={{width:80}}>
                        <option value="">—</option>
                        {editIWsady.map(w=><option key={w.id} value={w.id}>W{w.wsad_no}</option>)}
                      </select></td>
                      <td><button className="btn btn-sm btn-danger" style={{padding:'2px 7px'}} onClick={()=>rmIL(idx)}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm" onClick={addIL}>+ Dodaj pozycję</button>
          <div className="modal-footer">
            <button className="btn" onClick={()=>setEditI(null)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEditI} disabled={saving}>{saving?'Zapisywanie...':'Zapisz partie'}</button>
          </div>
        </div>
      </div>

      {/* Modal usuwania */}
      <div className={`modal-overlay ${delProd?'open':''}`} onClick={e=>e.target===e.currentTarget && setDelProd(null)}>
        <div className="modal" style={{maxWidth:480}}>
          <div className="modal-title">Usuń produkcję</div>
          <div className="warn-box">
            Usunąć produkcję <b>{delProd?.lot_number}</b> ({delProd?.recipes?.code})?<br/><br/>
            Zostaną usunięte: wsady, zużyte partie, bigbagi/wyroby i dokumenty WZ tej produkcji. Przypięte zlecenia sprzedaży wrócą na status „nowe".<br/><br/>
            Operacja nieodwracalna.
          </div>
          {delErr && <div className="err-box" style={{marginTop:8}}>{delErr}</div>}
          <div className="modal-footer">
            <button className="btn" onClick={()=>setDelProd(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={()=>doDelete(delProd)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
