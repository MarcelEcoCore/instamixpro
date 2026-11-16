import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const today = () => new Date().toISOString().slice(0,10)
const EMPTY_RCV = { delivery_lot:'', qty:'', received_date:today(), expiry_date:'', production_date:'', unit_price:'', warehouse_location:'', spec_number:'', spec_approved_at:'', invoice_number:'', notes:'' }
const EMPTY_MAN = { type:'surowiec', ingredient_id:'', packaging_material_id:'', supplier_name:'', supplier_id:'', delivery_lot:'', production_date:'', expiry_date:'', received_date:today(), quantity:'', unit_price:'', invoice_number:'', warehouse_location:'', status:'dopuszczona' }
const num = v => { const n = parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?null:n }

export default function PrzyjecieDostawy() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = true // dostępy później

  const [items, setItems] = useState([])        // pozycje zamówień (z PO + dostawca)
  const [recvMap, setRecvMap] = useState({})     // poi_id -> przyjęto
  const [supIng, setSupIng] = useState([])       // przypisania składników (spec, is_current)
  const [suppliers, setSuppliers] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [packaging, setPackaging] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [histSearch, setHistSearch] = useState('')

  // Przyjęcie z ZZ
  const [modal, setModal] = useState(false)
  const [line, setLine] = useState(null)
  const [form, setForm] = useState(EMPTY_RCV)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Ręczne przyjęcie (poza ZZ)
  const [manModal, setManModal] = useState(false)
  const [manForm, setManForm] = useState(EMPTY_MAN)
  const [manSaving, setManSaving] = useState(false)
  const [manError, setManError] = useState('')

  // Edycja dostawy
  const [editModal, setEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Usuwanie
  const [delRow, setDelRow] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: its }, { data: ib }, { data: pb }, { data: si }, { data: sup }, { data: ing }, { data: pm }, { data: ibh }, { data: pbh }] = await Promise.all([
      supabase.from('purchase_order_items').select('*, ingredients(code,name), packaging_materials(code,name,unit), purchase_orders(po_number,status,expected_date,supplier_id,suppliers(name))'),
      supabase.from('ingredient_batches').select('purchase_order_item_id,quantity_kg'),
      supabase.from('packaging_batches').select('purchase_order_item_id,quantity'),
      supabase.from('supplier_ingredients').select('supplier_id,ingredient_id,spec_number,spec_approved_at,is_current'),
      supabase.from('suppliers').select('id,name,kind').order('name'),
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('packaging_materials').select('id,code,name,unit').eq('active',true).order('code'),
      supabase.from('ingredient_batches').select('*, ingredients(code,name)').order('received_date',{ascending:false}).limit(150),
      supabase.from('packaging_batches').select('*, packaging_materials(code,name,unit), suppliers(name)').order('received_date',{ascending:false}).limit(150),
    ])
    const rm = {}
    ;(ib||[]).forEach(x => { if (x.purchase_order_item_id) rm[x.purchase_order_item_id]=(rm[x.purchase_order_item_id]||0)+parseFloat(x.quantity_kg||0) })
    ;(pb||[]).forEach(x => { if (x.purchase_order_item_id) rm[x.purchase_order_item_id]=(rm[x.purchase_order_item_id]||0)+parseFloat(x.quantity||0) })
    setRecvMap(rm)
    setItems(its || [])
    setSupIng(si || [])
    setSuppliers(sup || [])
    setIngredients(ing || [])
    setPackaging(pm || [])

    // mapa poi_id -> nr ZZ
    const poMap = {}; (its||[]).forEach(it => { if (it.purchase_orders?.po_number) poMap[it.id] = it.purchase_orders.po_number })

    const hist = [
      ...(ibh||[]).map(x => ({
        id:'i'+x.id, raw:x, type:'surowiec', table:'ingredient_batches',
        name:x.ingredients?`${x.ingredients.code} — ${x.ingredients.name}`:'—',
        lot:x.delivery_lot, date:x.received_date, qty:x.quantity_kg, unit:'kg',
        supplier:x.supplier_name||'—', invoice:x.invoice_number||'—',
        zz: x.purchase_order_item_id ? (poMap[x.purchase_order_item_id]||'—') : '— (ręczne)',
        status:x.status,
      })),
      ...(pbh||[]).map(x => ({
        id:'p'+x.id, raw:x, type:'opakowanie', table:'packaging_batches',
        name:x.packaging_materials?`${x.packaging_materials.code} — ${x.packaging_materials.name}`:'—',
        lot:x.delivery_lot, date:x.received_date, qty:x.quantity, unit:x.packaging_materials?.unit||'szt',
        supplier:x.suppliers?.name||'—', invoice:'—',
        zz: x.purchase_order_item_id ? (poMap[x.purchase_order_item_id]||'—') : '— (ręczne)',
        status:x.status,
      })),
    ].sort((a,b) => (b.date||'').localeCompare(a.date||''))
    setHistory(hist)
    setLoading(false)
  }

  const rf = (k,v) => setForm(p => ({ ...p, [k]: v }))
  const mf = (k,v) => setManForm(p => ({ ...p, [k]: v }))
  const ef = (k,v) => setEditForm(p => ({ ...p, [k]: v }))

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

  // Specyfikacja przypisana do surowca (automatyczna — nie edytowalna przy przyjęciu)
  function specForIngredient(ingredientId, supplierId) {
    let s = supplierId ? supIng.find(x => x.supplier_id === supplierId && x.ingredient_id === ingredientId) : null
    if (!s) s = supIng.find(x => x.ingredient_id === ingredientId && x.is_current)
    if (!s) s = supIng.find(x => x.ingredient_id === ingredientId)
    return s ? { spec_number:s.spec_number||'', spec_approved_at:s.spec_approved_at||'' } : { spec_number:'', spec_approved_at:'' }
  }

  // ── Przyjęcie z ZZ ──
  function openReceive(it) {
    const rec = recvMap[it.id] || 0
    const remaining = Math.max(0, parseFloat(it.qty_ordered||0) - rec)
    const spec = it.item_type==='surowiec' ? specForIngredient(it.ingredient_id, it.purchase_orders?.supplier_id) : { spec_number:'', spec_approved_at:'' }
    setLine(it)
    setForm({ ...EMPTY_RCV, qty:String(remaining), unit_price: it.unit_price??'', ...spec })
    setError(''); setModal(true)
  }

  async function doReceive() {
    if (!line) return
    const qty = num(form.qty)
    if (!qty || qty <= 0) { setError('Podaj przyjętą ilość'); return }
    if (!form.delivery_lot.trim()) { setError('Podaj nr partii / atestu'); return }
    setSaving(true); setError('')
    const po = line.purchase_orders

    if (line.item_type === 'surowiec') {
      const { error: err } = await supabase.from('ingredient_batches').insert({
        ingredient_id: line.ingredient_id,
        supplier_name: po?.suppliers?.name || null,
        spec_number: form.spec_number || null,            // automatyczna — przypisana do surowca
        spec_approved_at: form.spec_approved_at || null,
        delivery_lot: form.delivery_lot.trim(),
        production_date: form.production_date || null,
        expiry_date: form.expiry_date || null,
        received_date: form.received_date,
        quantity_kg: qty,
        invoice_number: form.invoice_number || null,
        unit_price_pln: num(form.unit_price),
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
        unit_price: num(form.unit_price),
        received_date: form.received_date,
        expiry_date: form.expiry_date || null,
        warehouse_location: form.warehouse_location || null,
        status: 'dostepna',
        purchase_order_item_id: line.id,
        created_by: profile?.id,
      })
      if (err) { setError(err.message); setSaving(false); return }
    }

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

  // ── Ręczne przyjęcie (poza ZZ) ──
  function openManual() { setManForm(EMPTY_MAN); setManError(''); setManModal(true) }

  async function doManual() {
    const f = manForm
    const qty = num(f.quantity)
    if (!qty || qty <= 0) { setManError('Podaj ilość'); return }
    if (!f.delivery_lot.trim()) { setManError('Podaj nr partii / atestu'); return }
    setManSaving(true); setManError('')
    if (f.type === 'surowiec') {
      if (!f.ingredient_id) { setManError('Wybierz składnik'); setManSaving(false); return }
      const spec = specForIngredient(f.ingredient_id, null)
      const price = num(f.unit_price)
      const { error: err } = await supabase.from('ingredient_batches').insert({
        ingredient_id: f.ingredient_id,
        supplier_name: f.supplier_name || null,
        spec_number: spec.spec_number || null,
        spec_approved_at: spec.spec_approved_at || null,
        delivery_lot: f.delivery_lot.trim(),
        production_date: f.production_date || null,
        expiry_date: f.expiry_date || null,
        received_date: f.received_date,
        quantity_kg: qty,
        invoice_number: f.invoice_number || null,
        unit_price_pln: price,
        total_value_pln: price!=null ? parseFloat((price*qty).toFixed(2)) : null,
        warehouse_location: f.warehouse_location || null,
        status: f.status || 'dopuszczona',
        created_by: profile?.id,
      })
      if (err) { setManError(err.message); setManSaving(false); return }
    } else {
      if (!f.packaging_material_id) { setManError('Wybierz materiał opakowaniowy'); setManSaving(false); return }
      const { error: err } = await supabase.from('packaging_batches').insert({
        packaging_material_id: f.packaging_material_id,
        supplier_id: f.supplier_id || null,
        delivery_lot: f.delivery_lot.trim(),
        quantity: qty,
        unit_price: num(f.unit_price),
        received_date: f.received_date,
        expiry_date: f.expiry_date || null,
        warehouse_location: f.warehouse_location || null,
        status: 'dostepna',
        created_by: profile?.id,
      })
      if (err) { setManError(err.message); setManSaving(false); return }
    }
    setManSaving(false); setManModal(false); load()
  }

  // ── Edycja dostawy ──
  function openEdit(h) {
    const b = h.raw
    if (h.type === 'surowiec') {
      setEditForm({ type:'surowiec', id:b.id, delivery_lot:b.delivery_lot||'', supplier_name:b.supplier_name||'', invoice_number:b.invoice_number||'', production_date:b.production_date||'', expiry_date:b.expiry_date||'', received_date:b.received_date||'', quantity:b.quantity_kg??'', unit_price:b.unit_price_pln??'', warehouse_location:b.warehouse_location||'', status:b.status||'dopuszczona' })
    } else {
      setEditForm({ type:'opakowanie', id:b.id, delivery_lot:b.delivery_lot||'', supplier_id:b.supplier_id||'', expiry_date:b.expiry_date||'', received_date:b.received_date||'', quantity:b.quantity??'', unit_price:b.unit_price??'', warehouse_location:b.warehouse_location||'', status:b.status||'dostepna' })
    }
    setEditError(''); setEditModal(true)
  }

  async function doEdit() {
    const e = editForm
    const qty = num(e.quantity)
    if (!e.delivery_lot) { setEditError('Nr partii jest wymagany'); return }
    if (!qty || qty <= 0) { setEditError('Podaj ilość'); return }
    setEditSaving(true); setEditError('')
    if (e.type === 'surowiec') {
      const price = num(e.unit_price)
      const { error: err } = await supabase.from('ingredient_batches').update({
        delivery_lot:e.delivery_lot, supplier_name:e.supplier_name||null, invoice_number:e.invoice_number||null,
        production_date:e.production_date||null, expiry_date:e.expiry_date||null, received_date:e.received_date||null,
        quantity_kg:qty, unit_price_pln:price, total_value_pln: price!=null ? parseFloat((price*qty).toFixed(2)) : null,
        warehouse_location:e.warehouse_location||null, status:e.status, updated_at:new Date().toISOString(),
      }).eq('id', e.id)
      if (err) { setEditError(err.message); setEditSaving(false); return }
    } else {
      const { error: err } = await supabase.from('packaging_batches').update({
        delivery_lot:e.delivery_lot, supplier_id:e.supplier_id||null,
        expiry_date:e.expiry_date||null, received_date:e.received_date||null,
        quantity:qty, unit_price:num(e.unit_price), warehouse_location:e.warehouse_location||null, status:e.status,
      }).eq('id', e.id)
      if (err) { setEditError(err.message); setEditSaving(false); return }
    }
    setEditSaving(false); setEditModal(false); load()
  }

  // ── Usuwanie ──
  async function doDelete(h) {
    if (h.type === 'surowiec') {
      await supabase.from('stock_corrections').delete().eq('ingredient_batch_id', h.raw.id)
      await supabase.from('production_batch_items').delete().eq('ingredient_batch_id', h.raw.id)
      await supabase.from('ingredient_batches').delete().eq('id', h.raw.id)
    } else {
      // korekty i zużycia opakowań kasują się kaskadowo (FK on delete cascade)
      await supabase.from('packaging_batches').delete().eq('id', h.raw.id)
    }
    setDelRow(null); load()
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})

  const histFiltered = history.filter(h => {
    const q = histSearch.toLowerCase()
    if (!q) return true
    return (h.name||'').toLowerCase().includes(q) || (h.lot||'').toLowerCase().includes(q)
      || (h.supplier||'').toLowerCase().includes(q) || (h.invoice||'').toLowerCase().includes(q)
      || (h.zz||'').toLowerCase().includes(q)
  })

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Przyjęcie dostawy</div><div className="page-sub">Kontrola jakości — przyjęcia z zamówień zakupu oraz ręczne (surowce i opakowania)</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj: nr ZZ, dostawca, pozycja..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:240 }} />
          {canEdit && <button className="btn btn-sm" onClick={openManual}>+ Przyjęcie ręczne (poza ZZ)</button>}
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#0F6E56', margin:'4px 0 8px' }}>Do przyjęcia z zamówień zakupu ({toReceive.length})</div>
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

      <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', margin:'4px 0 8px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#5F5E5A' }}>Historia przyjęć ({histFiltered.length})</div>
        <input className="search" placeholder="Filtruj historię..." value={histSearch} onChange={e => setHistSearch(e.target.value)} style={{ width:220 }} />
      </div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:980 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th>Data</th><th>Nr ZZ</th><th>Dostawca</th><th>Typ</th><th>Pozycja</th>
            <th>Nr partii</th><th>Nr faktury</th><th style={{ textAlign:'right' }}>Ilość</th><th>Status</th>
            {isAdmin && <th style={{ width:90 }}>Opcje</th>}
          </tr></thead>
          <tbody>
            {!loading && histFiltered.length===0 && <tr><td colSpan={isAdmin?10:9} style={{ textAlign:'center', padding:20, color:'#888' }}>Brak przyjęć</td></tr>}
            {histFiltered.map(h => (
              <tr key={h.id}>
                <td className="muted" style={{ fontSize:12 }}>{h.date}</td>
                <td style={{ fontSize:12 }}>{h.zz==='— (ręczne)' ? <span className="badge b-warn" style={{ fontSize:10 }}>ręczne</span> : <span className="lot" style={{ fontSize:11 }}>{h.zz}</span>}</td>
                <td style={{ fontSize:12 }}>{h.supplier}</td>
                <td><span className="badge b-info" style={{ fontSize:10 }}>{h.type}</span></td>
                <td style={{ fontSize:12 }}>{h.name}</td>
                <td><span className="lot" style={{ fontSize:11 }}>{h.lot||'—'}</span></td>
                <td className="muted" style={{ fontSize:12 }}>{h.invoice}</td>
                <td style={{ textAlign:'right', fontWeight:500 }}>{fmt(h.qty)} {h.unit}</td>
                <td><span className={`badge ${h.status==='dopuszczona'||h.status==='dostepna'?'b-ok':h.status==='wstrzymana'?'b-err':'b-warn'}`} style={{ fontSize:10 }}>{h.status}</span></td>
                {isAdmin && <td>
                  <div className="flex" style={{ gap:4 }}>
                    <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => openEdit(h)}>Edytuj</button>
                    <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => setDelRow(h)}>Usuń</button>
                  </div>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal przyjęcia z ZZ */}
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
            <div><label>Przyjęta ilość *</label><input type="text" inputMode="decimal" value={form.qty} onChange={e => rf('qty',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Data przyjęcia</label><input type="date" value={form.received_date} onChange={e => rf('received_date',e.target.value)} /></div>
            <div><label>Data przydatności{line?.item_type==='opakowanie'?' (opc.)':''}</label><input type="date" value={form.expiry_date} onChange={e => rf('expiry_date',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Cena jedn. (zł)</label><input type="text" inputMode="decimal" value={form.unit_price} onChange={e => rf('unit_price',e.target.value)} /></div>
            <div><label>Lokalizacja</label><input value={form.warehouse_location} onChange={e => rf('warehouse_location',e.target.value)} /></div>
          </div>
          {line?.item_type==='surowiec' && (
            <>
              <div className="fr">
                <div><label>Data produkcji</label><input type="date" value={form.production_date} onChange={e => rf('production_date',e.target.value)} /></div>
                <div><label>Nr faktury</label><input value={form.invoice_number} onChange={e => rf('invoice_number',e.target.value)} /></div>
              </div>
              <div style={{ background:'#F7F6F1', border:'0.5px solid #E3E1D8', borderRadius:6, padding:'8px 10px', fontSize:12, marginTop:6 }}>
                <div style={{ color:'#5F5E5A', marginBottom:2 }}>Specyfikacja (automatycznie, wg przypisania surowca):</div>
                <b>{form.spec_number || '— brak przypisanej specyfikacji —'}</b>{form.spec_approved_at && <span className="muted"> · zatw. {form.spec_approved_at}</span>}
              </div>
            </>
          )}
          <div style={{ marginTop:8 }}><label>Uwagi</label><input value={form.notes} onChange={e => rf('notes',e.target.value)} placeholder="opcjonalne" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={doReceive} disabled={saving}>{saving?'Przyjmowanie...':'Przyjmij na magazyn'}</button>
          </div>
        </div>
      </div>

      {/* Modal ręcznego przyjęcia */}
      <div className={`modal-overlay ${manModal?'open':''}`} onClick={e => e.target===e.currentTarget && setManModal(false)}>
        <div className="modal" style={{ maxWidth:600 }}>
          <div className="modal-title">Przyjęcie ręczne — poza zamówieniem zakupu</div>
          <div className="info-box" style={{ marginBottom:10, fontSize:12 }}>Pozwala uzupełnić bazę o dostawy spoza ZZ (np. dane historyczne). Trafi bezpośrednio na magazyn.</div>
          {manError && <div className="err-box">{manError}</div>}
          <div className="fr">
            <div><label>Rodzaj *</label>
              <select value={manForm.type} onChange={e => mf('type',e.target.value)}>
                <option value="surowiec">Surowiec</option>
                <option value="opakowanie">Materiał opakowaniowy</option>
              </select>
            </div>
            {manForm.type==='surowiec'
              ? <div><label>Składnik *</label>
                  <select value={manForm.ingredient_id} onChange={e => mf('ingredient_id',e.target.value)}>
                    <option value="">— wybierz —</option>
                    {ingredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                  </select>
                </div>
              : <div><label>Materiał opakowaniowy *</label>
                  <select value={manForm.packaging_material_id} onChange={e => mf('packaging_material_id',e.target.value)}>
                    <option value="">— wybierz —</option>
                    {packaging.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                  </select>
                </div>}
          </div>
          <div className="fr">
            {manForm.type==='surowiec'
              ? <div><label>Dostawca</label><input value={manForm.supplier_name} onChange={e => mf('supplier_name',e.target.value)} placeholder="nazwa dostawcy" /></div>
              : <div><label>Dostawca</label>
                  <select value={manForm.supplier_id} onChange={e => mf('supplier_id',e.target.value)}>
                    <option value="">— wybierz —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>}
            <div><label>Nr partii / atestu *</label><input value={manForm.delivery_lot} onChange={e => mf('delivery_lot',e.target.value)} placeholder="np. AT-2026-..." /></div>
          </div>
          <div className="fr3">
            <div><label>Ilość *</label><input type="text" inputMode="decimal" value={manForm.quantity} onChange={e => mf('quantity',e.target.value)} /></div>
            <div><label>Cena jedn. (zł)</label><input type="text" inputMode="decimal" value={manForm.unit_price} onChange={e => mf('unit_price',e.target.value)} /></div>
            <div><label>Data przyjęcia</label><input type="date" value={manForm.received_date} onChange={e => mf('received_date',e.target.value)} /></div>
          </div>
          <div className="fr3">
            {manForm.type==='surowiec' && <div><label>Data produkcji</label><input type="date" value={manForm.production_date} onChange={e => mf('production_date',e.target.value)} /></div>}
            <div><label>Data przydatności</label><input type="date" value={manForm.expiry_date} onChange={e => mf('expiry_date',e.target.value)} /></div>
            {manForm.type==='surowiec' && <div><label>Nr faktury</label><input value={manForm.invoice_number} onChange={e => mf('invoice_number',e.target.value)} /></div>}
            <div><label>Lokalizacja</label><input value={manForm.warehouse_location} onChange={e => mf('warehouse_location',e.target.value)} /></div>
          </div>
          {manForm.type==='surowiec' && (
            <div style={{ background:'#F7F6F1', border:'0.5px solid #E3E1D8', borderRadius:6, padding:'8px 10px', fontSize:12, marginTop:4 }}>
              {(() => { const sp = specForIngredient(manForm.ingredient_id, null); return (
                <><span style={{ color:'#5F5E5A' }}>Specyfikacja (automatycznie): </span><b>{sp.spec_number || '— brak —'}</b>{sp.spec_approved_at && <span className="muted"> · {sp.spec_approved_at}</span>}</>
              )})()}
            </div>
          )}
          <div className="modal-footer">
            <button className="btn" onClick={() => setManModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={doManual} disabled={manSaving}>{manSaving?'Zapisywanie...':'Przyjmij na magazyn'}</button>
          </div>
        </div>
      </div>

      {/* Modal edycji dostawy */}
      <div className={`modal-overlay ${editModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditModal(false)}>
        <div className="modal" style={{ maxWidth:600 }}>
          <div className="modal-title">Edycja dostawy {editForm.type==='opakowanie'?'(opakowanie)':'(surowiec)'}</div>
          <div className="info-box" style={{ marginBottom:10, fontSize:12 }}>Edycja dostępna tylko dla Admina.</div>
          {editError && <div className="err-box">{editError}</div>}
          <div className="fr">
            {editForm.type==='surowiec'
              ? <div><label>Dostawca</label><input value={editForm.supplier_name||''} onChange={e => ef('supplier_name',e.target.value)} /></div>
              : <div><label>Dostawca</label>
                  <select value={editForm.supplier_id||''} onChange={e => ef('supplier_id',e.target.value)}>
                    <option value="">— wybierz —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>}
            <div><label>Nr partii *</label><input value={editForm.delivery_lot||''} onChange={e => ef('delivery_lot',e.target.value)} /></div>
          </div>
          {editForm.type==='surowiec' && (
            <div className="fr">
              <div><label>Nr faktury</label><input value={editForm.invoice_number||''} onChange={e => ef('invoice_number',e.target.value)} /></div>
              <div><label>Data produkcji</label><input type="date" value={editForm.production_date||''} onChange={e => ef('production_date',e.target.value)} /></div>
            </div>
          )}
          <div className="fr3">
            <div><label>Data przydatności</label><input type="date" value={editForm.expiry_date||''} onChange={e => ef('expiry_date',e.target.value)} /></div>
            <div><label>Data przyjęcia</label><input type="date" value={editForm.received_date||''} onChange={e => ef('received_date',e.target.value)} /></div>
            <div><label>Lokalizacja</label><input value={editForm.warehouse_location||''} onChange={e => ef('warehouse_location',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Ilość *</label><input type="text" inputMode="decimal" value={editForm.quantity||''} onChange={e => ef('quantity',e.target.value)} /></div>
            <div><label>Cena jedn. (zł)</label><input type="text" inputMode="decimal" value={editForm.unit_price||''} onChange={e => ef('unit_price',e.target.value)} /></div>
            <div><label>Status</label>
              {editForm.type==='surowiec'
                ? <select value={editForm.status||'dopuszczona'} onChange={e => ef('status',e.target.value)}>
                    <option value="dopuszczona">Dopuszczona</option>
                    <option value="wstrzymana">Wstrzymana</option>
                    <option value="kwarantanna">Kwarantanna</option>
                  </select>
                : <select value={editForm.status||'dostepna'} onChange={e => ef('status',e.target.value)}>
                    <option value="dostepna">Dostępna</option>
                    <option value="wstrzymana">Wstrzymana</option>
                  </select>}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={doEdit} disabled={editSaving}>{editSaving?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      {/* Modal usuwania */}
      <div className={`modal-overlay ${delRow?'open':''}`} onClick={e => e.target===e.currentTarget && setDelRow(null)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Usuń przyjęcie</div>
          <div className="warn-box">
            Usunąć przyjęcie partii <b>{delRow?.lot}</b> ({delRow?.name})?<br/><br/>
            Zostaną automatycznie usunięte powiązane korekty{delRow?.type==='surowiec' && <> oraz powiązania z partiami produkcyjnymi</>}.<br/><br/>
            <b>Uwaga:</b> jeśli partia była użyta w produkcji, stany mogą wymagać przeliczenia. Operacja nieodwracalna.
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setDelRow(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => doDelete(delRow)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
