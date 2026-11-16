import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_SUP = { name:'', address:'', nip:'', contact_person:'', phone:'', email:'', notes:'' }
const EMPTY_ASSIGN = { ingredient_id:'', is_current:false, spec_number:'', spec_approved_at:'', supplier_code:'', default_unit:'kg', default_price:'', moq:'', lead_time_days:'', notes:'' }

const num = v => { const n = parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?null:n }

export default function Dostawcy() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = true // dostępy nadamy później

  const [kind, setKind] = useState('surowce') // 'surowce' | 'opakowania'
  const [suppliers, setSuppliers] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [packaging, setPackaging] = useState([])
  const [assignIng, setAssignIng] = useState({})   // supplier_id -> [supplier_ingredients]
  const [assignPack, setAssignPack] = useState({})  // supplier_id -> [supplier_packaging]
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('aktywni')
  const [expandedId, setExpandedId] = useState(null)

  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_SUP)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const [assignModal, setAssignModal] = useState(false)
  const [assignSupplier, setAssignSupplier] = useState(null)
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGN)
  const [assignEditMode, setAssignEditMode] = useState(false)
  const [savingAssign, setSavingAssign] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [confirmDeleteAssign, setConfirmDeleteAssign] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: si }, { data: sp }, { data: ing }, { data: pm }] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_ingredients').select('*, ingredients(code,name)').order('created_at'),
      supabase.from('supplier_packaging').select('*, packaging_materials(code,name,type)').order('created_at'),
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('packaging_materials').select('id,code,name,type,unit').eq('active',true).order('code'),
    ])
    setSuppliers(s || [])
    setIngredients(ing || [])
    setPackaging(pm || [])
    const mi = {}; (si || []).forEach(x => { (mi[x.supplier_id] = mi[x.supplier_id] || []).push(x) })
    const mp = {}; (sp || []).forEach(x => { (mp[x.supplier_id] = mp[x.supplier_id] || []).push(x) })
    setAssignIng(mi)
    setAssignPack(mp)
    setLoading(false)
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const af = (k, v) => setAssignForm(p => ({ ...p, [k]: v }))

  // bieżąca lista wg zakładki
  const byKind = suppliers.filter(s => (s.kind || 'surowce') === kind)
  const assignMap = kind === 'opakowania' ? assignPack : assignIng
  const isPack = kind === 'opakowania'

  const filtered = byKind.filter(s => {
    const q = search.toLowerCase()
    const matchQ = !q || (s.name||'').toLowerCase().includes(q) || (s.nip||'').toLowerCase().includes(q) || (s.contact_person||'').toLowerCase().includes(q)
    const matchStatus = filterStatus === 'wszyscy' ? true : filterStatus === 'aktywni' ? s.active : !s.active
    return matchQ && matchStatus
  })

  const stats = {
    aktywni: byKind.filter(s => s.active).length,
    nieaktywni: byKind.filter(s => !s.active).length,
    total: byKind.length,
  }

  function openNew() { setForm(EMPTY_SUP); setEditMode(false); setError(''); setModal(true) }
  function openEdit(s) {
    setForm({ id:s.id, name:s.name, address:s.address||'', nip:s.nip||'', contact_person:s.contact_person||'', phone:s.phone||'', email:s.email||'', notes:s.notes||'' })
    setEditMode(true); setError(''); setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Nazwa dostawcy jest wymagana'); return }
    setSaving(true); setError('')
    const payload = { name:form.name.trim(), address:form.address||null, nip:form.nip||null, contact_person:form.contact_person||null, phone:form.phone||null, email:form.email||null, notes:form.notes||null }
    if (editMode) {
      const { error: err } = await supabase.from('suppliers').update({ ...payload, updated_at:new Date().toISOString() }).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('suppliers').insert({ ...payload, kind, active:true, created_by:profile?.id })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setModal(false); load()
  }

  async function archiveSupplier(s, deactivate) {
    await supabase.from('suppliers').update({ active: !deactivate, updated_at:new Date().toISOString() }).eq('id', s.id)
    load()
  }
  async function deleteSupplier(s) {
    await supabase.from('suppliers').delete().eq('id', s.id) // kaskadowo usuwa powiązania
    setConfirmDelete(null); load()
  }

  // ── Przypisania (składnik lub materiał opakowaniowy) ──
  function openAssignNew(supplier) {
    setAssignSupplier(supplier); setAssignForm(EMPTY_ASSIGN); setAssignEditMode(false); setAssignError(''); setAssignModal(true)
  }
  function openAssignEdit(supplier, a) {
    setAssignSupplier(supplier)
    const pack = (supplier.kind||'surowce') === 'opakowania'
    setAssignForm({
      id:a.id,
      ingredient_id: pack ? (a.packaging_material_id||'') : (a.ingredient_id||''),
      is_current:a.is_current,
      spec_number:a.spec_number||'', spec_approved_at:a.spec_approved_at||'',
      supplier_code:a.supplier_code||'', default_unit:a.default_unit||'',
      default_price:a.default_price??'', moq:a.moq??'', lead_time_days:a.lead_time_days??'',
      notes:a.notes||'',
    })
    setAssignEditMode(true); setAssignError(''); setAssignModal(true)
  }

  async function saveAssign() {
    const pack = (assignSupplier.kind||'surowce') === 'opakowania'
    if (!assignForm.ingredient_id) { setAssignError(pack?'Wybierz materiał':'Wybierz składnik'); return }
    setSavingAssign(true); setAssignError('')
    const table = pack ? 'supplier_packaging' : 'supplier_ingredients'
    const fkCol = pack ? 'packaging_material_id' : 'ingredient_id'
    // Reguła: jeden aktualny dostawca na pozycję — zdejmij flagę z innych
    if (assignForm.is_current) {
      await supabase.from(table).update({ is_current:false }).eq(fkCol, assignForm.ingredient_id)
    }
    const payload = {
      supplier_id: assignSupplier.id,
      [fkCol]: assignForm.ingredient_id,
      is_current: !!assignForm.is_current,
      supplier_code: assignForm.supplier_code||null,
      default_unit: assignForm.default_unit||null,
      default_price: num(assignForm.default_price),
      moq: num(assignForm.moq),
      lead_time_days: assignForm.lead_time_days==='' ? null : parseInt(assignForm.lead_time_days,10),
      notes: assignForm.notes||null,
    }
    if (!pack) {
      payload.spec_number = assignForm.spec_number||null
      payload.spec_approved_at = assignForm.spec_approved_at||null
    }
    if (assignEditMode) {
      const { error: err } = await supabase.from(table).update(payload).eq('id', assignForm.id)
      if (err) { setAssignError(err.message); setSavingAssign(false); return }
    } else {
      const { error: err } = await supabase.from(table).insert(payload)
      if (err) { setAssignError(err.code==='23505' ? (pack?'Ten materiał jest już przypisany do tego dostawcy':'Ten składnik jest już przypisany do tego dostawcy') : err.message); setSavingAssign(false); return }
    }
    setSavingAssign(false); setAssignModal(false); load()
  }

  async function deleteAssign(a) {
    const table = a.packaging_material_id ? 'supplier_packaging' : 'supplier_ingredients'
    await supabase.from(table).delete().eq('id', a.id)
    setConfirmDeleteAssign(null); load()
  }

  const assignOptions = isPack ? packaging : ingredients
  const assignIsPack = assignSupplier ? (assignSupplier.kind||'surowce')==='opakowania' : isPack

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Dostawcy</div><div className="page-sub">Rejestr dostawców surowców i materiałów opakowaniowych</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj dostawcy, NIP, kontakt..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:240 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowy dostawca ({isPack?'opakowania':'surowce'})</button>}
        </div>
      </div>

      {/* Zakładki rodzaju dostawcy */}
      <div className="flex" style={{ marginBottom:12, gap:0, borderBottom:'1px solid #E3E1D8' }}>
        {[['surowce','Surowce'],['opakowania','Materiały opakowaniowe']].map(([val,label]) => (
          <button key={val} onClick={() => { setKind(val); setExpandedId(null) }}
            style={{ padding:'8px 18px', fontSize:14, fontWeight: kind===val?600:400, cursor:'pointer',
              background:'none', border:'none', color: kind===val?'#0F6E56':'#5F5E5A',
              borderBottom: kind===val?'2px solid #1D9E75':'2px solid transparent', marginBottom:-1 }}>
            {label}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Aktywni dostawcy</div><div className="stat-val" style={{ color:'#085041' }}>{stats.aktywni}</div></div>
        <div className="stat-card"><div className="stat-label">Nieaktywni</div><div className="stat-val" style={{ color:'#888' }}>{stats.nieaktywni}</div></div>
        <div className="stat-card"><div className="stat-label">Wszyscy w tej grupie</div><div className="stat-val">{stats.total}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6 }}>
        {[['aktywni','Aktywni'],['nieaktywni','Nieaktywni'],['wszyscy','Wszyscy']].map(([val,label]) => (
          <button key={val} className="btn btn-sm" onClick={() => setFilterStatus(val)}
            style={{ background:filterStatus===val?'#1D9E75':undefined, color:filterStatus===val?'#fff':undefined, borderColor:filterStatus===val?'#1D9E75':undefined }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <th>Nazwa</th><th>Adres</th><th>NIP</th><th>Os. kontaktowa</th><th>Telefon</th><th>E-mail</th>
            <th style={{ textAlign:'center', width:80 }}>{isPack?'Materiały':'Składniki'}</th>
            <th style={{ width:90 }}>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(s => {
              const items = assignMap[s.id] || []
              const isExpanded = expandedId === s.id
              return (
                <React.Fragment key={s.id}>
                  <tr style={{ opacity: s.active ? 1 : 0.6 }}>
                    <td style={{ textAlign:'center' }}>
                      <button onClick={() => setExpandedId(isExpanded?null:s.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                        {isExpanded?'▲':'▼'}
                      </button>
                    </td>
                    <td style={{ fontWeight:500 }}>{s.name}</td>
                    <td className="muted" style={{ fontSize:12 }}>{s.address||'—'}</td>
                    <td className="muted" style={{ fontSize:12 }}>{s.nip||'—'}</td>
                    <td style={{ fontSize:12 }}>{s.contact_person||'—'}</td>
                    <td className="muted" style={{ fontSize:12 }}>{s.phone||'—'}</td>
                    <td className="muted" style={{ fontSize:12 }}>{s.email||'—'}</td>
                    <td style={{ textAlign:'center' }}><span className="badge b-info">{items.length}</span></td>
                    <td>{s.active ? <span className="badge b-ok">Aktywny</span> : <span className="badge b-gray">Nieaktywny</span>}</td>
                    <td>
                      <div className="flex" style={{ gap:4 }}>
                        {canEdit && <button className="btn btn-sm" onClick={() => openEdit(s)}>Edytuj</button>}
                        {canEdit && s.active && <button className="btn btn-sm" style={{ background:'#F1EFE8', color:'#5F5E5A', border:'0.5px solid #D3D1C7' }} onClick={() => archiveSupplier(s, true)}>Dezaktywuj</button>}
                        {canEdit && !s.active && <button className="btn btn-sm" style={{ background:'#E1F5EE', color:'#085041', border:'0.5px solid #1D9E75' }} onClick={() => archiveSupplier(s, false)}>Aktywuj</button>}
                        {isAdmin && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(s)}>Usuń</button>}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} style={{ padding:0, background:'#F9F8F5' }}>
                        <div style={{ padding:'10px 16px 14px 40px' }}>
                          <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:'#0F6E56' }}>{isPack?'Przypisane materiały opakowaniowe':'Przypisane składniki'} — {s.name}</div>
                            {canEdit && <button className="btn btn-sm btn-primary" onClick={() => openAssignNew(s)}>+ {isPack?'Przypisz materiał':'Przypisz składnik'}</button>}
                          </div>
                          {items.length === 0 ? (
                            <div className="muted" style={{ fontSize:12 }}>{isPack?'Brak przypisanych materiałów.':'Brak przypisanych składników.'}</div>
                          ) : (
                            <table style={{ width:'auto', minWidth:860 }}>
                              <thead><tr>
                                <th>{isPack?'Materiał':'Składnik'}</th><th style={{ width:80 }}>Aktualny</th>
                                {!isPack && <th>Nr specyfikacji</th>}
                                <th>Kod u dostawcy</th><th style={{ width:60 }}>Jedn.</th>
                                <th style={{ textAlign:'right', width:85 }}>Cena</th>
                                <th style={{ textAlign:'right', width:70 }}>MOQ</th>
                                <th style={{ textAlign:'right', width:80 }}>Lead (dni)</th><th></th>
                              </tr></thead>
                              <tbody>
                                {items.map(a => {
                                  const obj = isPack ? a.packaging_materials : a.ingredients
                                  return (
                                  <tr key={a.id}>
                                    <td style={{ fontWeight:500 }}>{obj ? `${obj.code} — ${obj.name}` : '—'}</td>
                                    <td>{a.is_current ? <span className="badge b-ok" style={{ fontSize:10 }}>Aktualny</span> : <span className="muted">—</span>}</td>
                                    {!isPack && <td className="muted" style={{ fontSize:12 }}>{a.spec_number||'—'}</td>}
                                    <td className="muted" style={{ fontSize:12 }}>{a.supplier_code||'—'}</td>
                                    <td className="muted" style={{ fontSize:12 }}>{a.default_unit||'—'}</td>
                                    <td style={{ textAlign:'right', fontSize:12 }}>{a.default_price!=null ? parseFloat(a.default_price).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                                    <td style={{ textAlign:'right', fontSize:12 }}>{a.moq!=null ? parseFloat(a.moq).toLocaleString('pl-PL',{maximumFractionDigits:3}) : '—'}</td>
                                    <td style={{ textAlign:'right', fontSize:12 }}>{a.lead_time_days!=null ? a.lead_time_days : '—'}</td>
                                    <td>
                                      <div className="flex" style={{ gap:4, justifyContent:'flex-end' }}>
                                        {canEdit && <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => openAssignEdit(s, a)}>Edytuj</button>}
                                        {canEdit && <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => setConfirmDeleteAssign(a)}>Usuń</button>}
                                      </div>
                                    </td>
                                  </tr>
                                )})}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {!loading && filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak dostawców w tej grupie</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal dostawca */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:560 }}>
          <div className="modal-title">{editMode?'Edytuj dostawcę':`Nowy dostawca — ${isPack?'opakowania':'surowce'}`}</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:10 }}><label>Nazwa *</label><input value={form.name} onChange={e => f('name',e.target.value)} placeholder="Nazwa firmy" /></div>
          <div><label>Adres</label><input value={form.address} onChange={e => f('address',e.target.value)} placeholder="ulica, kod, miasto" /></div>
          <div className="fr">
            <div><label>NIP</label><input value={form.nip} onChange={e => f('nip',e.target.value)} placeholder="np. 000-000-00-00" /></div>
            <div><label>Osoba kontaktowa</label><input value={form.contact_person} onChange={e => f('contact_person',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Telefon</label><input value={form.phone} onChange={e => f('phone',e.target.value)} /></div>
            <div><label>E-mail</label><input value={form.email} onChange={e => f('email',e.target.value)} /></div>
          </div>
          <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Dodaj dostawcę'}</button>
          </div>
        </div>
      </div>

      {/* Modal przypisanie */}
      <div className={`modal-overlay ${assignModal?'open':''}`} onClick={e => e.target===e.currentTarget && setAssignModal(false)}>
        <div className="modal" style={{ maxWidth:560 }}>
          <div className="modal-title">{assignEditMode?'Edytuj przypisanie':(assignIsPack?'Przypisz materiał':'Przypisz składnik')} {assignSupplier ? `— ${assignSupplier.name}` : ''}</div>
          {assignError && <div className="err-box">{assignError}</div>}
          <div style={{ marginBottom:10 }}>
            <label>{assignIsPack?'Materiał opakowaniowy *':'Składnik *'}</label>
            <select value={assignForm.ingredient_id} onChange={e => af('ingredient_id', e.target.value)} disabled={assignEditMode}>
              <option value="">— wybierz —</option>
              {assignOptions.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
            </select>
            {assignEditMode && <div className="muted" style={{ fontSize:11, marginTop:4 }}>Aby zmienić pozycję — usuń przypisanie i dodaj nowe.</div>}
          </div>
          <div style={{ marginBottom:10, padding:'10px 12px', background: assignForm.is_current ? '#E1F5EE' : '#F9F8F5', borderRadius:8, border:`0.5px solid ${assignForm.is_current ? '#1D9E75' : '#D3D1C7'}`, display:'flex', alignItems:'center', gap:10 }}>
            <input type="checkbox" id="is_current" checked={assignForm.is_current} onChange={e => af('is_current', e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }} />
            <label htmlFor="is_current" style={{ cursor:'pointer', fontWeight:500, fontSize:13, color: assignForm.is_current ? '#085041' : '#1a1a18' }}>
              Aktualny dostawca tej pozycji (zdejmie flagę z innych dostawców)
            </label>
          </div>
          {!assignIsPack && (
            <div className="fr">
              <div><label>Nr specyfikacji</label><input value={assignForm.spec_number} onChange={e => af('spec_number',e.target.value)} /></div>
              <div><label>Data zatwierdzenia spec.</label><input type="date" value={assignForm.spec_approved_at} onChange={e => af('spec_approved_at',e.target.value)} /></div>
            </div>
          )}
          <div className="fr">
            <div><label>Kod/nazwa u dostawcy</label><input value={assignForm.supplier_code} onChange={e => af('supplier_code',e.target.value)} /></div>
            <div><label>Jednostka</label><input value={assignForm.default_unit} onChange={e => af('default_unit',e.target.value)} placeholder={assignIsPack?'szt':'kg'} /></div>
          </div>
          <div className="fr">
            <div><label>Cena referencyjna (zł/{assignIsPack?'szt':'kg'})</label><input type="text" inputMode="decimal" value={assignForm.default_price} onChange={e => af('default_price',e.target.value)} placeholder="np. 12,50" /></div>
            <div><label>MOQ (min. zamówienie)</label><input type="text" inputMode="decimal" value={assignForm.moq} onChange={e => af('moq',e.target.value)} placeholder={assignIsPack?'szt':'kg'} /></div>
          </div>
          <div className="fr">
            <div><label>Lead time (dni dostawy)</label><input type="text" inputMode="numeric" value={assignForm.lead_time_days} onChange={e => af('lead_time_days',e.target.value)} placeholder="np. 14" /></div>
            <div><label>Uwagi</label><input value={assignForm.notes} onChange={e => af('notes',e.target.value)} placeholder="opcjonalne" /></div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setAssignModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveAssign} disabled={savingAssign}>{savingAssign?'Zapisywanie...':assignEditMode?'Zapisz zmiany':'Przypisz'}</button>
          </div>
        </div>
      </div>

      {/* Usuń dostawcę */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń dostawcę</div>
          <div className="warn-box">Usunąć dostawcę <b>{confirmDelete?.name}</b>? Wszystkie jego przypisania zostaną usunięte. Rozważ „Dezaktywuj", jeśli chcesz zachować historię.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteSupplier(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>

      {/* Usuń przypisanie */}
      <div className={`modal-overlay ${confirmDeleteAssign?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDeleteAssign(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń przypisanie</div>
          <div className="warn-box">Usunąć to przypisanie od dostawcy?</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDeleteAssign(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteAssign(confirmDeleteAssign)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
