import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STAGE = { planowana:'Zaplanowana', pobrana:'Pobrana', wyprodukowana:'Wyprodukowana', zaakceptowana:'Zaakceptowana' }

export default function Identyfikowalnosc() {
  const { profile } = useAuth()

  const [prods, setProds] = useState([])
  const [luzByProd, setLuzByProd] = useState({})
  const [packedByProd, setPackedByProd] = useState({})
  const [lotsByProd, setLotsByProd] = useState({})   // production_id -> Set(nr partii surowca)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState({})           // production_id -> { wsady, items, packed }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: pb }, { data: luz }, { data: pack }, { data: idx }] = await Promise.all([
      supabase.from('production_batches')
        .select('id,lot_number,recipe_id,quantity_kg,client,prod_stage,planned_by,operator,accepted_by,produced_at,accepted_at,recipes(code,name,version),production_order_sales(orders(order_number))')
        .order('produced_at',{ascending:false, nullsFirst:false}).limit(400),
      supabase.from('finished_goods').select('production_batch_id,bb_code,lot_code,bb_no,quantity_kg').eq('form','luz'),
      supabase.from('finished_goods').select('production_batch_id,lot_code,quantity_kg,unit_count,order_id').eq('form','spakowane'),
      supabase.from('production_batch_items').select('production_batch_id, ingredient_batches(delivery_lot)'),
    ])
    setProds(pb||[])
    const lm={}; (luz||[]).forEach(x=>{ (lm[x.production_batch_id]=lm[x.production_batch_id]||[]).push(x) })
    const pm={}; (pack||[]).forEach(x=>{ (pm[x.production_batch_id]=pm[x.production_batch_id]||[]).push(x) })
    const xm={}; (idx||[]).forEach(x=>{ const lot=x.ingredient_batches?.delivery_lot; if(lot){ (xm[x.production_batch_id]=xm[x.production_batch_id]||new Set()).add(lot) } })
    setLuzByProd(lm); setPackedByProd(pm); setLotsByProd(xm)
    setLoading(false)
  }

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

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})

  const filtered = prods.filter(p => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    if ((p.lot_number||'').toLowerCase().includes(q)) return true
    if ((`${p.recipes?.code} ${p.recipes?.name}`).toLowerCase().includes(q)) return true
    if ((p.client||'').toLowerCase().includes(q)) return true
    // LOT półproduktu / bigbag
    if ((luzByProd[p.id]||[]).some(b => (b.lot_code||'').toLowerCase().includes(q) || (b.bb_code||'').toLowerCase().includes(q))) return true
    // LOT wyrobu spakowanego
    if ((packedByProd[p.id]||[]).some(b => (b.lot_code||'').toLowerCase().includes(q))) return true
    // nr partii surowca (ślad wstecz)
    if (lotsByProd[p.id] && [...lotsByProd[p.id]].some(l => (l||'').toLowerCase().includes(q))) return true
    return false
  })

  function printTrace(p) {
    const d = detail[p.id]
    if (!d) return
    const byWsad={}; d.items.forEach(r=>{ (byWsad[r.wsad_id]=byWsad[r.wsad_id]||[]).push(r) })
    const wsadRows = (d.wsady||[]).map(w=>{
      const rows=(byWsad[w.id]||[]).map(r=>`<tr><td>${r.ingredients?.code||''}</td><td>${r.ingredients?.name||''}</td><td style="font-family:monospace">${r.ingredient_batches?.delivery_lot||'—'}</td><td>${r.ingredient_batches?.supplier_name||'—'}</td><td>${r.ingredient_batches?.expiry_date||'—'}</td><td style="text-align:right">${parseFloat(r.quantity_used_kg||0).toFixed(3)}</td></tr>`).join('')
      return `<tr class="w"><td colspan="6">Wsad W${w.wsad_no} — plan ${parseFloat(w.planned_kg||0).toFixed(3)} kg${w.actual_kg?` · rzeczywiście ${parseFloat(w.actual_kg).toFixed(3)} kg`:''}</td></tr>${rows||'<tr><td colspan=6 style="color:#888">brak pozycji</td></tr>'}`
    }).join('')
    const luzRows=(luzByProd[p.id]||[]).map(b=>`<tr><td style="font-family:monospace">${b.bb_code||'—'}</td><td style="font-family:monospace">${b.lot_code||'—'}</td><td style="text-align:right">${parseFloat(b.quantity_kg||0).toFixed(3)} kg</td></tr>`).join('')||'<tr><td colspan=3 style="color:#888">brak</td></tr>'
    const packRows=(d.packed||[]).map(b=>`<tr><td style="font-family:monospace">${b.packing_operations?.pack_number||'—'}</td><td style="font-family:monospace">${b.lot_code||'—'}</td><td>${b.orders?.order_number||'—'}</td><td style="text-align:right">${b.unit_count||0} szt · ${parseFloat(b.quantity_kg||0).toFixed(3)} kg</td><td>${b.packing_operations?.packing_date||'—'}</td></tr>`).join('')||'<tr><td colspan=5 style="color:#888">brak</td></tr>'
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Identyfikowalność ${p.lot_number}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#1a1a18}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:12px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.lot{font-size:14px;font-weight:bold;color:#0F6E56}h3{font-size:12px;margin:12px 0 4px;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:6px}th{background:#F1EFE8;font-size:9px;text-transform:uppercase;padding:4px 6px;border:1px solid #D3D1C7;text-align:left}td{padding:4px 6px;border:1px solid #D3D1C7;font-size:10px}.w td{background:#E1F5EE;font-weight:bold}@media print{@page{margin:10mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div style="font-weight:bold;margin-top:3px">Karta identyfikowalności (IFS)</div><div class="lot" style="margin-top:3px">${p.lot_number}</div></div>
<div style="text-align:right;font-size:10px;color:#555"><div>Produkt: <b>${p.recipes?.code||''} — ${p.recipes?.name||''}</b></div><div>Masa: <b>${parseFloat(p.quantity_kg||0).toFixed(3)} kg</b></div><div>Data produkcji: ${p.produced_at?p.produced_at.slice(0,10):'—'}</div><div>Data druku: ${new Date().toLocaleDateString('pl-PL')}</div></div></div>
<h3>1. Surowce (wejście) — wg wsadów</h3><table><thead><tr><th>Kod</th><th>Składnik</th><th>Nr partii dostawy</th><th>Dostawca</th><th>Ważny do</th><th style="text-align:right">Zużyto (kg)</th></tr></thead><tbody>${wsadRows||'<tr><td colspan=6 style="color:#888">brak danych</td></tr>'}</tbody></table>
<h3>2. Półprodukt — bigbagi (LOT)</h3><table><thead><tr><th>Kod bigbaga</th><th>LOT</th><th style="text-align:right">Masa</th></tr></thead><tbody>${luzRows}</tbody></table>
<h3>3. Wyrób gotowy — pakowanie (LOT)</h3><table><thead><tr><th>Nr pakowania</th><th>LOT wyrobu</th><th>Zlecenie sprzedaży</th><th style="text-align:right">Ilość</th><th>Data</th></tr></thead><tbody>${packRows}</tbody></table>
<div style="margin-top:16px;font-size:9px;color:#888">Podpisy produkcji — Planista: ${p.planned_by||'—'} · Operator: ${p.operator||'—'} · Akceptacja: ${p.accepted_by||'—'}</div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Identyfikowalność (IFS)</div><div className="page-sub">Ślad partii: surowiec → wsad → produkcja → bigbag → pakowanie. Wyszukaj dowolny numer partii lub LOT.</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Nr partii surowca, LOT wyrobu, nr produkcji, produkt..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:320 }} />
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
      </div>

      {search.trim() && <div className="info-box" style={{ marginBottom:10, fontSize:12 }}>
        Wyników: <b>{filtered.length}</b>. Wpisany numer dopasowywany jest do: nr produkcji, produktu, <b>nr partii surowca</b> (ślad wstecz), LOT bigbaga oraz LOT wyrobu spakowanego.
      </div>}

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:960 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <th>Nr produkcji</th><th>Produkt</th><th>Klient</th>
            <th style={{ textAlign:'right' }}>Masa</th>
            <th>Data produkcji</th><th>LOT-y wyrobu</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
            {!loading && filtered.map(p => {
              const luz = luzByProd[p.id]||[]
              const packed = packedByProd[p.id]||[]
              const d = detail[p.id]
              const byWsad = {}; if (d) d.items.forEach(r=>{ (byWsad[r.wsad_id]=byWsad[r.wsad_id]||[]).push(r) })
              return (
                <React.Fragment key={p.id}>
                  <tr>
                    <td style={{ textAlign:'center' }}><button onClick={()=>toggle(p.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#5F5E5A' }}>{expanded===p.id?'▲':'▼'}</button></td>
                    <td><span className="lot">{p.lot_number}</span></td>
                    <td style={{ fontSize:12, fontWeight:500 }}>{p.recipes?.code} — {p.recipes?.name}</td>
                    <td style={{ fontSize:12 }}>{p.client||'—'}</td>
                    <td style={{ textAlign:'right', fontWeight:600 }}>{fmt(p.quantity_kg)} kg</td>
                    <td className="muted" style={{ fontSize:12 }}>{p.produced_at?p.produced_at.slice(0,10):'—'}</td>
                    <td style={{ fontSize:11 }}>
                      {luz.length>0 && <div>{luz.map(b=>b.lot_code).filter(Boolean).join(', ')||'—'}</div>}
                      {packed.length>0 && <div className="muted">pak.: {packed.map(b=>b.lot_code).filter(Boolean).join(', ')}</div>}
                      {luz.length===0 && packed.length===0 && <span className="muted">—</span>}
                    </td>
                    <td><span className={`badge ${p.prod_stage==='zaakceptowana'?'b-ok':'b-warn'}`} style={{ fontSize:10 }}>{STAGE[p.prod_stage]||p.prod_stage}</span></td>
                    <td><button className="btn btn-sm" onClick={()=>toggle(p.id)}>Ślad</button></td>
                  </tr>
                  {expanded===p.id && (
                    <tr><td colSpan={9} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'12px 16px 16px 40px' }}>
                        {!d ? <div className="muted" style={{ fontSize:12 }}>Ładowanie śladu...</div> : (
                          <>
                            <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                              <div style={{ fontSize:12, fontWeight:600, color:'#0F6E56' }}>Pełny ślad identyfikowalności — {p.lot_number}</div>
                              <button className="btn btn-sm" onClick={()=>printTrace(p)}>🖨 Karta IFS (PDF)</button>
                            </div>

                            {/* 1. Surowce wg wsadów */}
                            <div style={{ fontSize:11, fontWeight:600, color:'#5F5E5A', margin:'4px 0' }}>1. Surowce (wejście) — wg wsadów</div>
                            {(d.wsady||[]).length===0 && <div className="muted" style={{ fontSize:12 }}>Brak wsadów / pozycji.</div>}
                            {(d.wsady||[]).map(w => (
                              <div key={w.id} style={{ marginBottom:8 }}>
                                <div style={{ fontSize:11, fontWeight:600, background:'#E1F5EE', padding:'3px 8px', borderRadius:4 }}>Wsad W{w.wsad_no} — plan {fmt(w.planned_kg)} kg{w.actual_kg?` · rzecz. ${fmt(w.actual_kg)} kg`:''}</div>
                                <table style={{ width:'auto', minWidth:620, marginTop:4 }}>
                                  <thead><tr><th>Kod</th><th>Składnik</th><th>Nr partii dostawy</th><th>Dostawca</th><th>Ważny do</th><th style={{ textAlign:'right' }}>Zużyto (kg)</th></tr></thead>
                                  <tbody>
                                    {(byWsad[w.id]||[]).length===0 && <tr><td colSpan={6} className="muted" style={{ fontSize:12 }}>brak pozycji</td></tr>}
                                    {(byWsad[w.id]||[]).map((r,i) => (
                                      <tr key={i}>
                                        <td><span className="lot" style={{ fontSize:11 }}>{r.ingredients?.code}</span></td>
                                        <td style={{ fontSize:12 }}>{r.ingredients?.name}</td>
                                        <td style={{ fontFamily:'monospace', fontSize:12 }}>{r.ingredient_batches?.delivery_lot||'—'}</td>
                                        <td style={{ fontSize:12 }}>{r.ingredient_batches?.supplier_name||'—'}</td>
                                        <td className="muted" style={{ fontSize:12 }}>{r.ingredient_batches?.expiry_date||'—'}</td>
                                        <td style={{ textAlign:'right', fontWeight:500 }}>{fmt(r.quantity_used_kg)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}

                            {/* 2. Półprodukt */}
                            <div style={{ fontSize:11, fontWeight:600, color:'#5F5E5A', margin:'10px 0 4px' }}>2. Półprodukt — bigbagi (LOT)</div>
                            {luz.length===0 ? <div className="muted" style={{ fontSize:12 }}>Brak bigbagów.</div> : (
                              <table style={{ width:'auto', minWidth:460 }}>
                                <thead><tr><th>Kod bigbaga</th><th>LOT</th><th style={{ textAlign:'right' }}>Masa</th></tr></thead>
                                <tbody>{luz.map((b,i)=>(<tr key={i}><td style={{ fontFamily:'monospace', fontSize:11 }}>{b.bb_code||'—'}</td><td style={{ fontFamily:'monospace', fontSize:12 }}>{b.lot_code||'—'}</td><td style={{ textAlign:'right' }}>{fmt(b.quantity_kg)} kg</td></tr>))}</tbody>
                              </table>
                            )}

                            {/* 3. Pakowanie */}
                            <div style={{ fontSize:11, fontWeight:600, color:'#5F5E5A', margin:'10px 0 4px' }}>3. Wyrób gotowy — pakowanie (LOT)</div>
                            {(d.packed||[]).length===0 ? <div className="muted" style={{ fontSize:12 }}>Brak operacji pakowania.</div> : (
                              <table style={{ width:'auto', minWidth:620 }}>
                                <thead><tr><th>Nr pakowania</th><th>LOT wyrobu</th><th>Zlecenie sprzedaży</th><th style={{ textAlign:'right' }}>Ilość</th><th>Data</th></tr></thead>
                                <tbody>{d.packed.map((b,i)=>(<tr key={i}><td style={{ fontFamily:'monospace', fontSize:11 }}>{b.packing_operations?.pack_number||'—'}</td><td style={{ fontFamily:'monospace', fontSize:12 }}>{b.lot_code||'—'}</td><td style={{ fontSize:12 }}>{b.orders?.order_number||'—'}</td><td style={{ textAlign:'right' }}>{b.unit_count||0} szt · {fmt(b.quantity_kg)} kg</td><td className="muted" style={{ fontSize:12 }}>{b.packing_operations?.packing_date||'—'}</td></tr>))}</tbody>
                              </table>
                            )}

                            <div style={{ fontSize:11, color:'#5F5E5A', marginTop:10 }}><b>Podpisy:</b> Planista: {p.planned_by||'—'} · Operator: {p.operator||'—'} · Akceptacja: {p.accepted_by||'—'}
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
    </div>
  )
}
