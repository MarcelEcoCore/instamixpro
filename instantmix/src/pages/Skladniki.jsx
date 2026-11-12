import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_ING = { code:'', name:'', status:'aktywny' }
const MAT_TYPES = ['worek','paleta','folia','etykieta','inne']
const MAT_UNITS = ['szt.','rolka','m','mb','kg','komplet','opak.']
const EMPTY_MAT = { code:'', name:'', type:'worek', unit:'szt.', segment_code:'', min_stock:'', notes:'' }

export default function Skladniki() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = true // dostępy później

  const [tab, setTab] = useState('skladniki')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // {kind, row}

  // składniki
  const [ingredients, setIngredients] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [suppliers, setSuppliers] = useState({})
  const [ingModal, setIngModal] = useState(false)
  const [ingForm, setIngForm] = useState(EMPTY_ING)
  const [ingEdit, setIngEdit] = useState(false)

  // materiały
  const [materials, setMaterials] = useState([])
  const [matModal, setMatModal] = useState(false)
  const [matForm, setMatForm] = useState(EMPTY_MAT)
  const [matEdit, setMatEdit] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: ing }, { data: mat }] = await Promise.all([
      supabase.from('ingredients').select('*').order('code'),
      supabase.from('packaging_materials').select('*').order('code'),
    ])
    setIngredients(ing || [])
    setMaterials(mat || [])
    setLoading(false)
  }

  async function loadSuppliers(ingredientId) {
    if (expandedId === ingredientId) { setExpandedId(null); return }
    const { data } = await supabase.from('ingredient_batches')
      .select('supplier_name, received_date, quantity_kg')
      .eq('ingredient_id', ingredientId).not('supplier_name', 'is', null)
      .order('received_date', { ascending: false })
    const grouped = {}
    for (const b of (data || [])) {
      const key = b.supplier_name
      if (!grouped[key]) grouped[key] = { supplier_name: key, deliveries: 0, last_delivery: b.received_date, total_kg: 0 }
      grouped[key].deliveries++; grouped[key].total_kg += parseFloat(b.quantity_kg || 0)
      if (b.received_date > grouped[key].last_delivery) grouped[key].last_delivery = b.received_date
    }
    setSuppliers(p => ({ ...p, [ingredientId]: Object.values(grouped) }))
    setExpandedId(ingredientId)
  }

  // ── Składniki CRUD ──
  const f = (k, v) => setIngForm(p => ({ ...p, [k]: v }))
  function openNewIng() { setIngForm(EMPTY_ING); setIngEdit(false); setError(''); setIngModal(true) }
  function openEditIng(ing) { setIngForm({ id: ing.id, code: ing.code, name: ing.name, status: ing.status }); setIngEdit(true); setError(''); setIngModal(true) }
  async function saveIng() {
    if (!ingForm.code || !ingForm.name) { setError('Kod i nazwa są wymagane'); return }
    setSaving(true); setError('')
    const payload = { code: ingForm.code, name: ingForm.name, status: ingForm.status }
    const { error: err } = ingEdit
      ? await supabase.from('ingredients').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', ingForm.id)
      : await supabase.from('ingredients').insert({ ...payload, created_by: profile?.id })
    setSaving(false)
    if (err) { setError(err.message); return }
    setIngModal(false); load()
  }

  // ── Materiały CRUD ──
  const mf = (k, v) => setMatForm(p => ({ ...p, [k]: v }))
  function openNewMat() { setMatForm(EMPTY_MAT); setMatEdit(false); setError(''); setMatModal(true) }
  function openEditMat(m) { setMatForm({ id:m.id, code:m.code, name:m.name, type:m.type||'worek', unit:m.unit||'szt.', segment_code:m.segment_code||'', min_stock:m.min_stock??'', notes:m.notes||'' }); setMatEdit(true); setError(''); setMatModal(true) }
  async function saveMat() {
    if (!matForm.code.trim() || !matForm.name.trim()) { setError('Kod i nazwa są wymagane'); return }
    setSaving(true); setError('')
    const payload = { code:matForm.code.trim(), name:matForm.name.trim(), type:matForm.type, unit:matForm.unit, segment_code: matForm.segment_code ? matForm.segment_code.trim().toUpperCase() : null, min_stock: matForm.min_stock===''?0:parseFloat(matForm.min_stock), notes:matForm.notes||null }
    const { error: err } = matEdit
      ? await supabase.from('packaging_materials').update({ ...payload, updated_at:new Date().toISOString() }).eq('id', matForm.id)
      : await supabase.from('packaging_materials').insert({ ...payload, active:true, created_by:profile?.id })
    setSaving(false)
    if (err) { setError(err.message); return }
    setMatModal(false); load()
  }

  async function doDelete() {
    const { kind, row } = confirmDelete
    if (kind === 'ing') await supabase.from('ingredients').delete().eq('id', row.id)
    else await supabase.from('packaging_materials').delete().eq('id', row.id)
    setConfirmDelete(null); load()
  }

  const q = search.toLowerCase()
  const ingFiltered = ingredients.filter(r => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
  const matFiltered = materials.filter(r => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.segment_code||'').toLowerCase().includes(q))

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Słownik</div><div className="page-sub">Składniki i materiały opakowaniowe — definicje</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder={tab==='skladniki'?'Szukaj składnika...':'Szukaj materiału...'} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          {canEdit && tab==='skladniki' && <button className="btn btn-primary btn-sm" onClick={openNewIng}>+ Nowy składnik</button>}
          {canEdit && tab==='materialy' && <button className="btn btn-primary btn-sm" onClick={openNewMat}>+ Nowy materiał</button>}
        </div>
      </div>

      <div className="flex" style={{ gap:6, marginBottom:12 }}>
        {[['skladniki','Składniki'],['materialy','Materiały']].map(([val,label]) => (
          <button key={val} className="btn btn-sm" onClick={() => { setTab(val); setSearch('') }}
            style={{ background:tab===val?'#1D9E75':undefined, color:tab===val?'#fff':undefined, borderColor:tab===val?'#1D9E75':undefined }}>{label}</button>
        ))}
      </div>

      {error && !ingModal && !matModal && <div className="err-box" style={{ marginBottom:10 }}>{error}</div>}

      {/* ── SKŁADNIKI ── */}
      {tab==='skladniki' && (
        <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 300px)' }}>
          <table>
            <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
              <th style={{ width: 32 }}></th><th>Kod</th><th>Nazwa składnika</th><th>Status</th><th>Dostawców</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
              {!loading && ingFiltered.map(ing => (
                <React.Fragment key={ing.id}>
                  <tr>
                    <td style={{ textAlign:'center' }}><button onClick={() => loadSuppliers(ing.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A' }}>{expandedId===ing.id?'▲':'▼'}</button></td>
                    <td><span className="lot">{ing.code}</span></td>
                    <td style={{ fontWeight:500 }}>{ing.name}</td>
                    <td><span className={`badge ${ing.status==='aktywny'?'b-ok':ing.status==='wstrzymany'?'b-err':'b-gray'}`}>{ing.status}</span></td>
                    <td className="muted">{suppliers[ing.id]?.length ?? '—'}</td>
                    <td>{canEdit && <div className="flex" style={{ gap:4 }}><button className="btn btn-sm" onClick={() => openEditIng(ing)}>Edytuj</button><button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete({kind:'ing',row:ing})}>Usuń</button></div>}</td>
                  </tr>
                  {expandedId===ing.id && (
                    <tr><td colSpan={6} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'10px 16px 12px 40px' }}>
                        <div style={{ fontSize:12, fontWeight:500, color:'#0F6E56', marginBottom:8 }}>Dostawcy z przyjęć — {ing.name}</div>
                        {!suppliers[ing.id] || suppliers[ing.id].length===0 ? <div className="muted" style={{ fontSize:12 }}>Brak przyjęć z przypisanym dostawcą</div> : (
                          <table style={{ width:'auto', minWidth:500 }}>
                            <thead><tr><th>Dostawca</th><th style={{ textAlign:'center' }}>Liczba dostaw</th><th style={{ textAlign:'right' }}>Łącznie (kg)</th><th>Ostatnia dostawa</th></tr></thead>
                            <tbody>{suppliers[ing.id].map((sup, idx) => (
                              <tr key={idx}><td style={{ fontWeight:500 }}>{sup.supplier_name}</td><td style={{ textAlign:'center' }}><span className="badge b-info">{sup.deliveries}</span></td><td style={{ textAlign:'right', fontWeight:500 }}>{sup.total_kg.toFixed(3)} kg</td><td className="muted">{sup.last_delivery}</td></tr>
                            ))}</tbody>
                          </table>
                        )}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
              {!loading && ingFiltered.length===0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MATERIAŁY ── */}
      {tab==='materialy' && (
        <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 300px)' }}>
          <table>
            <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
              <th>Kod</th><th>Nazwa materiału</th><th>Typ</th><th>Jedn.</th><th style={{ textAlign:'right' }}>Minimum</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
              {!loading && matFiltered.map(m => (
                <tr key={m.id}>
                  <td><span className="lot">{m.code}</span>{m.segment_code && <span className="badge b-purple" style={{ fontSize:9, marginLeft:4 }}>{m.segment_code}</span>}</td>
                  <td style={{ fontWeight:500 }}>{m.name}</td>
                  <td style={{ textTransform:'capitalize', fontSize:12 }}>{m.type}</td>
                  <td className="muted" style={{ fontSize:12 }}>{m.unit}</td>
                  <td style={{ textAlign:'right' }}>{m.min_stock>0 ? m.min_stock : <span className="muted">—</span>}</td>
                  <td>{canEdit && <div className="flex" style={{ gap:4 }}><button className="btn btn-sm" onClick={() => openEditMat(m)}>Edytuj</button><button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete({kind:'mat',row:m})}>Usuń</button></div>}</td>
                </tr>
              ))}
              {!loading && matFiltered.length===0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak materiałów</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal składnik */}
      <div className={`modal-overlay ${ingModal?'open':''}`} onClick={e => e.target===e.currentTarget && setIngModal(false)}>
        <div className="modal" style={{ maxWidth:400 }}>
          <div className="modal-title">{ingEdit?'Edytuj składnik':'Nowy składnik'}</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:10 }}><label>Kod składnika *</label><input value={ingForm.code} onChange={e => f('code', e.target.value)} placeholder="SKL-XXX" /></div>
          <div style={{ marginBottom:10 }}><label>Nazwa składnika *</label><input value={ingForm.name} onChange={e => f('name', e.target.value)} /></div>
          <div><label>Status</label><select value={ingForm.status} onChange={e => f('status', e.target.value)}>
            <option value="aktywny">Aktywny</option><option value="wstrzymany">Wstrzymany</option><option value="zarchiwizowany">Zarchiwizowany</option>
          </select></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setIngModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveIng} disabled={saving}>{saving?'Zapisywanie...':'Zapisz'}</button>
          </div>
        </div>
      </div>

      {/* Modal materiał */}
      <div className={`modal-overlay ${matModal?'open':''}`} onClick={e => e.target===e.currentTarget && setMatModal(false)}>
        <div className="modal" style={{ maxWidth:540 }}>
          <div className="modal-title">{matEdit?'Edytuj materiał':'Nowy materiał opakowaniowy'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Kod *</label><input value={matForm.code} onChange={e => mf('code',e.target.value)} placeholder="np. WP-10" /></div>
            <div style={{ flex:2 }}><label>Nazwa *</label><input value={matForm.name} onChange={e => mf('name',e.target.value)} placeholder="np. Worek papierowy 10 kg" /></div>
          </div>
          <div className="fr">
            <div><label>Typ</label><select value={matForm.type} onChange={e => mf('type',e.target.value)}>{MAT_TYPES.map(t => <option key={t} value={t} style={{textTransform:'capitalize'}}>{t}</option>)}</select></div>
            <div><label>Jednostka</label><select value={matForm.unit} onChange={e => mf('unit',e.target.value)}>{MAT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
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

      {/* Modal usuń */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń {confirmDelete?.kind==='mat'?'materiał':'składnik'}</div>
          <div className="warn-box">Czy na pewno usunąć <b>{confirmDelete?.row?.code} — {confirmDelete?.row?.name}</b>?</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={doDelete}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
