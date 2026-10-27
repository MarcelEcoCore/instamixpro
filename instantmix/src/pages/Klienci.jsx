import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_FORM = { number:'', name:'', notes:'', status:'aktywny', is_sample:false, last_sample_date:'' }
const STATUS_KLIENTA = { aktywny:'Aktywny', oczekujacy:'Oczekujący', nieaktywny:'Nieaktywny' }
const STATUS_COLORS = { aktywny:'b-ok', oczekujacy:'b-warn', nieaktywny:'b-gray' }

export default function Klienci() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isSprzedaz = profile?.role === 'sprzedaz'
  const canEdit = isAdmin || isSprzedaz

  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('aktywni')
  const [sortCol, setSortCol] = useState('number')
  const [sortDir, setSortDir] = useState('asc')
  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [bomMap, setBomMap] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data }, { data: boms }] = await Promise.all([
      supabase.from('clients').select('*, recipes(id)').order('name'),
      supabase.from('bom').select('id, client_id, code_ext, gramatura_kg, units_per_pallet, status, recipes(code,name,version)').order('code_ext'),
    ])
    setClients(data || [])
    const map = {}
    ;(boms || []).forEach(b => { if (b.client_id) (map[b.client_id] = map[b.client_id] || []).push(b) })
    setBomMap(map)
    setLoading(false)
  }

  const filteredAndSorted = clients.filter(c => {
    const matchQ = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.number||'').toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      filterStatus === 'aktywni' ? c.status !== 'archiwum' :
      filterStatus === 'archiwum' ? c.status === 'archiwum' :
      filterStatus === 'probki' ? c.is_sample : true
    return matchQ && matchStatus
  }).slice().sort((a, b) => {
    let va = '', vb = ''
    if (sortCol === 'number') { va = a.is_sample ? 'PRÓBKA' : (a.number||''); vb = b.is_sample ? 'PRÓBKA' : (b.number||'') }
    else if (sortCol === 'name') { va = a.name||''; vb = b.name||'' }
    else if (sortCol === 'status') { va = a.status||''; vb = b.status||'' }
    else if (sortCol === 'created_at') { va = a.created_at||''; vb = b.created_at||'' }
    else if (sortCol === 'last_sample_date') { va = a.last_sample_date||''; vb = b.last_sample_date||'' }
    const cmp = va.localeCompare(vb, 'pl', { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })
  const filtered = filteredAndSorted

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function SortTh({ col, label, width, center }) {
    const active = sortCol === col
    return (
      <th style={{ width, textAlign: center ? 'center' : undefined, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}
        onClick={() => toggleSort(col)}>
        {label} <span style={{ fontSize:10, color: active ? '#0F6E56' : '#B4B2A9', marginLeft:2 }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </th>
    )
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function openNew() { setForm(EMPTY_FORM); setEditMode(false); setError(''); setModal(true) }
  function openEdit(c) {
    setForm({
      id: c.id,
      number: c.number || '',
      name: c.name,
      notes: c.notes || '',
      status: c.status || 'aktywny',
      is_sample: c.is_sample || false,
      last_sample_date: c.last_sample_date || '',
    })
    setEditMode(true); setError(''); setModal(true)
  }

  async function save() {
    if (!form.name) { setError('Nazwa klienta jest wymagana'); return }
    if (!form.is_sample && !form.number) { setError('Numer klienta jest wymagany (lub zaznacz jako Próbka)'); return }
    setSaving(true); setError('')
    const payload = {
      number: form.is_sample ? null : (form.number || null),
      name: form.name,
      notes: form.notes || null,
      status: form.status,
      is_sample: form.is_sample,
      last_sample_date: form.last_sample_date || null,
      updated_at: new Date().toISOString()
    }
    if (editMode) {
      const { error: err } = await supabase.from('clients').update(payload).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('recipes').update({ client: form.name }).eq('client_id', form.id)
    } else {
      const { error: err } = await supabase.from('clients').insert({
        ...payload,
        created_at: new Date().toISOString()
      })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setModal(false); load()
  }

  async function archiveClient(c, archive) {
    await supabase.from('clients').update({ status: archive ? 'archiwum' : 'aktywny', updated_at: new Date().toISOString() }).eq('id', c.id)
    load()
  }

  async function deleteClient(c) {
    await supabase.from('recipes').update({ client_id: null }).eq('client_id', c.id)
    await supabase.from('clients').delete().eq('id', c.id)
    setConfirmDelete(null); load()
  }

  const stats = {
    aktywni: clients.filter(c => c.status !== 'archiwum').length,
    probki: clients.filter(c => c.is_sample && c.status !== 'archiwum').length,
    archiwum: clients.filter(c => c.status === 'archiwum').length,
  }

  function fmtG(g){ const n=parseFloat(g); if(isNaN(n)) return ''; return Number.isInteger(n)?String(n):String(n) }
  function bomsForClient(id){ return bomMap[id]||[] }

  function fmtDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric' })
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Kartoteka klientów</div><div className="page-sub">Dostęp: Admin, Sprzedaż</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowy klient</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Aktywnych klientów</div><div className="stat-val">{stats.aktywni}</div></div>
        <div className="stat-card"><div className="stat-label">Tylko próbki</div><div className="stat-val" style={{ color:'#3C3489' }}>{stats.probki}</div></div>
        <div className="stat-card"><div className="stat-label">W archiwum</div><div className="stat-val" style={{ color:'#888' }}>{stats.archiwum}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6 }}>
        {[['aktywni','Aktywni'],['probki','Tylko próbki'],['archiwum','Archiwum'],['wszystkie','Wszyscy']].map(([val,label]) => (
          <button key={val} className="btn btn-sm" onClick={() => setFilterStatus(val)}
            style={{ background:filterStatus===val?'#1D9E75':undefined, color:filterStatus===val?'#fff':undefined, borderColor:filterStatus===val?'#1D9E75':undefined }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 300px)' }}>
        <table>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <SortTh col="number" label="Nr klienta" width={110} />
            <SortTh col="name" label="Nazwa klienta" />
            <SortTh col="status" label="Status" width={110} />
            <th>Uwagi</th>
            <SortTh col="created_at" label="Data dodania" width={95} />
            <SortTh col="last_sample_date" label="Ostatnia próbka" width={105} />
            <th style={{ width:70, textAlign:'center' }}>Receptur</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(c => {
              const boms = bomsForClient(c.id)
              const isExp = expandedId === c.id
              return (
              <React.Fragment key={c.id}>
              <tr style={{ opacity: c.status==='archiwum' ? 0.6 : 1 }}>
                <td style={{ textAlign:'center' }}>
                  <button onClick={() => setExpandedId(isExp?null:c.id)} title="Pokaż BOM-y" style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>{isExp?'▲':'▼'}</button>
                </td>
                <td>
                  {c.is_sample
                    ? <span className="badge b-purple" style={{ fontSize:10 }}>Próbka</span>
                    : <span className="lot">{c.number||'—'}</span>
                  }
                </td>
                <td style={{ fontWeight:500 }}>{c.name}</td>
                <td>
                  {c.status === 'archiwum'
                    ? <span className="badge b-gray">Archiwum</span>
                    : <span className={`badge ${STATUS_COLORS[c.status]||'b-gray'}`}>{STATUS_KLIENTA[c.status]||c.status}</span>
                  }
                </td>
                <td className="muted">{c.notes||'—'}</td>
                <td className="muted" style={{ fontSize:12 }}>{fmtDate(c.created_at)}</td>
                <td>
                  {c.last_sample_date
                    ? <span style={{ fontSize:12, color:'#3C3489', fontWeight:500 }}>{fmtDate(c.last_sample_date)}</span>
                    : <span className="muted">—</span>
                  }
                </td>
                <td style={{ textAlign:'center' }}><span className="badge b-info">{c.recipes?.length||0}</span></td>
                <td>
                  <div className="flex" style={{ gap:4 }}>
                    {canEdit && <button className="btn btn-sm" onClick={() => openEdit(c)}>Edytuj</button>}
                    {canEdit && c.status !== 'archiwum' && (
                      <button className="btn btn-sm" style={{ background:'#F1EFE8', color:'#5F5E5A', border:'0.5px solid #D3D1C7' }} onClick={() => archiveClient(c, true)}>Archiwizuj</button>
                    )}
                    {canEdit && c.status === 'archiwum' && (
                      <button className="btn btn-sm" style={{ background:'#E1F5EE', color:'#085041', border:'0.5px solid #1D9E75' }} onClick={() => archiveClient(c, false)}>Przywróć</button>
                    )}
                    {isAdmin && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(c)}>Usuń</button>}
                  </div>
                </td>
              </tr>
              {isExp && (
                <tr>
                  <td colSpan={9} style={{ padding:0, background:'#F9F8F5' }}>
                    <div style={{ padding:'8px 16px 12px 40px' }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#0F6E56', marginBottom:8 }}>Przypisane BOM-y — {c.name}</div>
                      {boms.length===0 ? (
                        <div className="muted" style={{ fontSize:12 }}>Brak BOM-ów. Dodaj je w zakładce Jakość → BOM.</div>
                      ) : (
                        <table style={{ width:'auto', minWidth:620 }}>
                          <thead><tr>
                            <th>Kod BOM</th><th>Receptura</th>
                            <th style={{ textAlign:'right' }}>Gramatura</th>
                            <th style={{ textAlign:'right' }}>Szt./pal.</th>
                            <th>Status</th>
                          </tr></thead>
                          <tbody>
                            {boms.map(b => (
                              <tr key={b.id} style={{ opacity: b.status==='wycofany'?0.6:1 }}>
                                <td><span className="lot">{b.code_ext||'—'}</span></td>
                                <td style={{ fontSize:12 }}>{b.recipes ? `${b.recipes.code} — ${b.recipes.name} (${b.recipes.version})` : '—'}</td>
                                <td style={{ textAlign:'right' }}>{fmtG(b.gramatura_kg)} kg</td>
                                <td style={{ textAlign:'right' }}>{b.units_per_pallet||'—'}</td>
                                <td>{b.status==='aktywny' ? <span className="badge b-ok" style={{ fontSize:10 }}>Aktywny</span> : <span className="badge b-gray" style={{ fontSize:10 }}>Wycofany</span>}</td>
                              </tr>
                            ))}
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
            {!loading && filtered.length===0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak klientów</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal nowy/edytuj */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:520 }}>
          <div className="modal-title">{editMode?'Edytuj klienta':'Nowy klient'}</div>
          {error && <div className="err-box">{error}</div>}

          {/* Próbka toggle */}
          <div style={{ marginBottom:12, padding:'10px 12px', background: form.is_sample ? '#EEEDFE' : '#F9F8F5', borderRadius:8, border:`0.5px solid ${form.is_sample ? '#AFA9EC' : '#D3D1C7'}`, display:'flex', alignItems:'center', gap:10 }}>
            <input type="checkbox" id="is_sample" checked={form.is_sample} onChange={e => f('is_sample', e.target.checked)}
              style={{ width:16, height:16, cursor:'pointer' }} />
            <label htmlFor="is_sample" style={{ cursor:'pointer', fontWeight:500, fontSize:13, color: form.is_sample ? '#3C3489' : '#1a1a18' }}>
              Klient tylko na próbkę (bez numeru klienta)
            </label>
          </div>

          <div className="fr">
            {!form.is_sample && (
              <div><label>Numer klienta *</label><input value={form.number} onChange={e => f('number',e.target.value)} placeholder="np. K-001" /></div>
            )}
            <div style={{ flex: form.is_sample ? '1' : undefined }}>
              <label>Nazwa klienta *</label>
              <input value={form.name} onChange={e => f('name',e.target.value)} placeholder="Nazwa firmy" />
            </div>
          </div>

          <div className="fr">
            <div><label>Status klienta</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                {Object.entries(STATUS_KLIENTA).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label>Data ostatniej próbki</label>
              <input type="date" value={form.last_sample_date} onChange={e => f('last_sample_date',e.target.value)} />
            </div>
          </div>

          <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="opcjonalne" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Dodaj klienta'}</button>
          </div>
        </div>
      </div>

      {/* Modal usuń */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń klienta</div>
          <div className="warn-box">Czy na pewno chcesz usunąć klienta <b>{confirmDelete?.number ? confirmDelete.number + ' — ' : ''}{confirmDelete?.name}</b>?<br/>Receptury tego klienta zostaną odłączone ale nie usunięte.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteClient(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
