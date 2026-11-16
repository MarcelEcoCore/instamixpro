import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_FORM = { code:'', name:'', version:'v1', status:'w_przegladzie', production_line:'zwykla', approved_at:'', change_date:'', notes:'', client:'', client_id:'', hydration:'' }

export default function Receptury() {
  const { profile } = useAuth()
  const canEdit = ['admin','technolog'].includes(profile?.role)

  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('dopuszczone')
  const [expandedId, setExpandedId] = useState(null)
  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [dupModal, setDupModal] = useState(false)
  const [dupSource, setDupSource] = useState(null)
  const [dupForm, setDupForm] = useState({ code:'', client:'', client_id:'' })
  const [form, setForm] = useState(EMPTY_FORM)
  const [items, setItems] = useState([{ ingredient_id:'', percentage:'' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: r }, { data: i }, { data: c }] = await Promise.all([
      supabase.from('recipes').select('*, recipe_items(*, ingredients(*))').order('code'),
      supabase.from('ingredients').select('id,code,name,has_allergen,allergen_type').eq('status','aktywny').order('code'),
      supabase.from('clients').select('id,number,name').order('number')
    ])
    setRecipes(r || [])
    setIngredients(i || [])
    setClients(c || [])
    setLoading(false)
  }

  const filtered = recipes.filter(r => {
    const matchQ = r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase()) ||
      (r.client||'').toLowerCase().includes(search.toLowerCase())
    const matchClient = !filterClient || r.client_id === filterClient
    const matchStatus = filterStatus === 'wszystkie' ? true :
      filterStatus === 'dopuszczone' ? r.status === 'dopuszczona' :
      filterStatus === 'w_przegladzie' ? r.status === 'w_przegladzie' :
      filterStatus === 'zarchiwizowane' ? r.status === 'zarchiwizowana' : true
    return matchQ && matchClient && matchStatus
  })

  // sortowanie: najpierw po NUMERZE KLIENTA, potem po KODZIE; bez numeru klienta → na dół
  const clientNumById = {}
  clients.forEach(c => { clientNumById[c.id] = (c.number != null && c.number !== '') ? parseInt(c.number) : null })
  function clientRank(r) {
    const n = r.client_id ? clientNumById[r.client_id] : null
    return (n == null || isNaN(n)) ? Infinity : n
  }
  const sorted = [...filtered].sort((a, b) => {
    const na = clientRank(a), nb = clientRank(b)
    if (na !== nb) return na - nb
    return (a.code || '').localeCompare(b.code || '', 'pl', { numeric: true })
  })

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function openNew() { setEditMode(false); setForm(EMPTY_FORM); setItems([{ ingredient_id:'', percentage:'' }]); setError(''); setModal(true) }

  function openEdit(recipe) {
    setEditMode(true)
    setForm({ id:recipe.id, code:recipe.code, name:recipe.name, version:recipe.version, status:recipe.status, production_line:recipe.production_line, approved_at:recipe.approved_at||'', change_date:recipe.change_date||'', notes:recipe.notes||'', client:recipe.client||'', client_id:recipe.client_id||'', hydration:recipe.hydration||'' })
    const sorted = (recipe.recipe_items||[]).sort((a,b) => a.sort_order-b.sort_order)
    setItems(sorted.length > 0 ? sorted.map(it => ({ id:it.id, ingredient_id:it.ingredient_id, percentage:it.percentage })) : [{ ingredient_id:'', percentage:'' }])
    setError(''); setModal(true)
  }

  function openDuplicate(recipe) {
    setDupSource(recipe)
    setDupForm({ code:'', version:'v2', client: recipe.client||'', client_id: recipe.client_id||'' })
    setError(''); setDupModal(true)
  }

  async function saveDuplicate() {
    if (!dupForm.code) { setError('Podaj nowy kod dla duplikatu'); return }

    setSaving(true); setError('')
    const { data: rec, error: err } = await supabase.from('recipes').insert({
      code: dupForm.code, name: dupSource.name, version: dupForm.version || dupSource.version,
      status: 'w_przegladzie', production_line: dupSource.production_line,
      approved_at: null, change_date: null, notes: dupSource.notes,
      client: dupForm.client || null, client_id: dupForm.client_id || null,
      hydration: dupSource.hydration || null,
      approved_by: profile?.id
    }).select().single()
    if (err) { setError(err.message); setSaving(false); return }
    const srcItems = (dupSource.recipe_items||[]).filter(it => it.ingredient_id)
    if (srcItems.length > 0) {
      await supabase.from('recipe_items').insert(
        srcItems.map((it, idx) => ({ recipe_id: rec.id, ingredient_id: it.ingredient_id, percentage: it.percentage, sort_order: idx }))
      )
    }
    setSaving(false); setDupModal(false); load()
  }

  function addItem() { setItems(p => [...p, { ingredient_id:'', percentage:'' }]) }
  function removeItem(i) { setItems(p => p.filter((_,idx) => idx!==i)) }
  function updateItem(i, k, v) { setItems(p => p.map((it,idx) => idx===i ? {...it,[k]:v} : it)) }
  const totalPct = items.reduce((s,it) => s+(parseFloat(it.percentage)||0), 0)
  const pctOk = Math.abs(totalPct-100) < 0.01

  async function save() {
    if (!form.code || !form.name) { setError('Kod i nazwa są wymagane'); return }
    if (!pctOk) { setError(`Suma udziałów musi wynosić 100% (aktualnie: ${totalPct.toFixed(3)}%)`); return }
    const validItems = items.filter(it => it.ingredient_id && it.percentage)
    if (validItems.length === 0) { setError('Dodaj co najmniej jeden składnik'); return }
    setSaving(true); setError('')
    const payload = { code:form.code, name:form.name, version:form.version, status:form.status, production_line:form.production_line, approved_at:form.approved_at||null, change_date:form.change_date||null, notes:form.notes||null, client:form.client||null, client_id:form.client_id||null, hydration:form.hydration||null, approved_by:profile?.id, updated_at:new Date().toISOString() }
    let recipeId = form.id
    if (editMode) {
      const { error: err } = await supabase.from('recipes').update(payload).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
      await supabase.from('recipe_items').delete().eq('recipe_id', form.id)
    } else {
      const { data: rec, error: err } = await supabase.from('recipes').insert(payload).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      recipeId = rec.id
    }
    await supabase.from('recipe_items').insert(
      validItems.map((it,idx) => ({ recipe_id:recipeId, ingredient_id:it.ingredient_id, percentage:parseFloat(it.percentage), sort_order:idx }))
    )
    setSaving(false); setModal(false); load()
  }

  async function quickStatusChange(recipe, newStatus) {
    await supabase.from('recipes').update({ status:newStatus, updated_at:new Date().toISOString() }).eq('id', recipe.id)
    load()
  }

  async function deleteRecipe(recipe) {
    setError('')
    // Sprawdź powiązania, które blokują usunięcie (bez kaskady w bazie)
    const [{ count: bomCnt }, { count: prodCnt }] = await Promise.all([
      supabase.from('bom').select('id', { count:'exact', head:true }).eq('recipe_id', recipe.id),
      supabase.from('production_batches').select('id', { count:'exact', head:true }).eq('recipe_id', recipe.id),
    ])
    if ((bomCnt||0) > 0 || (prodCnt||0) > 0) {
      setError(`Nie można usunąć — receptura jest powiązana z ${bomCnt||0} BOM i ${prodCnt||0} produkcjami. Najpierw usuń powiązane BOM-y i produkcje tej receptury.`)
      return
    }
    await supabase.from('recipe_items').delete().eq('recipe_id', recipe.id)
    const { error: err } = await supabase.from('recipes').delete().eq('id', recipe.id)
    if (err) { setError(err.code==='23503' ? 'Nie można usunąć — receptura jest jeszcze gdzieś używana.' : err.message); return }
    setConfirmDelete(null); load()
  }

  const [copiedId, setCopiedId] = useState(null)

  function copyRecipeToClipboard(recipe) {
    const items = (recipe.recipe_items||[]).sort((a,b) => a.sort_order - b.sort_order)
    // Użyj przecinka jako separatora dziesiętnego (polski Excel)
    const num = v => String(parseFloat(v).toFixed(3)).replace('.', ',')
    const header = ['Kod składnika', 'Nazwa składnika', 'Udział %', 'Na 100 kg (kg)', 'Alergen'].join('\t')
    // Udział % jako ułamek dziesiętny (0,6 = 60%) — Excel formatuje jako procenty
    const pct = v => String((parseFloat(v) / 100).toFixed(5)).replace('.', ',')
    const rows = items.map(it => [
      it.ingredients?.code || '',
      it.ingredients?.name || '',
      pct(it.percentage),
      num(it.percentage),
      it.ingredients?.has_allergen ? it.ingredients.allergen_type : ''
    ].join('\t'))
    const suma = num(items.reduce((s,it)=>s+parseFloat(it.percentage),0))
    const info = [
      `Receptura:\t${recipe.code} — ${recipe.name} (${recipe.version})`,
      `Klient:\t${recipe.client || '—'}`,
      `Linia:\t${recipe.production_line}`,
      `Status:\t${recipe.status}`,
      '',
      header,
      ...rows,
      '',
      `SUMA:\t\t${suma}\t${suma}`
    ].join('\n')
    navigator.clipboard.writeText(info).then(() => {
      setCopiedId(recipe.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Receptury</div><div className="page-sub">Dostęp: Admin, Technolog</div></div>
        <div className="flex" style={{ gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input className="search" placeholder="Szukaj receptury..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:180 }} />
          <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ fontSize:13 }}>
            <option value="">— wszyscy klienci —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
          </select>
          {filterClient && <button className="btn btn-sm" onClick={() => setFilterClient('')}>✕</button>}
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowa receptura</button>}
        </div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6, flexWrap:'wrap' }}>
        {[['dopuszczone','Dopuszczone'],['wszystkie','Wszystkie'],['w_przegladzie','W przeglądzie'],['zarchiwizowane','Zarchiwizowane']].map(([val,label]) => (
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
            <th>Kod</th><th>Klient</th><th>Nazwa mieszanki</th><th>Wersja</th><th>Linia</th>
            <th>Skł.</th><th>Status</th><th>Data zatw.</th><th>Data zmiany</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={11} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && sorted.map(r => (
              <React.Fragment key={r.id}>
                <tr>
                  <td style={{ textAlign:'center' }}>
                    <button onClick={() => setExpandedId(expandedId===r.id ? null : r.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                      {expandedId===r.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className="lot">{r.code}</span></td>
                  <td style={{ fontSize:12 }}>
                    {r.client
                      ? <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'1px 8px', borderRadius:999, fontSize:11, fontWeight:500 }}>{r.client}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td style={{ fontWeight:500 }}>{r.name}</td>
                  <td><span className="badge b-info">{r.version}</span></td>
                  <td><span className={`badge ${r.production_line==='bezglutenowa'?'b-purple':'b-gray'}`}>{r.production_line}</span></td>
                  <td>{r.recipe_items?.length||0}</td>
                  <td>
                    {canEdit ? (
                      <select value={r.status} onChange={e => quickStatusChange(r, e.target.value)}
                        style={{ fontSize:11, padding:'2px 6px', border:'0.5px solid #D3D1C7', borderRadius:6, background:r.status==='dopuszczona'?'#E1F5EE':r.status==='w_przegladzie'?'#FAEEDA':'#F1EFE8', color:r.status==='dopuszczona'?'#085041':r.status==='w_przegladzie'?'#633806':'#444441', cursor:'pointer' }}>
                        <option value="dopuszczona">Dopuszczona</option>
                        <option value="w_przegladzie">W przeglądzie</option>
                        <option value="zarchiwizowana">Zarchiwizowana</option>
                      </select>
                    ) : (
                      <span className={`badge ${r.status==='dopuszczona'?'b-ok':r.status==='w_przegladzie'?'b-warn':'b-gray'}`}>{r.status}</span>
                    )}
                  </td>
                  <td className="muted">{r.approved_at||'—'}</td>
                  <td className="muted">{r.change_date||'—'}</td>
                  <td>
                    <div className="flex" style={{ gap:4 }}>
                      {canEdit && <button className="btn btn-sm" onClick={() => openEdit(r)}>Edytuj</button>}
                      {canEdit && <button className="btn btn-sm" style={{ background:'#EEEDFE', color:'#3C3489', border:'0.5px solid #AFA9EC' }} onClick={() => openDuplicate(r)}>Duplikuj</button>}
                      {canEdit && <button className="btn btn-sm btn-danger" onClick={() => { setError(''); setConfirmDelete(r) }}>Usuń</button>}
                    </div>
                  </td>
                </tr>
                {expandedId===r.id && (
                  <tr>
                    <td colSpan={11} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'10px 16px 12px 40px' }}>
                        {r.client && (
                          <div style={{ marginBottom:8 }}>
                            <span className="muted" style={{ marginRight:6 }}>Klient:</span>
                            <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'2px 8px', borderRadius:999, fontSize:12 }}>{r.client}</span>
                          </div>
                        )}
                        {r.notes && <div className="muted" style={{ marginBottom:8, fontSize:12 }}>Uwagi: {r.notes}</div>}
                        <div style={{ marginBottom:8 }}>
                          <button
                            className="btn btn-sm"
                            style={{ background: copiedId===r.id ? '#E1F5EE' : undefined, color: copiedId===r.id ? '#085041' : undefined, fontSize:11 }}
                            onClick={() => copyRecipeToClipboard(r)}
                          >
                            {copiedId===r.id ? '✓ Skopiowano!' : '📋 Kopiuj do Excela'}
                          </button>
                          <span className="muted" style={{ fontSize:11, marginLeft:8 }}>Wklej Ctrl+V w Excelu — liczby zostaną rozpoznane automatycznie</span>
                        </div>
                        <table style={{ width:'auto', minWidth:500 }}>
                          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
                            <th>Kod skł.</th><th>Nazwa składnika</th>
                            <th style={{ textAlign:'right' }}>Udział %</th>
                            <th style={{ textAlign:'right' }}>Na 100 kg</th>
                            <th>Alergen</th>
                          </tr></thead>
                          <tbody>
                            {(r.recipe_items||[]).sort((a,b)=>a.sort_order-b.sort_order).map(it => (
                              <tr key={it.id}>
                                <td><span className="lot">{it.ingredients?.code}</span></td>
                                <td>{it.ingredients?.name}</td>
                                <td style={{ textAlign:'right', fontWeight:500 }}>{parseFloat(it.percentage).toFixed(3)}%</td>
                                <td style={{ textAlign:'right' }}>{parseFloat(it.percentage).toFixed(3)} kg</td>
                                <td>{it.ingredients?.has_allergen ? <span className="badge b-err">{it.ingredients.allergen_type}</span> : <span className="muted">—</span>}</td>
                              </tr>
                            ))}
                            <tr style={{ background:'#E1F5EE' }}>
                              <td colSpan={2} style={{ fontWeight:500, textAlign:'right' }}>SUMA</td>
                              <td style={{ fontWeight:500, textAlign:'right' }}>{(r.recipe_items||[]).reduce((s,it)=>s+parseFloat(it.percentage),0).toFixed(3)}%</td>
                              <td style={{ fontWeight:500, textAlign:'right' }}>100.000 kg</td>
                              <td></td>
                            </tr>
                            {r.hydration && (
                              <tr>
                                <td colSpan={5} style={{ padding:0 }}>
                                  <div style={{ background:'#FFF8E1', border:'1px solid #FFD54F', borderRadius:6, margin:'6px 0 2px 0', padding:'7px 14px', display:'flex', alignItems:'center', gap:10 }}>
                                    <span style={{ fontSize:13, fontWeight:700, color:'#E65100', letterSpacing:0.5 }}>UWODNIENIE</span>
                                    <span style={{ fontSize:13, color:'#5D4037', fontWeight:500 }}>{r.hydration}</span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={11} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal dodaj/edytuj */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:600 }}>
          <div className="modal-title">{editMode?'Edytuj recepturę':'Nowa receptura'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Kod mieszanki</label><input value={form.code} onChange={e => f('code',e.target.value)} placeholder="MIX-XXX" /></div>
            <div><label>Nazwa mieszanki</label><input value={form.name} onChange={e => f('name',e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Wersja</label><input value={form.version} onChange={e => f('version',e.target.value)} placeholder="v1" /></div>
            <div><label>Linia produkcyjna</label>
              <select value={form.production_line} onChange={e => f('production_line',e.target.value)}>
                <option value="zwykla">Zwykła</option><option value="bezglutenowa">Bezglutenowa</option>
              </select>
            </div>
            <div><label>Status</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                <option value="w_przegladzie">W przeglądzie</option>
                <option value="dopuszczona">Dopuszczona</option>
                <option value="zarchiwizowana">Zarchiwizowana</option>
              </select>
            </div>
          </div>
          <div className="fr">
            <div><label>Data zatwierdzenia</label><input type="date" value={form.approved_at} onChange={e => f('approved_at',e.target.value)} /></div>
            <div><label>Data zmiany (nowej wersji)</label><input type="date" value={form.change_date} onChange={e => f('change_date',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} /></div>
            <div style={{ marginBottom:0 }}>
              <label>Klient</label>
              <select value={form.client_id||''} onChange={e => {
                const c = clients.find(x => x.id === e.target.value)
                f('client_id', e.target.value)
                f('client', c ? c.name : '')
              }}>
                <option value="">— brak / wybierz klienta —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Uwodnienie (informacja technologiczna)</label>
            <input value={form.hydration} onChange={e => f('hydration',e.target.value)} placeholder="np. uwodnienie 1-5,4" />
          </div>
          <div className="divider"/>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ fontWeight:500, fontSize:13 }}>Składniki receptury</span>
            <span style={{ fontSize:12, color:pctOk?'#085041':'#A32D2D', fontWeight:500 }}>
              Suma: {totalPct.toFixed(3)}% {pctOk?'✓':`(brakuje ${(100-totalPct).toFixed(3)}%)`}
            </span>
          </div>
          {items.map((it,idx) => (
            <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 110px 32px', gap:8, marginBottom:8, alignItems:'end' }}>
              <div>
                {idx===0 && <label>Składnik</label>}
                <select value={it.ingredient_id} onChange={e => updateItem(idx,'ingredient_id',e.target.value)}>
                  <option value="">— wybierz —</option>
                  {ingredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                </select>
              </div>
              <div>
                {idx===0 && <label>Udział %</label>}
                <input type="number" step="0.001" min="0" max="100" value={it.percentage} onChange={e => updateItem(idx,'percentage',e.target.value)} placeholder="0.000" />
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => removeItem(idx)} style={{ height:34 }}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addItem} style={{ marginBottom:4 }}>+ Dodaj składnik</button>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Zapisz recepturę'}</button>
          </div>
        </div>
      </div>

      {/* Modal duplikowanie */}
      <div className={`modal-overlay ${dupModal?'open':''}`} onClick={e => e.target===e.currentTarget && setDupModal(false)}>
        <div className="modal" style={{ maxWidth:440 }}>
          <div className="modal-title">Duplikuj recepturę</div>
          <div className="info-box" style={{ marginBottom:12 }}>
            Duplikujesz: <b>{dupSource?.code} — {dupSource?.name}</b><br/>
            Duplikat otrzyma status "W przeglądzie" i będzie wymagał zatwierdzenia.
          </div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Kod mieszanki dla duplikatu *</label>
              <input value={dupForm.code} onChange={e => setDupForm(p=>({...p,code:e.target.value}))} placeholder={dupSource?.code} />
            </div>
            <div><label>Wersja *</label>
              <input value={dupForm.version} onChange={e => setDupForm(p=>({...p,version:e.target.value}))} placeholder="v2" />
            </div>
          </div>
          <div>
            <label>Klient dla duplikatu</label>
            <select value={dupForm.client_id||''} onChange={e => {
              const c = clients.find(x => x.id === e.target.value)
              setDupForm(p => ({...p, client_id: e.target.value, client: c ? c.name : ''}))
            }}>
              <option value="">— brak / wybierz klienta —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setDupModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveDuplicate} disabled={saving}>{saving?'Duplikowanie...':'Utwórz duplikat'}</button>
          </div>
        </div>
      </div>

      {/* Potwierdzenie usunięcia */}
      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń recepturę</div>
          <div className="warn-box">Czy na pewno chcesz usunąć <b>{confirmDelete?.code} — {confirmDelete?.name}</b>?<br/>Historia produkcji pozostanie nienaruszona.</div>
          {error && <div className="err-box" style={{ marginTop:8 }}>{error}</div>}
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteRecipe(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
