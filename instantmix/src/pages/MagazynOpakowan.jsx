import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const TYPES = ['worek','paleta','folia','etykieta','inne']
const UNITS = ['szt.','kg','m','rolka']
const CORR_LABELS = { korekta_inwentury:'Korekta inwentury', ubytek_uszkodzenie:'Ubytek / uszkodzenie', zwrot_do_dostawcy:'Zwrot do dostawcy', inne:'Inne' }

const EMPTY_MAT = { code:'', name:'', type:'worek', unit:'szt.', segment_code:'', min_stock:'', notes:'' }
const EMPTY_CORR = { packaging_batch_id:'', correction_type:'korekta_inwentury', delta_qty:'', reason:'', event_date:new Date().toISOString().slice(0,10) }

export default function MagazynOpakowan() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = true // dostępy później

  const [materials, setMaterials] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('wszystkie')
  const [expandedId, setExpandedId] = useState(null)
  const [editingMin, setEditingMin] = useState({})

  const [matModal, setMatModal] = useState(false)
  const [matEdit, setMatEdit] = useState(false)
  const [matForm, setMatForm] = useState(EMPTY_MAT)
  const [corrModal, setCorrModal] = useState(false)
  const [corrForm, setCorrForm] = useState(EMPTY_CORR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: m }, { data: b }] = await Promise.all([
      supabase.from('packaging_materials').select('*').order('code'),
      supabase.from('v_packaging_stock').select('*').order('received_date', { ascending: true }),
    ])
    setMaterials(m || [])
    setBatches(b || [])
    setLoading(false)
  }

  const mf = (k,v) => setMatForm(p => ({ ...p, [k]: v }))
  const cf = (k,v) => setCorrForm(p => ({ ...p, [k]: v }))

  function batchesForMat(id) { return batches.filter(b => b.packaging_material_id === id) }

  const rows = materials.map(m => {
    const bs = batchesForMat(m.id)
    const current = bs.reduce((s,b) => s + parseFloat(b.current_qty || 0), 0)
    const value = bs.reduce((s,b) => { const p = parseFloat(b.unit_price||0); const q = parseFloat(b.current_qty||0); return s + (p>0 && q>0 ? p*q : 0) }, 0)
    let avgNum=0, avgDen=0
    bs.forEach(b => { const p=parseFloat(b.unit_price||0), q=parseFloat(b.original_qty||0); if(p>0 && q>0){ avgNum+=p*q; avgDen+=q } })
    const avg = avgDen>0 ? avgNum/avgDen : null
    const min = parseFloat(m.min_stock||0)
    let alert = 'ok'
    if (current<=0) alert='empty'
    else if (min>0 && current<=min) alert='critical'
    else if (min>0 && current<=min*1.5) alert='warning'
    return { ...m, current:parseFloat(current.toFixed(3)), value:parseFloat(value.toFixed(2)), avg, min, batch_count:bs.length, alert }
  })

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    const matchQ = !q || (r.code||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q)
    const matchType = filterType==='wszystkie' ? true : r.type===filterType
    return matchQ && matchType
  })

  const totalValue = filtered.reduce((s,r) => s + r.value, 0)

  // ── Katalog materiału ──
  function openNewMat() { setMatForm(EMPTY_MAT); setMatEdit(false); setError(''); setMatModal(true) }
  function openEditMat(m) { setMatForm({ id:m.id, code:m.code, name:m.name, type:m.type||'worek', unit:m.unit||'szt.', segment_code:m.segment_code||'', min_stock:m.min_stock??'', notes:m.notes||'' }); setMatEdit(true); setError(''); setMatModal(true) }
  async function saveMat() {
    if (!matForm.code.trim() || !matForm.name.trim()) { setError('Kod i nazwa są wymagane'); return }
    setSaving(true); setError('')
    const payload = { code:matForm.code.trim(), name:matForm.name.trim(), type:matForm.type, unit:matForm.unit, segment_code: matForm.segment_code? matForm.segment_code.trim().toUpperCase() : null, min_stock: matForm.min_stock===''?0:parseFloat(matForm.min_stock), notes:matForm.notes||null }
    if (matEdit) {
      const { error: err } = await supabase.from('packaging_materials').update({ ...payload, updated_at:new Date().toISOString() }).eq('id', matForm.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('packaging_materials').insert({ ...payload, active:true, created_by:profile?.id })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setMatModal(false); load()
  }
  async function deleteMat(m) { await supabase.from('packaging_materials').delete().eq('id', m.id); setConfirmDelete(null); load() }

  async function saveMinimum(id, value) {
    await supabase.from('packaging_materials').update({ min_stock: parseFloat(value)||0 }).eq('id', id)
    setEditingMin(p => ({ ...p, [id]: undefined })); load()
  }

  // ── Korekta ──
  function openCorr(batch) { setCorrForm({ ...EMPTY_CORR, packaging_batch_id:batch.id }); setError(''); setCorrModal(true) }
  async function saveCorr() {
    if (corrForm.delta_qty==='' || isNaN(parseFloat(corrForm.delta_qty))) { setError('Podaj wartość korekty'); return }
    if (!corrForm.reason) { setError('Podaj przyczynę'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('packaging_corrections').insert({
      packaging_batch_id: corrForm.packaging_batch_id,
      correction_type: corrForm.correction_type,
      delta_qty: parseFloat(corrForm.delta_qty),
      reason: corrForm.reason,
      event_date: corrForm.event_date,
      approved_by: profile?.id,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setCorrModal(false); load()
  }

  const fmt3 = v => parseFloat(v||0).toFixed(3)
  const fmtZl = v => v>0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Magazyn opakowań</div><div className="page-sub">Materiały opakowaniowe — katalog i stany (FIFO)</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj opakowania..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNewMat}>+ Nowy materiał</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Materiałów</div><div className="stat-val">{materials.length}</div></div>
        <div className="stat-card"><div className="stat-label">Poniżej minimum</div><div className="stat-val" style={{ color:'#A32D2D' }}>{rows.filter(r=>['empty','critical'].includes(r.alert)&&r.min>0).length}</div></div>
        <div className="stat-card"><div className="stat-label">Wartość magazynu</div><div className="stat-val" style={{ fontSize:16 }}>{totalValue>0?fmtZl(totalValue):'—'}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6, flexWrap:'wrap' }}>
        {['wszystkie',...TYPES].map(t => (
          <button key={t} className="btn btn-sm" onClick={() => setFilterType(t)}
            style={{ background:filterType===t?'#1D9E75':undefined, color:filterType===t?'#fff':undefined, borderColor:filterType===t?'#1D9E75':undefined, textTransform:'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <th>Kod</th><th>Nazwa</th><th>Typ</th><th>Jedn.</th>
            <th style={{ textAlign:'right' }}>Stan aktualny</th>
            <th style={{ textAlign:'right' }}>Wartość</th>
            <th style={{ textAlign:'right' }}>Minimum</th>
            <th style={{ textAlign:'right' }}>Śr. cena zakupu</th>
            <th>Status</th>
            <th style={{ textAlign:'center' }}>Partii</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={12} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={12} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak materiałów</td></tr>}
            {!loading && filtered.map(r => {
              const isExpanded = expandedId===r.id
              const bs = batchesForMat(r.id)
              return (
                <React.Fragment key={r.id}>
                  <tr style={{ background: r.alert==='empty'?'#F9F8F5' : r.alert==='critical'?'#FCEBEB55' : undefined }}>
                    <td style={{ textAlign:'center' }}>
                      <button onClick={() => setExpandedId(isExpanded?null:r.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>{isExpanded?'▲':'▼'}</button>
                    </td>
                    <td><span className="lot">{r.code}</span>{r.segment_code && <span className="badge b-purple" style={{ fontSize:9, marginLeft:4 }}>{r.segment_code}</span>}</td>
                    <td style={{ fontWeight:500 }}>{r.name}</td>
                    <td style={{ textTransform:'capitalize' }}><span className="badge b-info" style={{ fontSize:10 }}>{r.type||'—'}</span></td>
                    <td className="muted" style={{ fontSize:12 }}>{r.unit}</td>
                    <td style={{ textAlign:'right', fontWeight:700, fontSize:14, color:r.current<=0?'#888':'#0F6E56' }}>{fmt3(r.current)}</td>
                    <td style={{ textAlign:'right', fontSize:12, color:'#3C3489' }}>{fmtZl(r.value)}</td>
                    <td style={{ textAlign:'right' }}>
                      {isAdmin ? (
                        editingMin[r.id]!==undefined ? (
                          <span className="flex" style={{ gap:4, justifyContent:'flex-end' }}>
                            <input type="number" step="1" min="0" defaultValue={editingMin[r.id]} id={`min-${r.id}`} style={{ width:70, padding:'3px 6px', fontSize:12 }}
                              onKeyDown={e => { if(e.key==='Enter') saveMinimum(r.id,e.target.value); if(e.key==='Escape') setEditingMin(p=>({...p,[r.id]:undefined})) }} />
                            <button className="btn btn-sm btn-primary" style={{ padding:'3px 8px', fontSize:11 }} onClick={() => saveMinimum(r.id, document.getElementById(`min-${r.id}`).value)}>OK</button>
                          </span>
                        ) : (
                          <span onClick={() => setEditingMin(p=>({...p,[r.id]:r.min}))} style={{ cursor:'pointer', borderBottom:'1px dashed #B4B2A9' }}>{r.min>0?fmt3(r.min):<span className="muted">ustaw →</span>}</span>
                        )
                      ) : (r.min>0?fmt3(r.min):'—')}
                    </td>
                    <td style={{ textAlign:'right', fontSize:12, color: r.avg!=null?'#0C447C':'#888' }}>{r.avg!=null?fmtZl(r.avg):'—'}</td>
                    <td>
                      {r.alert==='empty' ? <span className="badge b-err" style={{ fontSize:10 }}>Brak</span>
                        : r.alert==='critical' ? <span className="badge b-err" style={{ fontSize:10 }}>Krytyczny</span>
                        : r.alert==='warning' ? <span className="badge b-warn" style={{ fontSize:10 }}>Niski</span>
                        : <span className="badge b-ok" style={{ fontSize:10 }}>OK</span>}
                    </td>
                    <td style={{ textAlign:'center', color:'#5F5E5A' }}>{r.batch_count}</td>
                    <td>
                      <div className="flex" style={{ gap:4 }}>
                        {canEdit && <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => openEditMat(r)}>Edytuj</button>}
                        {isAdmin && <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => setConfirmDelete(r)}>Usuń</button>}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={12} style={{ padding:0, background:'#F9F8F5' }}>
                        <div style={{ padding:'8px 16px 12px 40px' }}>
                          <div style={{ fontSize:12, fontWeight:500, color:'#0F6E56', marginBottom:8 }}>Partie — {r.name}</div>
                          {bs.length===0 ? <div className="muted" style={{ fontSize:12 }}>Brak przyjęć. Stan pojawia się po przyjęciu dostawy w dziale Jakość → Przyjęcie dostawy.</div> : (
                            <table style={{ width:'auto', minWidth:720 }}>
                              <thead><tr>
                                <th>Nr partii</th><th>Dostawca</th><th>Data</th>
                                <th style={{ textAlign:'right' }}>Przyjęto</th><th style={{ textAlign:'right' }}>Korekty</th>
                                <th style={{ textAlign:'right' }}>Stan</th><th style={{ textAlign:'right' }}>Cena</th>
                                <th>Lokalizacja</th><th></th>
                              </tr></thead>
                              <tbody>
                                {bs.map(b => (
                                  <tr key={b.id} style={{ background: parseFloat(b.current_qty)<=0 ? '#F1EFE8' : '#fff' }}>
                                    <td><span className="lot" style={{ fontSize:11 }}>{b.delivery_lot||'—'}</span></td>
                                    <td style={{ fontSize:12 }}>{b.supplier_name||'—'}</td>
                                    <td className="muted" style={{ fontSize:11 }}>{b.received_date}</td>
                                    <td style={{ textAlign:'right', fontSize:12 }}>{fmt3(b.original_qty)}</td>
                                    <td style={{ textAlign:'right', fontSize:11, color:parseFloat(b.corrections_qty)<0?'#A32D2D':parseFloat(b.corrections_qty)>0?'#085041':'#888' }}>{parseFloat(b.corrections_qty)!==0?(parseFloat(b.corrections_qty)>0?'+':'')+fmt3(b.corrections_qty):'—'}</td>
                                    <td style={{ textAlign:'right', fontWeight:700, fontSize:12, color:parseFloat(b.current_qty)<=0?'#888':'#0F6E56' }}>{fmt3(b.current_qty)}</td>
                                    <td style={{ textAlign:'right', fontSize:12 }}>{b.unit_price!=null?fmtZl(parseFloat(b.unit_price)):'—'}</td>
                                    <td className="muted" style={{ fontSize:11 }}>{b.warehouse_location||'—'}</td>
                                    <td><div className="flex" style={{ gap:4, justifyContent:'flex-end' }}>
                                      {canEdit && <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px', background:'#FFF3E0', color:'#E65100', border:'0.5px solid #FFCC80' }} onClick={() => openCorr(b)}>Korekta</button>}
                                    </div></td>
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
          </tbody>
        </table>
      </div>

      {/* Modal materiał */}
      <div className={`modal-overlay ${matModal?'open':''}`} onClick={e => e.target===e.currentTarget && setMatModal(false)}>
        <div className="modal" style={{ maxWidth:520 }}>
          <div className="modal-title">{matEdit?'Edytuj materiał':'Nowy materiał opakowaniowy'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Kod *</label><input value={matForm.code} onChange={e => mf('code',e.target.value)} placeholder="np. WP-10" /></div>
            <div style={{ flex:2 }}><label>Nazwa *</label><input value={matForm.name} onChange={e => mf('name',e.target.value)} placeholder="np. Worek papierowy 10 kg" /></div>
          </div>
          <div className="fr">
            <div><label>Typ</label><select value={matForm.type} onChange={e => mf('type',e.target.value)}>{TYPES.map(t => <option key={t} value={t} style={{textTransform:'capitalize'}}>{t}</option>)}</select></div>
            <div><label>Jednostka</label><select value={matForm.unit} onChange={e => mf('unit',e.target.value)}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
            <div><label>Minimum</label><input type="number" step="1" min="0" value={matForm.min_stock} onChange={e => mf('min_stock',e.target.value)} /></div>
          </div>
          <div><label>Kod segmentu BOM <span className="muted" style={{ fontWeight:400 }}>(np. WP = worek papierowy, PE = paleta euro)</span></label><input value={matForm.segment_code} onChange={e => mf('segment_code',e.target.value)} placeholder="np. WP" style={{ textTransform:'uppercase', maxWidth:160 }} /></div>
          <div><label>Uwagi</label><input value={matForm.notes} onChange={e => mf('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setMatModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveMat} disabled={saving}>{saving?'Zapisywanie...':matEdit?'Zapisz zmiany':'Dodaj materiał'}</button>
          </div>
        </div>
      </div>

      {/* Modal korekta */}
      <div className={`modal-overlay ${corrModal?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Korekta stanu opakowań</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ korekty</label>
              <select value={corrForm.correction_type} onChange={e => cf('correction_type',e.target.value)}>
                {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label>Korekta ilości — ujemna = ubytek</label><input type="number" step="0.001" value={corrForm.delta_qty} onChange={e => cf('delta_qty',e.target.value)} placeholder="np. -5 lub +10" /></div>
          </div>
          <div style={{ marginBottom:10 }}><label>Przyczyna *</label><input value={corrForm.reason} onChange={e => cf('reason',e.target.value)} placeholder="np. uszkodzenie palety" /></div>
          <div><label>Data zdarzenia</label><input type="date" value={corrForm.event_date} onChange={e => cf('event_date',e.target.value)} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrModal(false)}>Anuluj</button>
            <button className="btn btn-danger" onClick={saveCorr} disabled={saving}>{saving?'Zapisywanie...':'Zapisz korektę'}</button>
          </div>
        </div>
      </div>

      {/* Usuń materiał */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń materiał</div>
          <div className="warn-box">Usunąć materiał <b>{confirmDelete?.code} — {confirmDelete?.name}</b>? Usunie też jego partie i korekty.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteMat(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
