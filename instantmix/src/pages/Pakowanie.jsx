import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Pakowanie() {
  const { profile } = useAuth()
  const canEdit = true // dostępy później

  const [orders, setOrders] = useState([])
  const [mats, setMats] = useState({})      // packaging_material_id -> {code,name,unit,type}
  const [pkgStock, setPkgStock] = useState([]) // v_packaging_stock
  const [fg, setFg] = useState([])          // v_finished_goods (luz + spakowane)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modal, setModal] = useState(false)
  const [sel, setSel] = useState(null)
  const [units, setUnits] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    const [{ data: ords, error: oerr }, { data: m }, { data: ps }, { data: v }] = await Promise.all([
      supabase.from('orders')
        .select('*, clients(number,name), production_batches(lot_number), bom(code_ext,gramatura_kg,units_per_pallet,unit_material_id,pallet_material_id,bom_items(packaging_material_id,qty_per,per))')
        .in('status', ['wyprodukowane','w_pakowaniu'])
        .order('planned_date', { ascending:true }),
      supabase.from('packaging_materials').select('id,code,name,unit,type'),
      supabase.from('v_packaging_stock').select('*').order('received_date', { ascending:true }),
      supabase.from('v_finished_goods').select('*').order('received_date', { ascending:true }),
    ])
    if (oerr) setError(oerr.message)
    const mm = {}; (m||[]).forEach(x => { mm[x.id] = x })
    setMats(mm); setPkgStock(ps||[]); setFg(v||[]); setOrders(ords||[])
    setLoading(false)
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL')
  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'

  // luz dostępny dla zlecenia
  const luzFor = o => fg.filter(g => g.order_id === o.id && (g.form==='luz' || !g.form) && parseFloat(g.available_kg) > 0.001)
  const luzKg = o => luzFor(o).reduce((s,g) => s + parseFloat(g.available_kg||0), 0)
  // spakowane dotąd (sztuk) dla zlecenia
  const packedUnits = o => fg.filter(g => g.order_id === o.id && g.form==='spakowane').reduce((s,g) => s + (parseInt(g.unit_count)||0), 0)

  // zapotrzebowanie opakowań dla danej liczby sztuk
  function needs(o, u) {
    const bom = o.bom || {}
    const upp = parseInt(bom.units_per_pallet||0)
    const pallets = upp>0 ? Math.ceil(u/upp) : 0
    const list = []
    if (bom.unit_material_id) list.push({ material_id: bom.unit_material_id, qty: u, label:'worek', per:'szt.' })
    if (bom.pallet_material_id && pallets>0) list.push({ material_id: bom.pallet_material_id, qty: pallets, label:'paleta', per:'paletę' })
    ;(bom.bom_items||[]).forEach(bi => {
      const naPalete = bi.per === 'paleta'
      const q = naPalete ? parseFloat(bi.qty_per||0)*pallets : parseFloat(bi.qty_per||0)*u
      if (q>0) list.push({ material_id: bi.packaging_material_id, qty: parseFloat(q.toFixed(3)), label:'dodatek', per: naPalete?'paletę':'szt.' })
    })
    return { pallets, list }
  }
  const stockOfMat = id => pkgStock.filter(b => b.packaging_material_id===id).reduce((s,b)=> s + parseFloat(b.current_qty||0), 0)

  function openPack(o) {
    const rem = Math.max(0, parseInt(o.qty_units||0) - packedUnits(o))
    setSel(o); setUnits(String(rem)); setLocation(''); setNotes(''); setError(''); setModal(true)
  }

  async function doPack() {
    if (!sel) return
    const u = parseInt(units)
    if (!u || u <= 0) { setError('Podaj liczbę sztuk do spakowania'); return }
    const gramatura = parseFloat(sel.bom?.gramatura_kg || 0)
    if (gramatura <= 0) { setError('BOM nie ma gramatury — uzupełnij BOM.'); return }
    const kg = parseFloat((u * gramatura).toFixed(3))
    const luzAvail = luzKg(sel)
    if (kg > luzAvail + 0.001) { setError(`Za mało luzu. Dostępne: ${luzAvail.toFixed(3)} kg (${Math.floor(luzAvail/gramatura)} szt.), próbujesz ${kg.toFixed(3)} kg.`); return }
    setSaving(true); setError('')

    const { pallets, list } = needs(sel, u)
    const today = new Date().toISOString().slice(0,10)

    // 1) operacja pakowania
    const { data: op, error: opErr } = await supabase.from('packing_operations').insert({
      order_id: sel.id, packing_date: today, packed_by: profile?.id, total_packed_kg: kg, notes: notes || null,
    }).select().single()
    if (opErr) { setError(opErr.message); setSaving(false); return }

    // 2) FIFO zużycie luzu -> packing_consumed
    let rem = kg
    const consumed = []
    for (const g of luzFor(sel)) {
      if (rem <= 0.001) break
      const take = Math.min(rem, parseFloat(g.available_kg))
      if (take > 0.001) { consumed.push({ packing_operation_id: op.id, source_finished_good_id: g.id, quantity_kg: parseFloat(take.toFixed(3)) }); rem = parseFloat((rem-take).toFixed(3)) }
    }
    if (consumed.length) await supabase.from('packing_consumed').insert(consumed)

    // 3) wyrób spakowany
    await supabase.from('finished_goods').insert({
      production_batch_id: sel.production_batch_id,
      order_id: sel.id,
      received_date: today,
      quantity_kg: kg,
      location: location || null,
      notes: notes || null,
      form: 'spakowane',
      unit_type: 'worek',
      unit_weight_kg: gramatura,
      unit_count: u,
      pallets: pallets || null,
      bags_per_pallet: parseInt(sel.bom?.units_per_pallet||0) || null,
      packing_operation_id: op.id,
      created_by: profile?.id,
    })

    // 4) zużycie opakowań (FIFO po partiach), brak -> ostrzeżenie, pozwól
    const shortages = []
    for (const need of list) {
      let r = need.qty
      const batches = pkgStock.filter(b => b.packaging_material_id===need.material_id && parseFloat(b.current_qty)>0.001)
      const rows = []
      for (const b of batches) {
        if (r <= 0.001) break
        const take = Math.min(r, parseFloat(b.current_qty))
        if (take > 0.001) { rows.push({ packing_operation_id: op.id, packaging_batch_id: b.id, quantity: parseFloat(take.toFixed(3)) }); r = parseFloat((r-take).toFixed(3)) }
      }
      if (rows.length) await supabase.from('packaging_consumed').insert(rows)
      if (r > 0.001) shortages.push(`${mats[need.material_id]?.code||'?'} (brak ${r.toFixed(3)} ${mats[need.material_id]?.unit||''})`)
    }

    // 5) status zlecenia
    const packedAfter = packedUnits(sel) + u
    const newStatus = packedAfter + 0.0001 >= parseInt(sel.qty_units||0) ? 'spakowane' : 'w_pakowaniu'
    await supabase.from('orders').update({ status: newStatus, updated_at:new Date().toISOString() }).eq('id', sel.id)

    setSaving(false); setModal(false)
    if (shortages.length) alert('Spakowano. Uwaga — brak w magazynie opakowań: ' + shortages.join(', ') + '. Zużycie zapisano do stanu dostępnego; uzupełnij braki.')
    load()
  }

  const preview = (sel && units) ? needs(sel, parseInt(units)||0) : null
  const gramatura = parseFloat(sel?.bom?.gramatura_kg || 0)

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Pakowanie</div><div className="page-sub">Pakowanie wyrobu wg BOM — zużycie luzu i opakowań</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>
      {error && !modal && <div className="err-box" style={{marginBottom:12}}>{error}</div>}

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:960 }}>
          <thead><tr>
            <th>Nr zlecenia</th><th>Klient</th><th>Wyrób</th><th>Nr partii</th>
            <th style={{textAlign:'right'}}>Cel (szt.)</th><th style={{textAlign:'right'}}>Spakowano</th><th style={{textAlign:'right'}}>Luz dostępny</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && orders.length===0 && <tr><td colSpan={9} style={{textAlign:'center',padding:24,color:'#888'}}>Brak zleceń do pakowania</td></tr>}
            {!loading && orders.map(o => {
              const pu = packedUnits(o), target = parseInt(o.qty_units||0), g = parseFloat(o.bom?.gramatura_kg||0)
              const luz = luzKg(o)
              return (
                <tr key={o.id}>
                  <td><span className="lot">{o.order_number||'—'}</span></td>
                  <td style={{fontSize:12}}>{klient(o)}</td>
                  <td style={{fontWeight:500,fontSize:12}}>{o.bom?.code_ext||'—'}</td>
                  <td><span className="lot" style={{fontSize:11}}>{o.production_batches?.lot_number||'—'}</span></td>
                  <td style={{textAlign:'right'}}>{fmt(target)}</td>
                  <td style={{textAlign:'right',color:'#085041'}}>{fmt(pu)}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>{fmt(luz)} kg{g>0 && <span className="muted" style={{fontSize:10}}> (~{Math.floor(luz/g)} szt.)</span>}</td>
                  <td><span className={`badge ${o.status==='spakowane'?'b-ok':'b-warn'}`} style={{fontSize:10}}>{o.status==='spakowane'?'Spakowane':o.status==='w_pakowaniu'?'W pakowaniu':'Wyprodukowane'}</span></td>
                  <td>{canEdit && pu < target && (luz > 0.001
                    ? <button className="btn btn-sm btn-primary" onClick={() => openPack(o)}>Pakuj</button>
                    : <span className="muted" style={{fontSize:11}}>Brak luzu w WG — oznacz w Produkcji</span>)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal pakowania */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:640 }}>
          <div className="modal-title">Pakowanie — {sel?.order_number||''}</div>
          {sel && <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:10, fontSize:13 }}>
            <b>{klient(sel)}</b> · {sel.bom?.code_ext} · gramatura {gramatura} kg/szt · {sel.bom?.units_per_pallet||'—'} szt./paletę<br/>
            Cel: <b>{fmt(sel.qty_units)}</b> szt. · spakowano: <b>{fmt(packedUnits(sel))}</b> · luz: <b>{fmt(luzKg(sel))}</b> kg
          </div>}
          {error && <div className="err-box">{error}</div>}

          <div className="fr">
            <div><label>Sztuk do spakowania teraz</label><input type="number" min="1" step="1" value={units} onChange={e => setUnits(e.target.value)} /></div>
            <div><label>Masa</label><input value={units ? `${(parseInt(units)*gramatura).toFixed(3)} kg` : '—'} disabled /></div>
            <div><label>Lokalizacja</label><input value={location} onChange={e => setLocation(e.target.value)} placeholder="np. Regał WG-2" /></div>
          </div>

          {preview && <div style={{ marginTop:4 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#0F6E56', margin:'6px 0' }}>Zużycie opakowań (palet: {preview.pallets})</div>
            <table style={{ width:'100%' }}>
              <thead><tr><th>Materiał</th><th style={{textAlign:'right'}}>Potrzeba</th><th style={{textAlign:'right'}}>Stan</th><th></th></tr></thead>
              <tbody>
                {preview.list.map((n,i) => {
                  const st = stockOfMat(n.material_id); const short = n.qty > st + 0.001
                  return (
                    <tr key={i}>
                      <td style={{fontSize:12}}>{mats[n.material_id]?.code} — {mats[n.material_id]?.name} <span className="muted" style={{fontSize:10}}>({n.label})</span></td>
                      <td style={{textAlign:'right',fontWeight:600}}>{fmt(n.qty)} {mats[n.material_id]?.unit||''}</td>
                      <td style={{textAlign:'right', color: short?'#A32D2D':'#5F5E5A'}}>{fmt(st)}</td>
                      <td>{short ? <span className="badge b-err" style={{fontSize:9}}>brak</span> : <span className="badge b-ok" style={{fontSize:9}}>ok</span>}</td>
                    </tr>
                  )
                })}
                {preview.list.length===0 && <tr><td colSpan={4} className="muted" style={{fontSize:12}}>BOM nie ma zdefiniowanych opakowań.</td></tr>}
              </tbody>
            </table>
          </div>}

          <div style={{ marginTop:8 }}><label>Uwagi</label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="opcjonalne" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={doPack} disabled={saving}>{saving?'Pakowanie...':'Spakuj'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
