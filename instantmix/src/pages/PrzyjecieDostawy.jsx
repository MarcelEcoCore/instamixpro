import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_RCV = { delivery_lot:'', qty:'', received_date:new Date().toISOString().slice(0,10), expiry_date:'', production_date:'', unit_price:'', warehouse_location:'', spec_number:'', spec_approved_at:'', invoice_number:'', notes:'' }

export default function PrzyjecieDostawy() {
  const { profile } = useAuth()
  const canEdit = true // dostępy później

  const [items, setItems] = useState([])        // pozycje zamówień (z PO + dostawca)
  const [recvMap, setRecvMap] = useState({})     // poi_id -> przyjęto
  const [supIng, setSupIng] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(false)
  const [line, setLine] = useState(null)         // przyjmowana pozycja
  const [form, setForm] = useState(EMPTY_RCV)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: its }, { data: ib }, { data: pb }, { data: si }, { data: ibh }, { data: pbh }] = await Promise.all([
      supabase.from('purchase_order_items').select('*, ingredients(code,name), packaging_materials(code,name,unit), purchase_orders(po_number,status,expected_date,supplier_id,suppliers(name))'),
      supabase.from('ingredient_batches').select('purchase_order_item_id,quantity_kg'),
      supabase.from('packaging_batches').select('purchase_order_item_id,quantity'),
      supabase.from('supplier_ingredients').select('supplier_id,ingredient_id,spec_number,spec_approved_at'),
      supabase.from('ingredient_batches').select('id,delivery_lot,received_date,quantity_kg,purchase_order_item_id,ingredients(code,name)').not('purchase_order_item_id','is',null).order('received_date',{ascending:false}).limit(25),
      supabase.from('packaging_batches').select('id,delivery_lot,received_date,quantity,purchase_order_item_id,packaging_materials(code,name)').not('purchase_order_item_id','is',null).order('received_date',{ascending:false}).limit(25),
    ])
    const rm = {}
    ;(ib||[]).forEach(x => { if (x.purchase_order_item_id) rm[x.purchase_order_item_id]=(rm[x.purchase_order_item_id]||0)+parseFloat(x.quantity_kg||0) })
    ;(pb||[]).forEach(x => { if (x.purchase_order_item_id) rm[x.purchase_order_item_id]=(rm[x.purchase_order_item_id]||0)+parseFloat(x.quantity||0) })
    setRecvMap(rm)
    setItems(its || [])
    setSupIng(si || [])
    const hist = [
      ...(ibh||[]).map(x => ({ id:'i'+x.id, type:'surowiec', lot:x.delivery_lot, date:x.received_date, qty:x.quantity_kg, name:x.ingredients?`${x.ingredients.code} — ${x.ingredients.name}`:'—' })),
      ...(pbh||[]).map(x => ({ id:'p'+x.id, type:'opakowanie', lot:x.delivery_lot, date:x.received_date, qty:x.quantity, name:x.packaging_materials?`${x.packaging_materials.code} — ${x.packaging_materials.name}`:'—' })),
    ].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0,25)
    setHistory(hist)
    setLoading(false)
  }

  const rf = (k,v) => setForm(p => ({ ...p, [k]: v }))

  // pozycje do przyjęcia: PO aktywne + pozostało > 0
  const toReceive = items.filter(it => {
    const po = it.purchase_orders
    if (!po || ['anulowane','zamkniete'].includes(po.status)) return false
    if (it.status === 'zamkniete') return false
    const rec = recvMap[it.id] || 0
    const ord = parseFloat(it.qty_ordered||0)
    return (ord - rec) > 0.0001
  }).filter(it => {
    const q = search.toLowerCase()
    if (!q) return true
    const name = it.item_type==='surowiec' ? (it.ingredients?`${it.ingredients.code} ${it.ingredients.name}`:'') : (it.packaging_materials?`${it.packaging_materials.code} ${it.packaging_materials.name}`:'')
    return (it.purchase_orders?.po_number||'').toLowerCase().includes(q) || name.toLowerCase().includes(q) || (it.purchase_orders?.suppliers?.name||'').toLowerCase().includes(q)
  })

  const itemLabel = it => it.item_type==='surowiec'
    ? (it.ingredients ? `${it.ingredients.code} — ${it.ingredients.name}` : '—')
    : (it.packaging_materials ? `${it.packaging_materials.code} — ${it.packaging_materials.name}` : '—')

  function openReceive(it) {
    const rec = recvMap[it.id] || 0
    const remaining = Math.max(0, parseFloat(it.qty_ordered||0) - rec)
    let spec = {}
    if (it.item_type==='surowiec') {
      const s = supIng.find(x => x.supplier_id === it.purchase_orders?.supplier_id && x.ingredient_id === it.ingredient_id)
      if (s) spec = { spec_number:s.spec_number||'', spec_approved_at:s.spec_approved_at||'' }
    }
    setLine(it)
    setForm({ ...EMPTY_RCV, qty:String(remaining), unit_price: it.unit_price??'', ...spec })
    setError(''); setModal(true)
  }

  async function doReceive() {
    if (!line) return
    const qty = parseFloat(form.qty)
    if (!qty || qty <= 0) { setError('Podaj przyjętą ilość'); return }
    if (!form.delivery_lot.trim()) { setError('Podaj nr partii / atestu'); return }
    setSaving(true); setError('')
    const po = line.purchase_orders

    if (line.item_type === 'surowiec') {
      const { error: err } = await supabase.from('ingredient_batches').insert({
        ingredient_id: line.ingredient_id,
        supplier_name: po?.suppliers?.name || null,
        spec_number: form.spec_number || null,
        spec_approved_at: form.spec_approved_at || null,
        delivery_lot: form.delivery_lot.trim(),
        production_date: form.production_date || null,
        expiry_date: form.expiry_date || null,
        received_date: form.received_date,
        quantity_kg: qty,
        invoice_number: form.invoice_number || null,
        unit_price_pln: form.unit_price==='' ? null : parseFloat(form.unit_price),
        warehouse_location: form.warehouse_location || null,
        status: 'dopuszczona',
        purchase_order_item_id: line.id,
        created_by: profile?.id,
      })
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('packaging_batches').insert({
        packaging_material_id: line.packaging_material_id,
        supplier_id: po?.supplier_id || null,
        delivery_lot: form.delivery_lot.trim(),
        quantity: qty,
        unit_price: form.unit_price==='' ? null : parseFloat(form.unit_price),
        received_date: form.received_date,
        expiry_date: form.expiry_date || null,
        warehouse_location: form.warehouse_location || null,
        status: 'dostepna',
        purchase_order_item_id: line.id,
        created_by: profile?.id,
      })
      if (err) { setError(err.message); setSaving(false); return }
    }

    // aktualizacja statusów pozycji i zamówienia
    const newRec = (recvMap[line.id]||0) + qty
    const ordered = parseFloat(line.qty_ordered||0)
    const lineSt = newRec + 0.0001 >= ordered ? 'zrealizowane' : 'czesciowo'
    await supabase.from('purchase_order_items').update({ status: lineSt }).eq('id', line.id)
    const siblings = items.filter(x => x.po_id === line.po_id)
    const allDone = siblings.every(s => {
      const r = s.id === line.id ? newRec : (recvMap[s.id]||0)
      return (r + 0.0001 >= parseFloat(s.qty_ordered||0)) || s.status === 'zamkniete'
    })
    if (!['anulowane','zamkniete'].includes(po?.status)) {
      await supabase.from('purchase_orders').update({ status: allDone ? 'zrealizowane' : 'czesciowo', updated_at:new Date().toISOString() }).eq('id', line.po_id)
    }
    setSaving(false); setModal(false); load()
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL')

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Przyjęcie dostawy</div><div className="page-sub">Kontrola jakości — przyjęcia z zamówień zakupu (surowce i opakowania)</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj: nr ZZ, dostawca, pozycja..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:260 }} />
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#0F6E56', margin:'4px 0 8px' }}>Do przyjęcia ({toReceive.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', marginBottom:16 }}>
        <table style={{ minWidth:900 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th>Nr ZZ</th><th>Dostawca</th><th>Typ</th><th>Pozycja</th>
            <th style={{ textAlign:'right' }}>Zamówiono</th><th style={{ textAlign:'right' }}>Przyjęto</th><th style={{ textAlign:'right' }}>Pozostało</th>
            <th>Termin</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && toReceive.length===0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak pozycji do przyjęcia</td></tr>}
            {!loading && toReceive.map(it => {
              const rec = recvMap[it.id]||0, ord = parseFloat(it.qty_ordered||0), rem = Math.max(0, ord-rec)
              return (
                <tr key={it.id}>
                  <td><span className="lot">{it.purchase_orders?.po_number||'—'}</span></td>
                  <td style={{ fontSize:12 }}>{it.purchase_orders?.suppliers?.name||'—'}</td>
                  <td><span className="badge b-info" style={{ fontSize:10 }}>{it.item_type}</span></td>
                  <td style={{ fontWeight:500, fontSize:12 }}>{itemLabel(it)}</td>
                  <td style={{ textAlign:'right' }}>{fmt(ord)} {it.unit||''}</td>
                  <td style={{ textAlign:'right', color:'#085041' }}>{fmt(rec)}</td>
                  <td style={{ textAlign:'right', fontWeight:600, color:'#BA7517' }}>{fmt(rem)} {it.unit||''}</td>
                  <td className="muted" style={{ fontSize:11 }}>{it.purchase_orders?.expected_date||'—'}</td>
                  <td>{canEdit && <button className="btn btn-sm btn-primary" onClick={() => openReceive(it)}>Przyjmij</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#5F5E5A', margin:'4px 0 8px' }}>Historia przyjęć</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:600 }}>
          <thead><tr><th>Data</th><th>Typ</th><th>Pozycja</th><th>Nr partii</th><th style={{ textAlign:'right' }}>Ilość</th></tr></thead>
          <tbody>
            {history.length===0 && <tr><td colSpan={5} style={{ textAlign:'center', padding:20, color:'#888' }}>Brak przyjęć</td></tr>}
            {history.map(h => (
              <tr key={h.id}>
                <td className="muted" style={{ fontSize:12 }}>{h.date}</td>
                <td><span className="badge b-info" style={{ fontSize:10 }}>{h.type}</span></td>
                <td style={{ fontSize:12 }}>{h.name}</td>
                <td><span className="lot" style={{ fontSize:11 }}>{h.lot||'—'}</span></td>
                <td style={{ textAlign:'right', fontWeight:500 }}>{fmt(h.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal przyjęcia */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:560 }}>
          <div className="modal-title">Przyjęcie — {line ? itemLabel(line) : ''}</div>
          {line && <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
            <b>{line.purchase_orders?.po_number}</b> · {line.purchase_orders?.suppliers?.name}<br/>
            Zamówiono: {fmt(line.qty_ordered)} {line.unit||''} · pozostało: <b>{fmt(Math.max(0,parseFloat(line.qty_ordered||0)-(recvMap[line.id]||0)))}</b> {line.unit||''}
            <div className="muted" style={{ fontSize:11, marginTop:4 }}>Trafi na: <b>{line.item_type==='surowiec'?'Magazyn surowców':'Magazyn opakowań'}</b></div>
          </div>}
          {error && <div className="err-box">{error}</div>}

          <div className="fr">
            <div><label>Nr partii / atestu *</label><input value={form.delivery_lot} onChange={e => rf('delivery_lot',e.target.value)} placeholder="np. AT-2026-..." /></div>
            <div><label>Przyjęta ilość *</label><input type="number" step="0.001" value={form.qty} onChange={e => rf('qty',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Data przyjęcia</label><input type="date" value={form.received_date} onChange={e => rf('received_date',e.target.value)} /></div>
            {line?.item_type==='surowiec' && <div><label>Data przydatności</label><input type="date" value={form.expiry_date} onChange={e => rf('expiry_date',e.target.value)} /></div>}
            {line?.item_type==='opakowanie' && <div><label>Data przydatności (opc.)</label><input type="date" value={form.expiry_date} onChange={e => rf('expiry_date',e.target.value)} /></div>}
          </div>
          <div className="fr">
            <div><label>Cena jedn. (zł)</label><input type="number" step="0.01" value={form.unit_price} onChange={e => rf('unit_price',e.target.value)} /></div>
            <div><label>Lokalizacja</label><input value={form.warehouse_location} onChange={e => rf('warehouse_location',e.target.value)} /></div>
          </div>
          {line?.item_type==='surowiec' && (
            <div className="fr">
              <div><label>Nr specyfikacji</label><input value={form.spec_number} onChange={e => rf('spec_number',e.target.value)} /></div>
              <div><label>Data zatw. spec.</label><input type="date" value={form.spec_approved_at} onChange={e => rf('spec_approved_at',e.target.value)} /></div>
              <div><label>Nr faktury</label><input value={form.invoice_number} onChange={e => rf('invoice_number',e.target.value)} /></div>
            </div>
          )}
          <div><label>Uwagi</label><input value={form.notes} onChange={e => rf('notes',e.target.value)} placeholder="opcjonalne" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={doReceive} disabled={saving}>{saving?'Przyjmowanie...':'Przyjmij na magazyn'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
