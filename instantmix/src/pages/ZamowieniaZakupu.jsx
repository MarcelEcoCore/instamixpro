import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const PO_STATUS = { nowe:'Nowe', czesciowo:'Częściowo', zrealizowane:'Zrealizowane', zamkniete:'Zamknięte', anulowane:'Anulowane' }
const PO_COLORS = { nowe:'b-info', czesciowo:'b-warn', zrealizowane:'b-ok', zamkniete:'b-gray', anulowane:'b-gray' }

const EMPTY_PO = { supplier_id:'', order_date:new Date().toISOString().slice(0,10), expected_date:'', notes:'' }
const EMPTY_LINE = { item_type:'surowiec', ingredient_id:'', packaging_material_id:'', qty_ordered:'', unit:'kg', unit_price:'' }

export default function ZamowieniaZakupu() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = true // dostępy później

  const [pos, setPos] = useState([])
  const [itemsMap, setItemsMap] = useState({})       // po_id -> [items]
  const [recvMap, setRecvMap] = useState({})         // poi_id -> przyjęto
  const [suppliers, setSuppliers] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [pkgMats, setPkgMats] = useState([])
  const [supIng, setSupIng] = useState([])           // supplier_ingredients
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('aktywne')
  const [expandedId, setExpandedId] = useState(null)

  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_PO)
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: po }, { data: items }, { data: s }, { data: ing }, { data: pm }, { data: si }, { data: ib }, { data: pb }] = await Promise.all([
      supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending:false }),
      supabase.from('purchase_order_items').select('*, ingredients(code,name), packaging_materials(code,name,unit)'),
      supabase.from('suppliers').select('id,name').eq('active',true).order('name'),
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('packaging_materials').select('id,code,name,unit').eq('active',true).order('code'),
      supabase.from('supplier_ingredients').select('supplier_id,ingredient_id,default_unit,default_price'),
      supabase.from('ingredient_batches').select('purchase_order_item_id,quantity_kg'),
      supabase.from('packaging_batches').select('purchase_order_item_id,quantity'),
    ])
    setPos(po || []); setSuppliers(s || []); setIngredients(ing || []); setPkgMats(pm || []); setSupIng(si || [])
    const im = {}
    ;(items || []).forEach(x => { (im[x.po_id] = im[x.po_id] || []).push(x) })
    setItemsMap(im)
    const rm = {}
    ;(ib || []).forEach(x => { if (x.purchase_order_item_id) rm[x.purchase_order_item_id] = (rm[x.purchase_order_item_id]||0) + parseFloat(x.quantity_kg||0) })
    ;(pb || []).forEach(x => { if (x.purchase_order_item_id) rm[x.purchase_order_item_id] = (rm[x.purchase_order_item_id]||0) + parseFloat(x.quantity||0) })
    setRecvMap(rm)
    setLoading(false)
  }

  const f = (k,v) => setForm(p => ({ ...p, [k]: v }))

  // składniki przypisane do dostawcy (z rejestru); gdy brak przypisań — wszystkie
  function ingredientsForSupplier() {
    if (!form.supplier_id) return ingredients
    const ids = supIng.filter(x => x.supplier_id === form.supplier_id).map(x => x.ingredient_id)
    if (ids.length === 0) return ingredients
    return ingredients.filter(i => ids.includes(i.id))
  }
  function supPrice(ingredient_id) {
    const r = supIng.find(x => x.supplier_id === form.supplier_id && x.ingredient_id === ingredient_id)
    return r || null
  }

  // ── status pozycji / zamówienia (liczony z przyjęć) ──
  function lineReceived(lineId) { return recvMap[lineId] || 0 }
  function lineStatus(it) {
    if (it.status === 'zamkniete') return 'zamkniete'
    const rec = lineReceived(it.id), ord = parseFloat(it.qty_ordered||0)
    if (rec <= 0.0001) return 'oczekuje'
    if (rec + 0.0001 >= ord) return 'zrealizowane'
    return 'czesciowo'
  }
  function poComputedStatus(po) {
    if (['anulowane','zamkniete'].includes(po.status)) return po.status
    const its = itemsMap[po.id] || []
    if (its.length === 0) return po.status || 'nowe'
    const sts = its.map(lineStatus)
    if (sts.every(s => s === 'zrealizowane' || s === 'zamkniete')) return 'zrealizowane'
    if (sts.some(s => s === 'czesciowo' || s === 'zrealizowane')) return 'czesciowo'
    return 'nowe'
  }

  const filtered = pos.filter(po => {
    const q = search.toLowerCase()
    const matchQ = !q || (po.po_number||'').toLowerCase().includes(q) || (po.suppliers?.name||'').toLowerCase().includes(q)
    const st = poComputedStatus(po)
    const matchStatus = filterStatus === 'wszystkie' ? true
      : filterStatus === 'aktywne' ? !['zrealizowane','zamkniete','anulowane'].includes(st)
      : st === filterStatus
    return matchQ && matchStatus
  })

  function poValue(po) {
    return (itemsMap[po.id]||[]).reduce((s,it) => s + (parseFloat(it.qty_ordered||0) * parseFloat(it.unit_price||0)), 0)
  }
  const itemLabel = it => it.item_type==='surowiec'
    ? (it.ingredients ? `${it.ingredients.code} — ${it.ingredients.name}` : '—')
    : (it.packaging_materials ? `${it.packaging_materials.code} — ${it.packaging_materials.name}` : '—')

  function openNew() { setForm(EMPTY_PO); setLines([{ ...EMPTY_LINE }]); setEditMode(false); setError(''); setModal(true) }
  function openEdit(po) {
    setForm({ id:po.id, supplier_id:po.supplier_id||'', order_date:po.order_date, expected_date:po.expected_date||'', notes:po.notes||'' })
    const its = (itemsMap[po.id]||[]).map(it => ({ id:it.id, item_type:it.item_type, ingredient_id:it.ingredient_id||'', packaging_material_id:it.packaging_material_id||'', qty_ordered:it.qty_ordered, unit:it.unit||'', unit_price:it.unit_price??'' }))
    setLines(its.length ? its : [{ ...EMPTY_LINE }])
    setEditMode(true); setError(''); setModal(true)
  }

  function addLine() { setLines(p => [...p, { ...EMPTY_LINE }]) }
  function rmLine(i) { setLines(p => p.filter((_,idx) => idx!==i)) }
  function updLine(i, patch) { setLines(p => p.map((l,idx) => idx===i ? { ...l, ...patch } : l)) }
  function pickIngredient(i, ingredient_id) {
    const sp = supPrice(ingredient_id)
    updLine(i, { ingredient_id, unit: sp?.default_unit || 'kg', unit_price: sp?.default_price ?? '' })
  }

  async function generatePoNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('purchase_orders').select('po_number').ilike('po_number', `ZK-${year}-%`).order('po_number', { ascending:false }).limit(1)
    if (data && data.length > 0) { const last = parseInt(data[0].po_number.split('-')[2]) || 0; return `ZK-${year}-${String(last+1).padStart(4,'0')}` }
    return `ZK-${year}-0001`
  }

  async function save() {
    if (!form.supplier_id) { setError('Wybierz dostawcę'); return }
    const valid = lines.filter(l => (l.item_type==='surowiec' ? l.ingredient_id : l.packaging_material_id) && parseFloat(l.qty_ordered)>0)
    if (valid.length === 0) { setError('Dodaj co najmniej jedną pozycję z ilością'); return }
    setSaving(true); setError('')
    const header = { supplier_id:form.supplier_id, order_date:form.order_date, expected_date:form.expected_date||null, notes:form.notes||null }
    let poId = form.id
    if (editMode) {
      const { error: err } = await supabase.from('purchase_orders').update({ ...header, updated_at:new Date().toISOString() }).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('purchase_order_items').delete().eq('po_id', form.id)
    } else {
      const po_number = await generatePoNumber()
      const { data: rec, error: err } = await supabase.from('purchase_orders').insert({ ...header, po_number, status:'nowe', created_by:profile?.id }).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      poId = rec.id
    }
    const payload = valid.map(l => ({
      po_id: poId, item_type: l.item_type,
      ingredient_id: l.item_type==='surowiec' ? l.ingredient_id : null,
      packaging_material_id: l.item_type==='opakowanie' ? l.packaging_material_id : null,
      qty_ordered: parseFloat(l.qty_ordered),
      unit: l.unit || null,
      unit_price: l.unit_price==='' ? null : parseFloat(l.unit_price),
    }))
    const { error: iErr } = await supabase.from('purchase_order_items').insert(payload)
    if (iErr) { setError(iErr.message); setSaving(false); return }
    setSaving(false); setModal(false); load()
  }

  async function setStatus(po, status) {
    await supabase.from('purchase_orders').update({ status, updated_at:new Date().toISOString() }).eq('id', po.id)
    load()
  }
  async function deletePo(po) {
    await supabase.from('purchase_orders').delete().eq('id', po.id)
    setConfirmDelete(null); load()
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL')
  const fmtZl = v => v>0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Zamówienia zakupu</div><div className="page-sub">Zamówienia do dostawców (surowce i opakowania)</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj: nr, dostawca..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowe zamówienie</button>}
        </div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6, flexWrap:'wrap' }}>
        {['aktywne','wszystkie','nowe','czesciowo','zrealizowane','zamkniete','anulowane'].map(s => (
          <button key={s} className="btn btn-sm" onClick={() => setFilterStatus(s)}
            style={{ background:filterStatus===s?'#1D9E75':undefined, color:filterStatus===s?'#fff':undefined, borderColor:filterStatus===s?'#1D9E75':undefined }}>
            {s==='aktywne'?'Aktywne':s==='wszystkie'?'Wszystkie':PO_STATUS[s]}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <th>Nr zamówienia</th><th>Dostawca</th><th>Data</th><th>Termin dostawy</th>
            <th style={{ textAlign:'center' }}>Pozycji</th><th style={{ textAlign:'right' }}>Wartość</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak zamówień</td></tr>}
            {!loading && filtered.map(po => {
              const its = itemsMap[po.id] || []
              const isExp = expandedId === po.id
              const st = poComputedStatus(po)
              return (
                <React.Fragment key={po.id}>
                  <tr style={{ opacity:['anulowane'].includes(po.status)?0.6:1 }}>
                    <td style={{ textAlign:'center' }}><button onClick={() => setExpandedId(isExp?null:po.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>{isExp?'▲':'▼'}</button></td>
                    <td><span className="lot">{po.po_number||'—'}</span></td>
                    <td style={{ fontWeight:500 }}>{po.suppliers?.name||'—'}</td>
                    <td className="muted" style={{ fontSize:12 }}>{po.order_date}</td>
                    <td className="muted" style={{ fontSize:12 }}>{po.expected_date||'—'}</td>
                    <td style={{ textAlign:'center' }}><span className="badge b-info">{its.length}</span></td>
                    <td style={{ textAlign:'right', fontSize:12, color:'#3C3489' }}>{fmtZl(poValue(po))}</td>
                    <td><span className={`badge ${PO_COLORS[st]||'b-gray'}`}>{PO_STATUS[st]||st}</span></td>
                    <td><div className="flex" style={{ gap:4 }}>
                      {canEdit && !['anulowane'].includes(po.status) && <button className="btn btn-sm" onClick={() => openEdit(po)}>Edytuj</button>}
                      {canEdit && !['zamkniete','anulowane'].includes(po.status) && st!=='zrealizowane' && <button className="btn btn-sm" style={{ fontSize:10 }} onClick={() => setStatus(po,'zamkniete')}>Zamknij</button>}
                      {canEdit && po.status!=='anulowane' && <button className="btn btn-sm" style={{ fontSize:10 }} onClick={() => setStatus(po,'anulowane')}>Anuluj</button>}
                      {isAdmin && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(po)}>Usuń</button>}
                    </div></td>
                  </tr>
                  {isExp && (
                    <tr><td colSpan={9} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'8px 16px 12px 40px' }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'#0F6E56', marginBottom:8 }}>Pozycje zamówienia</div>
                        <table style={{ width:'auto', minWidth:760 }}>
                          <thead><tr>
                            <th>Typ</th><th>Pozycja</th>
                            <th style={{ textAlign:'right' }}>Zamówiono</th><th style={{ textAlign:'right' }}>Przyjęto</th><th style={{ textAlign:'right' }}>Pozostało</th>
                            <th style={{ textAlign:'right' }}>Cena</th><th>Status</th>
                          </tr></thead>
                          <tbody>
                            {its.map(it => {
                              const rec = lineReceived(it.id), ord = parseFloat(it.qty_ordered||0), rem = Math.max(0, ord-rec)
                              const ls = lineStatus(it)
                              return (
                                <tr key={it.id}>
                                  <td><span className="badge b-info" style={{ fontSize:10 }}>{it.item_type}</span></td>
                                  <td style={{ fontSize:12, fontWeight:500 }}>{itemLabel(it)}</td>
                                  <td style={{ textAlign:'right' }}>{fmt(ord)} {it.unit||''}</td>
                                  <td style={{ textAlign:'right', color:'#085041' }}>{fmt(rec)}</td>
                                  <td style={{ textAlign:'right', color: rem>0?'#BA7517':'#888' }}>{fmt(rem)}</td>
                                  <td style={{ textAlign:'right', fontSize:12 }}>{it.unit_price!=null?fmtZl(parseFloat(it.unit_price)):'—'}</td>
                                  <td><span className={`badge ${ls==='zrealizowane'?'b-ok':ls==='czesciowo'?'b-warn':ls==='zamkniete'?'b-gray':'b-info'}`} style={{ fontSize:10 }}>{ls==='oczekuje'?'Oczekuje':ls==='czesciowo'?'Częściowo':ls==='zrealizowane'?'Zrealizowane':'Zamknięte'}</span></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal PO */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:720 }}>
          <div className="modal-title">{editMode?'Edytuj zamówienie zakupu':'Nowe zamówienie zakupu'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div style={{ flex:2 }}><label>Dostawca *</label>
              <select value={form.supplier_id} onChange={e => f('supplier_id', e.target.value)}>
                <option value="">— wybierz dostawcę —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label>Data zamówienia</label><input type="date" value={form.order_date} onChange={e => f('order_date',e.target.value)} /></div>
            <div><label>Termin dostawy</label><input type="date" value={form.expected_date} onChange={e => f('expected_date',e.target.value)} /></div>
          </div>

          <div style={{ marginBottom:10 }}>
            <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <label style={{ margin:0 }}>Pozycje</label>
              <button type="button" className="btn btn-sm" onClick={addLine}>+ Dodaj pozycję</button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex" style={{ gap:6, marginBottom:6, alignItems:'center', flexWrap:'wrap' }}>
                <select value={l.item_type} onChange={e => updLine(i, { item_type:e.target.value, ingredient_id:'', packaging_material_id:'' })} style={{ width:120 }}>
                  <option value="surowiec">Surowiec</option><option value="opakowanie">Opakowanie</option>
                </select>
                {l.item_type==='surowiec' ? (
                  <select value={l.ingredient_id} onChange={e => pickIngredient(i, e.target.value)} style={{ flex:2, minWidth:180 }}>
                    <option value="">— składnik —</option>
                    {ingredientsForSupplier().map(ing => <option key={ing.id} value={ing.id}>{ing.code} — {ing.name}</option>)}
                  </select>
                ) : (
                  <select value={l.packaging_material_id} onChange={e => updLine(i, { packaging_material_id:e.target.value, unit: (pkgMats.find(m=>m.id===e.target.value)?.unit)||l.unit })} style={{ flex:2, minWidth:180 }}>
                    <option value="">— opakowanie —</option>
                    {pkgMats.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                  </select>
                )}
                <input type="number" step="0.001" value={l.qty_ordered} onChange={e => updLine(i,{ qty_ordered:e.target.value })} placeholder="ilość" style={{ width:90 }} />
                <input value={l.unit} onChange={e => updLine(i,{ unit:e.target.value })} placeholder="jedn." style={{ width:60 }} />
                <input type="number" step="0.01" value={l.unit_price} onChange={e => updLine(i,{ unit_price:e.target.value })} placeholder="cena" style={{ width:90 }} />
                <button type="button" className="btn btn-sm btn-danger" onClick={() => rmLine(i)}>✕</button>
              </div>
            ))}
            {form.supplier_id && <div className="muted" style={{ fontSize:11 }}>Dla surowców lista zawężona do składników przypisanych do tego dostawcy (jeśli są). Cena podpowiada się ze specyfikacji.</div>}
          </div>

          <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Utwórz zamówienie'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń zamówienie</div>
          <div className="warn-box">Usunąć zamówienie <b>{confirmDelete?.po_number}</b>? Usunie też jego pozycje.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deletePo(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
