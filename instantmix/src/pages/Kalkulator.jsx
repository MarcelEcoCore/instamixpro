import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STATUS = { nowe:'Nowe', zaplanowane:'Zaplanowane', w_produkcji:'W produkcji' }

export default function Kalkulator() {
  const { profile } = useAuth()
  const canEdit = true // dostępy później

  const [orders, setOrders] = useState([])
  const [recipesMap, setRecipesMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // planowanie
  const [planModal, setPlanModal] = useState(false)
  const [planOrder, setPlanOrder] = useState(null)
  const [planForm, setPlanForm] = useState({ planned_date:'', production_priority:'', planning_notes:'' })

  // uruchomienie produkcji
  const [runModal, setRunModal] = useState(false)
  const [runOrder, setRunOrder] = useState(null)
  const [runRecipe, setRunRecipe] = useState(null)
  const [runMass, setRunMass] = useState(0)
  const [fifo, setFifo] = useState([])
  const [runForm, setRunForm] = useState({ operator:'', foreman:'', notes:'' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true); setError('')
    const [{ data: ords, error: oerr }, { data: recs }] = await Promise.all([
      supabase.from('orders')
        .select('*, clients(number,name), bom(code_ext,recipe_id,gramatura_kg,units_per_pallet), recipes(code,name,version)')
        .in('status', ['nowe','zaplanowane'])
        .order('production_priority', { ascending:true, nullsFirst:false })
        .order('ship_date', { ascending:true }),
      supabase.from('recipes').select('*, recipe_items(*, ingredients(*))').eq('status','dopuszczona'),
    ])
    if (oerr) setError(oerr.message)
    const rm = {}; (recs||[]).forEach(r => { rm[r.id] = r })
    setRecipesMap(rm)
    setOrders(ords || [])
    setLoading(false)
  }

  const massOf = o => {
    if (o.quantity_kg != null && parseFloat(o.quantity_kg) > 0) return parseFloat(o.quantity_kg)
    const g = parseFloat(o.bom?.gramatura_kg || 0), u = parseFloat(o.qty_units || 0)
    return parseFloat((g*u).toFixed(3))
  }
  const wyrob = o => o.bom?.code_ext || o.recipes?.code || '—'
  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'

  const nowe = orders.filter(o => o.status === 'nowe')
  const kolejka = orders.filter(o => o.status === 'zaplanowane')

  // ── Planowanie ──
  function openPlan(o) {
    const nextPrio = (kolejka.reduce((m,x) => Math.max(m, parseInt(x.production_priority||0,10)), 0)) + 1
    setPlanOrder(o)
    setPlanForm({ planned_date: o.planned_date || new Date().toISOString().slice(0,10), production_priority: o.production_priority || nextPrio, planning_notes: o.planning_notes || '' })
    setError(''); setPlanModal(true)
  }
  async function savePlan() {
    setSaving(true); setError('')
    const { error: err } = await supabase.from('orders').update({
      status: 'zaplanowane',
      planned_date: planForm.planned_date || null,
      production_priority: planForm.production_priority==='' ? null : parseInt(planForm.production_priority,10),
      planning_notes: planForm.planning_notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', planOrder.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setPlanModal(false); loadAll()
  }
  async function unplan(o) {
    await supabase.from('orders').update({ status:'nowe', updated_at:new Date().toISOString() }).eq('id', o.id)
    loadAll()
  }

  // ── Uruchomienie produkcji (FIFO) ──
  async function openRun(o) {
    const recipe = recipesMap[o.recipe_id] || (o.bom?.recipe_id ? recipesMap[o.bom.recipe_id] : null)
    if (!recipe) { setError('Brak dopuszczonej receptury dla tego zlecenia.'); return }
    const mass = massOf(o)
    setRunOrder(o); setRunRecipe(recipe); setRunMass(mass)
    setRunForm({ operator:'', foreman:'', notes: o.planning_notes || '' })
    setError('')
    // dostępność FIFO
    const { data: used } = await supabase.from('production_batch_items').select('ingredient_batch_id, quantity_used_kg')
    const usedMap = {}; (used||[]).forEach(u => { usedMap[u.ingredient_batch_id] = (usedMap[u.ingredient_batch_id]||0) + parseFloat(u.quantity_used_kg) })
    const { data: stock } = await supabase.from('v_stock').select('*').eq('status','dopuszczona')
      .order('received_date',{ascending:true}).order('expiry_date',{ascending:true,nullsFirst:false})
    const availMap = {}
    ;(stock||[]).forEach(s => {
      const avail = parseFloat(s.current_kg) - (usedMap[s.id]||0)
      if (avail > 0.001) { (availMap[s.ingredient_id] = availMap[s.ingredient_id] || []).push({ id:s.id, lot:s.delivery_lot, available:parseFloat(avail.toFixed(3)) }) }
    })
    const result = []
    ;[...(recipe.recipe_items||[])].sort((a,b) => (a.sort_order||0)-(b.sort_order||0)).forEach(item => {
      const needed = parseFloat(((mass * parseFloat(item.percentage||0)) / 100).toFixed(3))
      let remaining = needed; const lots = []
      for (const row of (availMap[item.ingredient_id] || [])) {
        if (remaining <= 0.001) break
        const take = Math.min(remaining, row.available)
        if (take > 0.001) { lots.push({ lot:row.lot, ingredient_batch_id:row.id, kg:parseFloat(take.toFixed(3)) }); remaining = parseFloat((remaining-take).toFixed(3)) }
      }
      result.push({ ingredient_id:item.ingredient_id, ingredient:item.ingredients, needed, lots, shortage: remaining>0.001 ? remaining : 0 })
    })
    setFifo(result); setRunModal(true)
  }

  const hasShortage = fifo.some(r => r.shortage > 0)
  const allergens = [...new Set(fifo.filter(r => r.ingredient?.has_allergen).map(r => r.ingredient.allergen_type))]

  async function genLot() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('production_batches').select('lot_number').like('lot_number',`PROD-${year}-%`).order('lot_number',{ascending:false}).limit(1)
    let n = 1
    if (data && data.length) n = (parseInt((data[0].lot_number.split('-')[2])||'0',10)) + 1
    return `PROD-${year}-${String(n).padStart(4,'0')}`
  }

  async function startProduction() {
    setSaving(true); setError('')
    const lot = await genLot()
    const { data: pb, error: err } = await supabase.from('production_batches').insert({
      lot_number: lot,
      recipe_id: runRecipe.id,
      quantity_kg: runMass,
      operator: runForm.operator || null,
      foreman: runForm.foreman || null,
      notes: runForm.notes || null,
      technologist: profile?.full_name || null,
      client: runOrder.clients?.name || runRecipe.client || null,
      created_by: profile?.id,
    }).select().single()
    if (err) { setError(err.message); setSaving(false); return }
    const items = fifo.flatMap(r => r.lots.map((l,li) => ({
      production_batch_id: pb.id, ingredient_batch_id: l.ingredient_batch_id,
      ingredient_id: r.ingredient_id, quantity_used_kg: l.kg, fifo_order: li+1,
    })))
    if (items.length) await supabase.from('production_batch_items').insert(items)
    await supabase.from('orders').update({ status:'w_produkcji', production_batch_id: pb.id, updated_at:new Date().toISOString() }).eq('id', runOrder.id)
    setSaving(false); setRunModal(false); loadAll()
  }

  function printSheet() {
    if (!runRecipe) return
    const now = new Date()
    const dateStr = now.toLocaleDateString('pl-PL'), timeStr = now.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})
    const allergenBlock = allergens.length>0
      ? `<div class="allergen-box"><strong>⚠ ALERGENY:</strong> ${allergens.join(', ')}</div>`
      : `<div class="no-allergen-box">✓ Brak alergenów w tej partii</div>`
    const rows = fifo.map((r,idx) => {
      const lotsText = r.lots.length ? r.lots.map((l,i) => `${l.lot}${r.lots.length>1?` (FIFO ${i+1}: ${l.kg} kg)`:''}`).join('<br>') : '<span style="color:#A32D2D">BRAK W MAGAZYNIE</span>'
      return `<tr><td class="check-cell"><div class="checkbox"></div></td><td class="num">${idx+1}</td><td class="code">${r.ingredient?.code||''}</td><td>${r.ingredient?.name||''}</td><td class="kg"><strong>${r.needed.toFixed(3)}</strong></td><td class="lot-cell">${lotsText}</td><td class="allergy-cell">${r.ingredient?.has_allergen?`<span class="tag-allergy">${r.ingredient.allergen_type}</span>`:'—'}</td><td class="verify-cell"><div class="checkbox"></div></td></tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Zlecenie produkcji - ${runRecipe.code}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#000;padding:16px}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:12px}
.company{font-size:16px;font-weight:bold;color:#0F6E56}.doc-title{font-size:13px;font-weight:bold;margin-top:4px}
.lot-badge{background:#E1F5EE;border:1px solid #1D9E75;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:bold;color:#0F6E56;margin-top:4px;display:inline-block}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
.info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}.info-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}.info-value{font-size:12px;font-weight:bold}
.section-title{font-size:11px;font-weight:bold;background:#0F6E56;color:#fff;padding:5px 10px}
table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#F1EFE8;font-size:9px;font-weight:bold;text-transform:uppercase;padding:5px 6px;border:1px solid #D3D1C7;text-align:left}
td{padding:5px 6px;border:1px solid #D3D1C7;font-size:10px}tr:nth-child(even) td{background:#FAFAF8}
.check-cell{width:24px;text-align:center}.checkbox{width:14px;height:14px;border:1.5px solid #333;border-radius:2px;margin:0 auto}
.num{width:20px;text-align:center;color:#888}.code{width:70px;font-family:monospace}.kg{width:70px;text-align:right}.lot-cell{font-family:monospace;font-size:9px}.verify-cell{width:60px;text-align:center}.allergy-cell{width:70px}
.tag-allergy{background:#FCEBEB;color:#791F1F;border:1px solid #F09595;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:bold}
.total-row td{background:#E1F5EE!important;font-weight:bold}
.allergen-box{background:#FCEBEB;border:1.5px solid #E24B4A;border-radius:4px;padding:8px 12px;margin-bottom:10px;color:#501313}.no-allergen-box{background:#E1F5EE;border:1px solid #1D9E75;border-radius:4px;padding:6px 12px;margin-bottom:10px;color:#085041}
.sign{margin-top:16px;border:1px solid #D3D1C7;border-radius:4px;padding:12px}.sign-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}.sl{border-bottom:1px solid #333;margin-top:24px;margin-bottom:4px}.sn{font-size:9px;color:#888}
@media print{body{padding:8px}@page{margin:10mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div class="doc-title">Zlecenie produkcji / Checklista dozowania</div><div class="lot-badge">Nr partii nadany po uruchomieniu</div></div>
<div style="text-align:right;font-size:10px;color:#555"><div>Data: <strong>${dateStr} ${timeStr}</strong></div><div>Zlecenie: <strong>${runOrder?.order_number||'—'}</strong></div><div>Wydrukował: <strong>${profile?.full_name||'—'}</strong></div></div></div>
<div class="info-grid">
<div class="info-box"><div class="info-label">Klient</div><div class="info-value">${runOrder?.clients?.name||'—'}</div></div>
<div class="info-box"><div class="info-label">Wyrób (BOM)</div><div class="info-value">${runOrder?.bom?.code_ext||'—'}</div></div>
<div class="info-box"><div class="info-label">Receptura</div><div class="info-value">${runRecipe.code} (v${runRecipe.version})</div></div>
<div class="info-box"><div class="info-label">Ilość sztuk</div><div class="info-value">${runOrder?.qty_units||'—'}</div></div>
<div class="info-box"><div class="info-label">Masa wsadu</div><div class="info-value">${runMass} kg</div></div>
<div class="info-box"><div class="info-label">Linia</div><div class="info-value">${runRecipe.production_line==='bezglutenowa'?'BEZGLUTENOWA':'Zwykła'}</div></div></div>
${allergenBlock}
<div class="section-title">Lista składników do dozowania — FIFO</div>
<table><thead><tr><th class="check-cell">Odważ.</th><th class="num">Lp.</th><th class="code">Kod</th><th>Nazwa składnika</th><th class="kg">Ilość (kg)</th><th>Partia (FIFO)</th><th class="allergy-cell">Alergen</th><th class="verify-cell">Weryf.</th></tr></thead><tbody>
${rows}
<tr class="total-row"><td></td><td></td><td colspan="2" style="text-align:right">SUMA WSADU:</td><td style="text-align:right">${fifo.reduce((s,r)=>s+r.needed,0).toFixed(3)} kg</td><td colspan="3"></td></tr>
</tbody></table>
<div class="sign"><div style="font-weight:bold;border-bottom:1px solid #D3D1C7;padding-bottom:6px;margin-bottom:12px">Potwierdzenie wykonania — podpisy</div>
<div class="sign-grid"><div><div class="sn">OPERATOR / DOZUJĄCY</div><div class="sl"></div><div class="sn">Imię, nazwisko, podpis · data</div></div><div><div class="sn">BRYGADZISTA (WERYFIKACJA)</div><div class="sl"></div><div class="sn">Imię, nazwisko, podpis · data</div></div><div><div class="sn">TECHNOLOG</div><div class="sl"></div><div class="sn">Imię, nazwisko, podpis · data</div></div></div></div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win = window.open('','_blank'); win.document.write(html); win.document.close()
  }

  const pf = (k,v) => setPlanForm(p => ({ ...p, [k]:v }))
  const rf = (k,v) => setRunForm(p => ({ ...p, [k]:v }))
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL')

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Planowanie zleceń</div><div className="page-sub">Kolejka produkcji — od zamówienia do uruchomienia partii (FIFO)</div></div>
        <button className="btn btn-sm" onClick={loadAll}>↻</button>
      </div>
      {error && <div className="err-box" style={{ marginBottom:12 }}>{error}</div>}

      <div style={{ fontSize:13, fontWeight:600, color:'#BA7517', margin:'4px 0 8px' }}>Do zaplanowania ({nowe.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', marginBottom:18 }}>
        <table style={{ minWidth:820 }}>
          <thead><tr><th>Nr zlecenia</th><th>Klient</th><th>Wyrób</th><th style={{textAlign:'right'}}>Ilość szt.</th><th style={{textAlign:'right'}}>Waga</th><th>Wysyłka</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && nowe.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'#888'}}>Brak nowych zleceń</td></tr>}
            {!loading && nowe.map(o => (
              <tr key={o.id}>
                <td><span className="lot">{o.order_number||'—'}</span></td>
                <td style={{fontSize:12}}>{klient(o)}</td>
                <td style={{fontWeight:500,fontSize:12}}>{wyrob(o)}</td>
                <td style={{textAlign:'right'}}>{fmt(o.qty_units)}</td>
                <td style={{textAlign:'right',fontWeight:600}}>{fmt(massOf(o))} kg</td>
                <td className="muted" style={{fontSize:11}}>{o.ship_date||'—'}</td>
                <td>{canEdit && <button className="btn btn-sm btn-primary" onClick={() => openPlan(o)}>Zaplanuj</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#0F6E56', margin:'4px 0 8px' }}>Kolejka produkcji ({kolejka.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead><tr><th style={{textAlign:'center'}}>#</th><th>Nr zlecenia</th><th>Klient</th><th>Wyrób</th><th style={{textAlign:'right'}}>Ilość szt.</th><th style={{textAlign:'right'}}>Waga</th><th>Data prod.</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && kolejka.length===0 && <tr><td colSpan={8} style={{textAlign:'center',padding:24,color:'#888'}}>Kolejka pusta</td></tr>}
            {!loading && kolejka.map(o => (
              <tr key={o.id}>
                <td style={{textAlign:'center',fontWeight:700,color:'#5F5E5A'}}>{o.production_priority||'—'}</td>
                <td><span className="lot">{o.order_number||'—'}</span></td>
                <td style={{fontSize:12}}>{klient(o)}</td>
                <td style={{fontWeight:500,fontSize:12}}>{wyrob(o)}</td>
                <td style={{textAlign:'right'}}>{fmt(o.qty_units)}</td>
                <td style={{textAlign:'right',fontWeight:600}}>{fmt(massOf(o))} kg</td>
                <td className="muted" style={{fontSize:11}}>{o.planned_date||'—'}</td>
                <td><div className="flex" style={{gap:4}}>
                  {canEdit && <button className="btn btn-sm btn-primary" onClick={() => openRun(o)}>Uruchom produkcję</button>}
                  {canEdit && <button className="btn btn-sm" onClick={() => openPlan(o)}>Edytuj</button>}
                  {canEdit && <button className="btn btn-sm" onClick={() => unplan(o)}>Cofnij</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal planowania */}
      <div className={`modal-overlay ${planModal?'open':''}`} onClick={e => e.target===e.currentTarget && setPlanModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Zaplanuj zlecenie {planOrder?.order_number||''}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data produkcji</label><input type="date" value={planForm.planned_date} onChange={e => pf('planned_date',e.target.value)} /></div>
            <div><label>Kolejność / priorytet</label><input type="number" min="1" step="1" value={planForm.production_priority} onChange={e => pf('production_priority',e.target.value)} /></div>
          </div>
          <div><label>Uwagi do produkcji</label><input value={planForm.planning_notes} onChange={e => pf('planning_notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setPlanModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={savePlan} disabled={saving}>{saving?'Zapisywanie...':'Zaplanuj'}</button>
          </div>
        </div>
      </div>

      {/* Modal uruchomienia produkcji */}
      <div className={`modal-overlay ${runModal?'open':''}`} onClick={e => e.target===e.currentTarget && setRunModal(false)}>
        <div className="modal" style={{ maxWidth:720 }}>
          <div className="modal-title">Uruchom produkcję — {runOrder?.order_number||''}</div>
          {runRecipe && <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:10, fontSize:13 }}>
            <b>{runOrder?.clients?.name}</b> · {wyrob(runOrder||{})} · receptura {runRecipe.code} (v{runRecipe.version}) · masa wsadu <b>{runMass} kg</b>
          </div>}
          {error && <div className="err-box">{error}</div>}
          {hasShortage && <div className="warn-box">Uwaga: brak części surowców w magazynie. Możesz mimo to uruchomić produkcję (ERP) — brakujące pozycje oznaczone na czerwono.</div>}

          <div style={{ maxHeight:280, overflowY:'auto', border:'0.5px solid #E3E1D8', borderRadius:6, marginBottom:10 }}>
            <table style={{ minWidth:560 }}>
              <thead style={{ position:'sticky', top:0, background:'#fff' }}><tr><th>Składnik</th><th style={{textAlign:'right'}}>Potrzeba</th><th>Partie FIFO</th></tr></thead>
              <tbody>
                {fifo.map((r,i) => (
                  <tr key={i}>
                    <td style={{fontSize:12}}>{r.ingredient?.code} — {r.ingredient?.name}{r.ingredient?.has_allergen && <span className="badge b-err" style={{fontSize:9,marginLeft:4}}>{r.ingredient.allergen_type}</span>}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{r.needed.toFixed(3)} kg</td>
                    <td style={{fontSize:11,fontFamily:'monospace'}}>
                      {r.lots.length ? r.lots.map((l,li) => <div key={li}>{l.lot} · {l.kg} kg</div>) : <span style={{color:'#A32D2D'}}>BRAK {r.shortage.toFixed(3)} kg</span>}
                      {r.lots.length>0 && r.shortage>0 && <div style={{color:'#A32D2D'}}>brakuje {r.shortage.toFixed(3)} kg</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fr">
            <div><label>Operator</label><input value={runForm.operator} onChange={e => rf('operator',e.target.value)} /></div>
            <div><label>Brygadzista</label><input value={runForm.foreman} onChange={e => rf('foreman',e.target.value)} /></div>
          </div>
          <div><label>Uwagi</label><input value={runForm.notes} onChange={e => rf('notes',e.target.value)} placeholder="opcjonalne" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setRunModal(false)}>Anuluj</button>
            <button className="btn" onClick={printSheet}>🖨 Wydruk zlecenia</button>
            <button className="btn btn-primary" onClick={startProduction} disabled={saving}>{saving?'Tworzenie partii...':'Utwórz partię i rozpocznij'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
