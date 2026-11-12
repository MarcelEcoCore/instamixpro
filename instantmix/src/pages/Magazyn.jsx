import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Magazyn() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAlert, setFilterAlert] = useState('wszystkie')
  const [editingMin, setEditingMin] = useState({})
  const [savingMin, setSavingMin] = useState({})
  const [expandedId, setExpandedId] = useState(null)
  const [batchDetails, setBatchDetails] = useState({})


  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: ingredients } = await supabase
      .from('ingredients').select('id,code,name,has_allergen,allergen_type,minimum_stock_kg')
      .eq('status','aktywny').order('code')
    const { data: stock } = await supabase.from('v_stock').select('*')
    const { data: used } = await supabase.from('production_batch_items').select('ingredient_id,quantity_used_kg, production_batches!inner(id)')

    const stockMap = {}
    for (const s of (stock||[])) {
      if (!stockMap[s.ingredient_id]) stockMap[s.ingredient_id] = { total:0, original:0, corrections:0, value:0, batches:[], avgNum:0, avgDen:0 }
      stockMap[s.ingredient_id].original += parseFloat(s.original_kg||0)
      stockMap[s.ingredient_id].corrections += parseFloat(s.corrections_kg||0)
      // średnia ważona cena zakupu — z PEŁNYCH przyjętych partii (oryginalna waga × cena)
      const oKg = parseFloat(s.original_kg||0)
      const oPrice = parseFloat(s.unit_price_pln||0)
      if (oPrice > 0 && oKg > 0) { stockMap[s.ingredient_id].avgNum += oKg * oPrice; stockMap[s.ingredient_id].avgDen += oKg }
      if (s.status==='dopuszczona') {
        const currentKg = parseFloat(s.current_kg||0)
        stockMap[s.ingredient_id].total += currentKg
        const price = parseFloat(s.unit_price_pln||0)
        if (price > 0) stockMap[s.ingredient_id].value += currentKg * price
        stockMap[s.ingredient_id].batches.push({...s, batch_value: price > 0 ? currentKg * price : null})
      }
    }
    const usedMap = {}
    for (const u of (used||[])) {
      usedMap[u.ingredient_id] = (usedMap[u.ingredient_id]||0) + parseFloat(u.quantity_used_kg||0)
    }
    const result = (ingredients||[]).map(ing => {
      const availableStock = stockMap[ing.id]?.total||0
      const originalStock = stockMap[ing.id]?.original||0
      const correctionsTotal = stockMap[ing.id]?.corrections||0
      const usedTotal = usedMap[ing.id]||0
      const current = Math.max(0, availableStock - usedTotal)
      const minimum = parseFloat(ing.minimum_stock_kg||0)
      const batchCount = stockMap[ing.id]?.batches?.length||0

      let remaining_used = usedTotal
      let currentValue = 0
      const batches = (stockMap[ing.id]?.batches||[]).slice().sort((a,b) => new Date(a.received_date) - new Date(b.received_date))
      for (const b of batches) {
        const bKg = parseFloat(b.current_kg||0)
        const bPrice = parseFloat(b.unit_price_pln||0)
        const afterUse = Math.max(0, bKg - remaining_used)
        remaining_used = Math.max(0, remaining_used - bKg)
        if (bPrice > 0 && afterUse > 0) currentValue += afterUse * bPrice
      }

      let alert = 'ok'
      if (minimum>0) {
        if (current===0) alert='empty'
        else if (current<=minimum) alert='critical'
        else if (current<=minimum*1.5) alert='warning'
      }
      if (current===0&&minimum===0) alert='empty'
      return { id:ing.id, code:ing.code, name:ing.name, has_allergen:ing.has_allergen,
        allergen_type:ing.allergen_type,
        in_stock:parseFloat(originalStock.toFixed(3)),
        corrections_total:parseFloat(correctionsTotal.toFixed(3)),
        used_total:parseFloat(usedTotal.toFixed(3)),
        current:parseFloat(current.toFixed(3)),
        value:parseFloat(currentValue.toFixed(2)),
        avg_price: (stockMap[ing.id]?.avgDen>0) ? parseFloat((stockMap[ing.id].avgNum/stockMap[ing.id].avgDen).toFixed(2)) : null,
        minimum, batch_count:batchCount, alert }
    })
    setRows(result)
    setLoading(false)
  }

  async function loadBatchDetails(ingredientId) {
    if (expandedId === ingredientId) { setExpandedId(null); return }
    const { data } = await supabase
      .from('v_stock').select('*').eq('ingredient_id', ingredientId)
      .order('received_date', { ascending: true })
    setBatchDetails(p => ({ ...p, [ingredientId]: data||[] }))
    setExpandedId(ingredientId)
  }

  const filtered = rows.filter(r => {
    const matchQ = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase())
    const matchAlert = filterAlert==='wszystkie' ? true :
      filterAlert==='alerty' ? ['critical','warning','empty'].includes(r.alert) :
      filterAlert==='krytyczne' ? ['critical','empty'].includes(r.alert) :
      filterAlert==='ok' ? r.alert==='ok' : true
    return matchQ && matchAlert
  })

  const stats = {
    total: rows.length,
    critical: rows.filter(r => ['critical','empty'].includes(r.alert)&&r.minimum>0).length,
    warning: rows.filter(r => r.alert==='warning').length,
    empty: rows.filter(r => r.current===0).length,
  }

  const totalValue = filtered.reduce((s,r) => s + r.value, 0)

  async function saveMinimum(ingredientId, value) {
    setSavingMin(p => ({ ...p, [ingredientId]:true }))
    await supabase.from('ingredients').update({ minimum_stock_kg: parseFloat(value)||0 }).eq('id',ingredientId)
    setSavingMin(p => ({ ...p, [ingredientId]:false }))
    setEditingMin(p => ({ ...p, [ingredientId]:undefined }))
    load()
  }

  function alertBadge(r) {
    if (r.alert==='empty') return <span className="badge b-err">Brak</span>
    if (r.alert==='critical') return <span className="badge b-err">Krytyczny</span>
    if (r.alert==='warning') return <span className="badge b-warn">Niski</span>
    return <span className="badge b-ok">OK</span>
  }

  function alertRowStyle(r) {
    if (r.alert==='empty'||r.alert==='critical') return { background:'#FCEBEB55' }
    if (r.alert==='warning') return { background:'#FAEEDA33' }
    return {}
  }

  function stockBar(r) {
    if (r.minimum===0) return null
    const pct = Math.min(100, Math.round((r.current/(r.minimum*2))*100))
    const color = r.alert==='critical'||r.alert==='empty' ? '#E24B4A' : r.alert==='warning' ? '#EF9F27' : '#1D9E75'
    return (
      <div style={{ height:6, background:'#F1EFE8', borderRadius:999, marginTop:3, width:80 }}>
        <div style={{ height:6, width:`${pct}%`, background:color, borderRadius:999 }} />
      </div>
    )
  }

  function printInventory() {
    const dateStr = new Date().toLocaleDateString('pl-PL')
    const timeStr = new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})
    const tableRows = filtered.map((r,i) => `<tr><td>${i+1}</td><td style="font-family:monospace">${r.code}</td><td>${r.name}</td><td style="text-align:right">${r.in_stock.toFixed(3)}</td><td style="text-align:right">${r.corrections_total !== 0 ? (r.corrections_total > 0 ? '+' : '') + r.corrections_total.toFixed(3) : '—'}</td><td style="text-align:right">${r.used_total.toFixed(3)}</td><td style="text-align:right"><strong>${r.current.toFixed(3)}</strong></td><td style="text-align:right">${r.value > 0 ? r.value.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}</td><td style="text-align:right">${r.minimum>0?r.minimum.toFixed(3):'—'}</td><td>${r.alert==='empty'?'<span style="color:#791F1F;font-weight:bold">Brak</span>':r.alert==='critical'?'<span style="color:#791F1F;font-weight:bold">Krytyczny</span>':r.alert==='warning'?'<span style="color:#633806">Niski</span>':'OK'}</td><td></td></tr>`).join('')
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Inwentura magazynowa</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;padding:14px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:8px;margin-bottom:10px}.company{font-size:15px;font-weight:bold;color:#0F6E56}.title{font-size:12px;font-weight:bold;margin-top:3px}table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#0F6E56;color:#fff;padding:5px;border:1px solid #085041;font-size:8px;text-align:left}td{padding:4px 5px;border:1px solid #D3D1C7}tr:nth-child(even) td{background:#FAFAF8}.total td{background:#E1F5EE!important;font-weight:bold}.sig{margin-top:14px;border:1px solid #D3D1C7;border-radius:4px;padding:10px}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:10px}.sig-line{border-bottom:1px solid #333;margin-bottom:3px;margin-top:20px}.sig-label{font-size:8px;color:#888;text-transform:uppercase}@media print{@page{margin:8mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div class="title">Inwentura magazynowa składników</div><div style="font-size:13px;font-weight:bold;color:#0F6E56;margin-top:2px">Stan na dzień: ${dateStr}</div></div><div style="text-align:right;font-size:9px;color:#555">Wygenerowano: ${dateStr} ${timeStr}<br>Wydrukował: ${profile?.full_name||'—'}</div></div>
<table><thead><tr><th style="width:22px">Lp.</th><th style="width:60px">Kod</th><th>Nazwa składnika</th><th style="width:70px;text-align:right">Przyjęto (kg)</th><th style="width:60px;text-align:right">Korekty (kg)</th><th style="width:70px;text-align:right">Zużyto (kg)</th><th style="width:70px;text-align:right">Stan (kg)</th><th style="width:90px;text-align:right">Wartość (zł)</th><th style="width:70px;text-align:right">Minimum (kg)</th><th style="width:60px">Status</th><th style="width:100px">Uwagi</th></tr></thead>
<tbody>${tableRows}<tr class="total"><td colspan="3" style="text-align:right">SUMA:</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.in_stock,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.corrections_total,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.used_total,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.current,0).toFixed(3)}</td><td style="text-align:right">${filtered.reduce((s,r)=>s+r.value,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td><td colspan="3"></td></tr></tbody></table>
<div class="sig"><div style="font-weight:bold;font-size:10px;border-bottom:1px solid #D3D1C7;padding-bottom:5px">Potwierdzenie inwentury</div><div class="sig-grid"><div><div class="sig-label">Przeprowadził inwenturę</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził (Brygadzista)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził (Kierownik)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div></div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win = window.open('','_blank'); win.document.write(html); win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Magazyn składników</div>
          <div className="page-sub">Stan aktualny = przyjęte partie + korekty − zużycie produkcyjne</div>
        </div>
        <div className="flex" style={{ gap:6, flexWrap:'wrap' }}>
          <button className="btn btn-sm" onClick={printInventory}>Drukuj inwenturę</button>
          <button className="btn btn-sm" onClick={load}>Odśwież</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Składników aktywnych</div><div className="stat-val">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Stan krytyczny / brak</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.critical}</div></div>
        <div className="stat-card"><div className="stat-label">Stan niski</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.warning}</div></div>
        <div className="stat-card"><div className="stat-label">Wartość magazynu</div><div className="stat-val" style={{ fontSize:16 }}>{totalValue > 0 ? totalValue.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:12, gap:8, flexWrap:'wrap' }}>
        <input className="search" placeholder="Szukaj składnika..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
        {['wszystkie','alerty','krytyczne','ok'].map(f => (
          <button key={f} className="btn btn-sm" onClick={() => setFilterAlert(f)}
            style={{ background:filterAlert===f?'#1D9E75':undefined, color:filterAlert===f?'#fff':undefined, borderColor:filterAlert===f?'#1D9E75':undefined }}>
            {f==='wszystkie'?'Wszystkie':f==='alerty'?'Wszystkie alerty':f==='krytyczne'?'Krytyczne':'OK'}
          </button>
        ))}
      </div>

      {isAdmin && <div className="info-box" style={{ marginBottom:10, fontSize:12 }}>Jako Admin możesz edytować minimalne stany — kliknij wartość w kolumnie "Minimum (kg)".</div>}

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 300px)' }}>
        <table style={{ minWidth:960 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <th>Kod</th><th>Nazwa składnika</th>
            <th style={{ textAlign:'right' }}>Stan aktualny (kg)</th>
            <th style={{ textAlign:'right' }}>Wartość (zł)</th>
            <th style={{ textAlign:'right' }}>Śr. cena zakupu (zł/kg)</th>
            <th style={{ textAlign:'right' }}>Minimum (kg)</th>
            <th>Status</th>
            <th style={{ textAlign:'center' }}>Partie</th>
            <th>Alergen</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:'#888' }}><span className="spinner" /> Obliczam stany...</td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
            {!loading && filtered.map(r => (
              <React.Fragment key={r.id}>
                <tr style={alertRowStyle(r)}>
                  <td style={{ textAlign:'center' }}>
                    <button onClick={() => loadBatchDetails(r.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                      {expandedId===r.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className="lot">{r.code}</span></td>
                  <td style={{ fontWeight:500 }}>{r.name}</td>
                  <td style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>{r.current.toFixed(3)}</div>
                    {stockBar(r)}
                  </td>
                  <td style={{ textAlign:'right', color: r.value > 0 ? '#3C3489' : '#888', fontWeight: r.value > 0 ? 500 : 400 }}>
                    {r.value > 0 ? r.value.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}
                  </td>
                  <td style={{ textAlign:'right', color: r.avg_price != null ? '#0C447C' : '#888' }}>
                    {r.avg_price != null ? r.avg_price.toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł' : '—'}
                  </td>
                  <td style={{ textAlign:'right' }}>
                    {isAdmin ? (
                      editingMin[r.id]!==undefined ? (
                        <div className="flex" style={{ gap:4, justifyContent:'flex-end' }}>
                          <input type="number" step="0.1" min="0" defaultValue={editingMin[r.id]} id={`min-${r.id}`}
                            style={{ width:80, padding:'3px 6px', fontSize:12 }}
                            onKeyDown={e => { if(e.key==='Enter') saveMinimum(r.id,e.target.value); if(e.key==='Escape') setEditingMin(p=>({...p,[r.id]:undefined})) }}/>
                          <button className="btn btn-sm btn-primary" style={{ padding:'3px 8px', fontSize:11 }}
                            onClick={() => saveMinimum(r.id, document.getElementById(`min-${r.id}`).value)}
                            disabled={savingMin[r.id]}>{savingMin[r.id]?'...':'Zapisz'}</button>
                          <button className="btn btn-sm" style={{ padding:'3px 6px', fontSize:11 }}
                            onClick={() => setEditingMin(p=>({...p,[r.id]:undefined}))}>✕</button>
                        </div>
                      ) : (
                        <span onClick={() => setEditingMin(p=>({...p,[r.id]:r.minimum}))}
                          style={{ cursor:'pointer', borderBottom:'1px dashed #B4B2A9', paddingBottom:1 }}>
                          {r.minimum>0 ? r.minimum.toFixed(3) : <span className="muted">ustaw →</span>}
                        </span>
                      )
                    ) : <span>{r.minimum>0?r.minimum.toFixed(3):<span className="muted">—</span>}</span>}
                  </td>
                  <td>{alertBadge(r)}</td>
                  <td style={{ textAlign:'center', color:'#5F5E5A' }}>{r.batch_count}</td>
                  <td>{r.has_allergen?<span className="badge b-err">{r.allergen_type}</span>:<span className="muted">—</span>}</td>
                </tr>
                {expandedId===r.id && (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={10} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'8px 16px 10px 40px' }}>
                        <div style={{ fontSize:12, fontWeight:500, marginBottom:6, color:'#0F6E56' }}>Partie na stanie — {r.name}</div>
                        <div style={{ fontSize:11, color:'#5F5E5A', marginBottom:8 }}>Przyjęto: <b>{r.in_stock.toFixed(3)}</b> · Korekty: <b>{r.corrections_total>0?'+':''}{r.corrections_total.toFixed(3)}</b> · Zużyto: <b>{r.used_total.toFixed(3)}</b> · Stan: <b style={{color:'#0F6E56'}}>{r.current.toFixed(3)} kg</b></div>
                        {!batchDetails[r.id] || batchDetails[r.id].length===0 ? (
                          <div className="muted" style={{ fontSize:12 }}>Brak dopuszczonych partii na stanie</div>
                        ) : (
                          <table style={{ width:'auto', minWidth:500 }}>
                            <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
                              <th>Nr partii dostawy</th><th>Data przyjęcia</th><th>Data ważności</th>
                              <th style={{ textAlign:'right' }}>Stan (kg)</th>
                              <th style={{ textAlign:'right' }}>Wartość (zł)</th>
                              <th>Status</th>
                            </tr></thead>
                            <tbody>
                              {batchDetails[r.id].map(b => {
                                const isExpiring = b.expiry_date && (new Date(b.expiry_date)-new Date()) < 30*24*3600*1000 && new Date(b.expiry_date)>new Date()
                                const isExpired = b.expiry_date && new Date(b.expiry_date) < new Date()
                                const hasCorr = parseFloat(b.corrections_kg||0) !== 0
                                return (
                                  <tr key={b.id}>
                                    <td><span className="lot">{b.delivery_lot}</span></td>
                                    <td className="muted">{b.received_date}</td>
                                    <td style={{ color: isExpired?'#A32D2D':isExpiring?'#BA7517':undefined, fontWeight: isExpiring||isExpired?500:undefined }}>
                                      {b.expiry_date||'—'}
                                      {isExpiring && <span className="badge b-warn" style={{ marginLeft:6, fontSize:10 }}>Wygasa wkrótce</span>}
                                      {isExpired && <span className="badge b-err" style={{ marginLeft:6, fontSize:10 }}>Przeterminowana</span>}
                                    </td>
                                    <td style={{ textAlign:'right' }}>
                                      {hasCorr && <span style={{ textDecoration:'line-through', color:'#888', marginRight:6, fontSize:11 }}>{parseFloat(b.original_kg).toFixed(3)}</span>}
                                      <span style={{ fontWeight:700, color: hasCorr ? '#A32D2D' : undefined }}>{parseFloat(b.current_kg).toFixed(3)}</span>
                                      {hasCorr && <span style={{ fontSize:10, color:'#A32D2D', marginLeft:4 }}>({parseFloat(b.corrections_kg)>0?'+':''}{parseFloat(b.corrections_kg).toFixed(3)})</span>}
                                    </td>
                                    <td style={{ textAlign:'right', color: (parseFloat(b.unit_price_pln||0) > 0) ? '#3C3489' : '#888', fontSize:12 }}>
                                      {parseFloat(b.unit_price_pln||0) > 0
                                        ? (parseFloat(b.current_kg) * parseFloat(b.unit_price_pln)).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł'
                                        : '—'}
                                    </td>
                                    <td><span className={`badge ${b.status==='dopuszczona'?'b-ok':'b-err'}`}>{b.status}</span></td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && stats.critical>0 && (
        <div className="err-box" style={{ marginTop:10 }}>
          Uwaga: {stats.critical} {stats.critical===1?'składnik wymaga':'składniki wymagają'} uzupełnienia.
        </div>
      )}
    </div>
  )
}
