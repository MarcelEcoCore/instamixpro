import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STATUS_LABELS = {
  nowe:'Nowe', zaplanowane:'Zaplanowane', w_produkcji:'W produkcji',
  wyprodukowane:'Wyprodukowane', w_pakowaniu:'W pakowaniu', spakowane:'Spakowane',
  wyslane:'Wydane do klienta', anulowane:'Anulowane',
  // statusy ze starego obiegu (okres przejściowy)
  w_realizacji:'W realizacji', zrealizowane:'Zrealizowane',
}
const STATUS_COLORS = {
  nowe:'b-info', zaplanowane:'b-info', w_produkcji:'b-warn', wyprodukowane:'b-warn',
  w_pakowaniu:'b-warn', spakowane:'b-ok', wyslane:'b-purple', anulowane:'b-gray',
  w_realizacji:'b-warn', zrealizowane:'b-ok',
}
// statusy oferowane w szybkiej zmianie (nowy obieg)
const FLOW = ['nowe','zaplanowane','w_produkcji','wyprodukowane','w_pakowaniu','spakowane','wyslane','anulowane']

const EMPTY_FORM = { client_id:'', client:'', bom_id:'', qty_units:'', ship_date:'', notes:'' }

export default function Zlecenia() {
  const { profile } = useAuth()
  const isSprzedaz = profile?.role === 'sprzedaz'
  const canEdit = ['admin','technolog','sprzedaz'].includes(profile?.role)
  const canDelete = ['admin','technolog'].includes(profile?.role)

  const [orders, setOrders] = useState([])
  const [clients, setClients] = useState([])
  const [boms, setBoms] = useState([])
  const [bomItemsMap, setBomItemsMap] = useState({})
  const [pkgMats, setPkgMats] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('aktywne')

  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  // combobox klienta
  const [clientQuery, setClientQuery] = useState('')
  const [clientOpen, setClientOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    load()
    const interval = setInterval(load, 45000)
    return () => clearInterval(interval)
  }, [])

  async function load() {
    setLoading(true)
    const [{ data: o }, { data: c }, { data: b }, { data: bi }, { data: pm }] = await Promise.all([
      supabase.from('orders').select('*, bom(code_ext,gramatura_kg,units_per_pallet,recipes(code,name,version)), recipes(code,name,version)').order('ship_date', { ascending: true }),
      supabase.from('clients').select('id,number,name,status,is_sample').eq('status','aktywny').order('name'),
      supabase.from('bom').select('id,client_id,code_ext,gramatura_kg,units_per_pallet,unit_material_id,pallet_material_id,recipe_id,status,recipes(code,name,version)').eq('status','aktywny').order('code_ext'),
      supabase.from('bom_items').select('bom_id,qty_per,per,packaging_materials(code,name,unit)'),
      supabase.from('packaging_materials').select('id,code,name,unit'),
    ])
    setOrders(o || [])
    setClients(c || [])
    setBoms(b || [])
    const im = {}
    ;(bi || []).forEach(x => { (im[x.bom_id] = im[x.bom_id] || []).push(x) })
    setBomItemsMap(im)
    setPkgMats(pm || [])
    setLoading(false)
    setLastUpdated(new Date())
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // ── combobox klienta ──
  function clientLabel(c) {
    if (!c) return ''
    return (c.is_sample ? 'PRÓBKA — ' : (c.number ? c.number + ' — ' : '')) + c.name
  }
  function clientMatches() {
    const q = clientQuery.trim().toLowerCase()
    const list = !q ? clients : clients.filter(c => clientLabel(c).toLowerCase().includes(q))
    return list.slice(0, 60)
  }
  function pickClient(id) {
    const c = clients.find(x => x.id === id)
    setForm(p => ({ ...p, client_id: id, client: c ? c.name : '', bom_id: '' }))  // zmiana klienta zeruje BOM
    setClientQuery(clientLabel(c)); setClientOpen(false)
  }
  function handleClientKey(e) {
    if (!clientOpen) { if (e.key === 'ArrowDown') { setClientOpen(true); setHighlight(0) } return }
    const m = clientMatches()
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, m.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (m[highlight]) pickClient(m[highlight].id) }
    else if (e.key === 'Escape') { setClientOpen(false) }
  }

  const bomsForClient = form.client_id ? boms.filter(b => b.client_id === form.client_id) : []
  const selBom = boms.find(b => b.id === form.bom_id)
  const qty = parseFloat(form.qty_units) || 0
  const previewKg = selBom ? qty * parseFloat(selBom.gramatura_kg || 0) : 0
  const previewPallets = (selBom && selBom.units_per_pallet) ? Math.ceil(qty / parseInt(selBom.units_per_pallet)) : null
  const matById = id => pkgMats.find(m => m.id === id)
  function bomMaterials() {
    if (!selBom || qty <= 0) return []
    const rows = []
    const u = matById(selBom.unit_material_id)
    if (u) rows.push({ code:u.code, name:u.name, unit:u.unit, przelicznik:'1 / szt.', total: qty })
    const pal = matById(selBom.pallet_material_id)
    if (pal && previewPallets) rows.push({ code:pal.code, name:pal.name, unit:pal.unit, przelicznik:'1 / paletę', total: previewPallets })
    ;(bomItemsMap[selBom.id] || []).forEach(it => {
      const m = it.packaging_materials
      const per = parseFloat(it.qty_per) || 0
      const naPalete = it.per === 'paleta'
      const total = naPalete ? per * (previewPallets||0) : per * qty
      rows.push({ code:m?.code, name:m?.name, unit:m?.unit, przelicznik: `${per} / ${naPalete?'paletę':'szt.'}`, total })
    })
    return rows
  }

  const filtered = orders.filter(o => {
    const q = search.toLowerCase()
    const bomCode = o.bom?.code_ext || ''
    const recName = o.bom?.recipes?.name || o.recipes?.name || ''
    const matchQ = !q || (o.order_number||'').toLowerCase().includes(q) || (o.client||'').toLowerCase().includes(q) || bomCode.toLowerCase().includes(q) || recName.toLowerCase().includes(q)
    const active = !['wyslane','anulowane','zrealizowane'].includes(o.status)
    const matchStatus = filterStatus === 'wszystkie' ? true
      : filterStatus === 'aktywne' ? active
      : o.status === filterStatus
    return matchQ && matchStatus
  })

  const stats = {
    nowe: orders.filter(o => o.status==='nowe').length,
    wtoku: orders.filter(o => ['zaplanowane','w_produkcji','wyprodukowane','w_pakowaniu','spakowane','w_realizacji'].includes(o.status)).length,
    wydane: orders.filter(o => ['wyslane','zrealizowane'].includes(o.status)).length,
    pilne: orders.filter(o => !['wyslane','anulowane','zrealizowane'].includes(o.status) && o.ship_date && new Date(o.ship_date) <= new Date(Date.now()+7*24*3600*1000)).length,
  }

  function openNew() { setForm(EMPTY_FORM); setClientQuery(''); setClientOpen(false); setEditMode(false); setError(''); setModal(true) }
  function openEdit(o) {
    setForm({ id:o.id, client_id:o.client_id||'', client:o.client||'', bom_id:o.bom_id||'', qty_units:o.qty_units??'', ship_date:o.ship_date||'', notes:o.notes||'' })
    const c = clients.find(x => x.id === o.client_id)
    setClientQuery(c ? clientLabel(c) : (o.client||''))
    setClientOpen(false); setEditMode(true); setError(''); setModal(true)
  }

  async function generateOrderNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('orders').select('order_number').ilike('order_number', `ZL-${year}-%`).order('order_number', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      const last = parseInt(data[0].order_number.split('-')[2]) || 0
      return `ZL-${year}-${String(last+1).padStart(4,'0')}`
    }
    return `ZL-${year}-0001`
  }

  async function save() {
    if (!form.client_id) { setError('Wybierz klienta'); return }
    if (!form.bom_id) { setError('Wybierz BOM'); return }
    if (!qty || qty <= 0) { setError('Podaj ilość sztuk'); return }
    if (!form.ship_date) { setError('Podaj datę wysyłki'); return }
    if (!form.notes || !form.notes.trim()) { setError('Uwagi są wymagane'); return }
    setSaving(true); setError('')

    const bom = selBom
    const weight = qty * parseFloat(bom.gramatura_kg || 0)
    const payload = {
      client_id: form.client_id,
      client: form.client,
      bom_id: form.bom_id,
      qty_units: qty,
      // pola zgodne ze starym modelem (współistnienie):
      recipe_id: bom.recipe_id || null,
      quantity_kg: parseFloat(weight.toFixed(3)),
      bag_weight_kg: parseFloat(bom.gramatura_kg || 0) || null,
      bags_per_pallet: bom.units_per_pallet || null,
      pallets: (bom.units_per_pallet ? Math.ceil(qty / parseInt(bom.units_per_pallet)) : null),
      ship_date: form.ship_date,
      notes: form.notes.trim(),
    }
    if (editMode) {
      const { error: err } = await supabase.from('orders').update({ ...payload, updated_at:new Date().toISOString() }).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const orderNumber = await generateOrderNumber()
      const { error: err } = await supabase.from('orders').insert({ ...payload, order_number:orderNumber, status:'nowe', created_by:profile?.id })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setModal(false); load()
  }

  async function quickStatus(order, newStatus) {
    await supabase.from('orders').update({ status:newStatus, updated_at:new Date().toISOString() }).eq('id', order.id)
    load()
  }
  async function deleteOrder(order) {
    await supabase.from('orders').delete().eq('id', order.id)
    setConfirmDelete(null); load()
  }

  function daysUntil(d) { return Math.ceil((new Date(d) - new Date()) / (1000*60*60*24)) }
  function shipBadge(o) {
    if (['wyslane','anulowane','zrealizowane','spakowane'].includes(o.status) || !o.ship_date) return null
    const d = daysUntil(o.ship_date)
    if (d < 0) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>Po terminie</span>
    if (d === 0) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>Dziś!</span>
    if (d <= 3) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>{d}d</span>
    if (d <= 7) return <span className="badge b-warn" style={{ fontSize:10, marginLeft:6 }}>{d}d</span>
    return null
  }
  const fmtKg = v => parseFloat(v||0).toLocaleString('pl-PL')

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Zamówienia sprzedaży</div><div className="page-sub">Klient → BOM → ilość sztuk</div></div>
        <div className="flex" style={{ gap:8, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'#085041', background:'#E1F5EE', padding:'2px 8px', borderRadius:999 }}>LIVE · {lastUpdated.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</span>
          <input className="search" placeholder="Szukaj: nr, klient, BOM..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          <button className="btn btn-sm" onClick={load}>↻</button>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowe zamówienie</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Nowe</div><div className="stat-val" style={{ color:'#0C447C' }}>{stats.nowe}</div></div>
        <div className="stat-card"><div className="stat-label">W toku</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.wtoku}</div></div>
        <div className="stat-card"><div className="stat-label">Wydane</div><div className="stat-val" style={{ color:'#3C3489' }}>{stats.wydane}</div></div>
        <div className="stat-card"><div className="stat-label">Pilne (≤7 dni)</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.pilne}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6, flexWrap:'wrap' }}>
        {['aktywne','wszystkie','nowe','zaplanowane','w_produkcji','w_pakowaniu','spakowane','wyslane','anulowane'].map(s => (
          <button key={s} className="btn btn-sm" onClick={() => setFilterStatus(s)}
            style={{ background:filterStatus===s?'#1D9E75':undefined, color:filterStatus===s?'#fff':undefined, borderColor:filterStatus===s?'#1D9E75':undefined }}>
            {s==='aktywne'?'Aktywne':s==='wszystkie'?'Wszystkie':STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 300px)' }}>
        <table style={{ minWidth:920 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th>Nr zamówienia</th><th>Klient</th><th>BOM / receptura</th>
            <th style={{ textAlign:'right' }}>Ilość</th><th style={{ textAlign:'right' }}>Waga</th>
            <th>Data wysyłki</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(o => {
              const bomCode = o.bom?.code_ext
              const rec = o.bom?.recipes || o.recipes
              return (
                <tr key={o.id} style={{ background: (!['wyslane','anulowane','zrealizowane'].includes(o.status) && o.ship_date && daysUntil(o.ship_date)<0) ? '#FCEBEB55' : undefined }}>
                  <td><span className="lot">{o.order_number}</span></td>
                  <td style={{ fontWeight:500 }}>{o.client}</td>
                  <td>
                    {bomCode ? <div style={{ fontWeight:500, fontSize:12 }}><span className="lot">{bomCode}</span></div> : null}
                    <div className="muted" style={{ fontSize:11 }}>{rec ? `${rec.name} (${rec.version})` : '—'}</div>
                  </td>
                  <td style={{ textAlign:'right' }}>{o.qty_units!=null ? <b>{parseFloat(o.qty_units).toLocaleString('pl-PL')} szt.</b> : <span className="muted">—</span>}</td>
                  <td style={{ textAlign:'right' }}>{o.quantity_kg!=null ? fmtKg(o.quantity_kg)+' kg' : '—'}</td>
                  <td><span className="muted">{o.ship_date||'—'}</span>{shipBadge(o)}</td>
                  <td>
                    {canEdit && !isSprzedaz ? (
                      <select value={o.status} onChange={e => quickStatus(o, e.target.value)}
                        style={{ fontSize:11, padding:'2px 6px', border:'0.5px solid #D3D1C7', borderRadius:6, cursor:'pointer' }}>
                        {FLOW.map(k => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
                        {!FLOW.includes(o.status) && <option value={o.status}>{STATUS_LABELS[o.status]||o.status}</option>}
                      </select>
                    ) : (
                      <span className={`badge ${STATUS_COLORS[o.status]||'b-gray'}`}>{STATUS_LABELS[o.status]||o.status}</span>
                    )}
                  </td>
                  <td>{canEdit && (
                    <div className="flex" style={{ gap:4 }}>
                      <button className="btn btn-sm" onClick={() => openEdit(o)}>Edytuj</button>
                      {canDelete && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(o)}>Usuń</button>}
                    </div>
                  )}</td>
                </tr>
              )
            })}
            {!loading && filtered.length===0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak zamówień</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:560 }}>
          <div className="modal-title">{editMode?'Edytuj zamówienie':'Nowe zamówienie sprzedaży'}</div>
          {error && <div className="err-box">{error}</div>}

          <div className="fr">
            <div style={{ position:'relative' }}>
              <label>Klient *</label>
              <input value={clientQuery} placeholder="Wpisz numer lub nazwę klienta..."
                onChange={e => { setClientQuery(e.target.value); setClientOpen(true); setHighlight(0); setForm(p => ({ ...p, client_id:'', client:'', bom_id:'' })) }}
                onFocus={() => setClientOpen(true)} onBlur={() => setTimeout(() => setClientOpen(false), 150)}
                onKeyDown={handleClientKey} autoComplete="off" />
              {clientOpen && (
                <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:50, background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, marginTop:4, maxHeight:240, overflowY:'auto', boxShadow:'0 6px 20px rgba(0,0,0,0.12)' }}>
                  {clientMatches().length===0 && <div style={{ padding:'8px 10px', fontSize:12, color:'#888' }}>Brak pasujących klientów</div>}
                  {clientMatches().map((c, idx) => (
                    <div key={c.id} onMouseDown={e => { e.preventDefault(); pickClient(c.id) }} onMouseEnter={() => setHighlight(idx)}
                      style={{ padding:'6px 10px', cursor:'pointer', fontSize:13, background: idx===highlight ? '#E1F5EE' : '#fff' }}>
                      {clientLabel(c)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div><label>Data wysyłki *</label><input type="date" value={form.ship_date} onChange={e => f('ship_date',e.target.value)} /></div>
          </div>

          <div style={{ marginBottom:10 }}>
            <label>BOM (wyrób) *</label>
            <select value={form.bom_id} onChange={e => f('bom_id', e.target.value)} disabled={!form.client_id}>
              <option value="">{form.client_id ? '— wybierz BOM —' : 'najpierw wybierz klienta'}</option>
              {bomsForClient.map(b => <option key={b.id} value={b.id}>{b.code_ext} {b.recipes ? '· '+b.recipes.name : ''}</option>)}
            </select>
            {form.client_id && bomsForClient.length===0 && <div className="muted" style={{ fontSize:11, marginTop:4, color:'#BA7517' }}>Ten klient nie ma aktywnych BOM-ów. Dodaj w Jakość → BOM.</div>}
          </div>

          <div style={{ background:'#F7F6F1', border:'0.5px solid #E3E1D8', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
            <div className="fr" style={{ marginBottom:0 }}>
              <div><label>Ilość (sztuk opakowań) *</label><input type="number" min="0" step="1" value={form.qty_units} onChange={e => f('qty_units',e.target.value)} placeholder="np. 200" /></div>
              <div>
                <label>Podgląd</label>
                <div style={{ fontSize:13, paddingTop:6 }}>
                  Waga: <b style={{ color:'#085041' }}>{previewKg>0 ? fmtKg(parseFloat(previewKg.toFixed(3)))+' kg' : '—'}</b>
                  {previewPallets!=null && qty>0 ? <span style={{ marginLeft:10 }}>Palet: <b>{previewPallets}</b></span> : null}
                </div>
              </div>
            </div>
            {selBom && <div className="muted" style={{ fontSize:11, marginTop:6 }}>Gramatura: {parseFloat(selBom.gramatura_kg)} kg/szt{selBom.units_per_pallet?` · ${selBom.units_per_pallet} szt./paletę`:''}</div>}
          </div>

          {selBom && qty>0 && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#085041', marginBottom:6 }}>Materiały opakowaniowe wg BOM</div>
              <table style={{ width:'100%' }}>
                <thead><tr><th>Materiał</th><th style={{ width:110 }}>Przelicznik</th><th style={{ textAlign:'right', width:120 }}>Łącznie</th></tr></thead>
                <tbody>
                  {bomMaterials().map((r,i) => (
                    <tr key={i}>
                      <td style={{ fontSize:12 }}>{r.code ? r.code+' — ' : ''}{r.name||'—'}</td>
                      <td className="muted" style={{ fontSize:11 }}>{r.przelicznik}</td>
                      <td style={{ textAlign:'right', fontWeight:500 }}>{parseFloat((r.total||0).toFixed(3)).toLocaleString('pl-PL')} {r.unit||''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize:10, marginTop:4 }}>Podgląd planistyczny — faktyczne zejście opakowań nastąpi przy pakowaniu.</div>
            </div>
          )}

          <div><label>Uwagi *</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="wymagane" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Utwórz zamówienie'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń zamówienie</div>
          <div className="warn-box">Usunąć zamówienie <b>{confirmDelete?.order_number}</b> dla klienta <b>{confirmDelete?.client}</b>?</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteOrder(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
