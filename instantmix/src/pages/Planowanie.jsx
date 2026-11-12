import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STAGE = { planowana:'Planowana', wyprodukowana:'Wyprodukowana', anulowana:'Anulowana' }

export default function Planowanie() {
  const { profile } = useAuth()
  const canEdit = true

  const [salesNowe, setSalesNowe] = useState([])
  const [prodOrders, setProdOrders] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  // wybór zleceń sprzedaży do zaplanowania
  const [selOrders, setSelOrders] = useState([])

  // formularz zlecenia produkcji
  const [modal, setModal] = useState(false)
  const [recipeId, setRecipeId] = useState('')
  const [attached, setAttached] = useState([])        // order ids
  const [wsady, setWsady] = useState([{ planned_kg:'', bb:'1' }])
  const [bbCount, setBbCount] = useState('1')
  const [notes, setNotes] = useState('')
  const [nextSeq, setNextSeq] = useState('NNNN')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: po }, { data: rec }] = await Promise.all([
      supabase.from('orders').select('id,order_number,status,qty_units,quantity_kg,recipe_id,clients(number,name),bom(code_ext,recipe_id)').eq('status','nowe').order('ship_date',{ascending:true}),
      supabase.from('production_batches').select('id,lot_number,recipe_id,quantity_kg,client,prod_stage,notes,recipes(code,name,version),production_wsady(id,wsad_no,planned_kg,bb_plan_no),production_order_sales(order_id,orders(order_number,clients(name)))').not('prod_stage','is',null).order('lot_number',{ascending:false}),
      supabase.from('recipes').select('id,code,name,version,client,status').eq('status','dopuszczona').order('code'),
    ])
    setSalesNowe(s||[]); setProdOrders(po||[]); setRecipes(rec||[])
    setLoading(false)
  }

  const recipeOf = o => o.recipe_id || o.bom?.recipe_id || null
  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})

  // wybór: wszystkie wybrane muszą mieć tę samą recepturę
  const selRecipe = selOrders.length ? recipeOf(salesNowe.find(o=>o.id===selOrders[0])||{}) : null
  function toggleSel(o) {
    const r = recipeOf(o)
    if (selOrders.includes(o.id)) setSelOrders(selOrders.filter(x=>x!==o.id))
    else { if (selOrders.length && r!==selRecipe) return; setSelOrders([...selOrders, o.id]) }
  }

  async function peekNextSeq() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('production_batches').select('lot_number').like('lot_number',`PROD-${year}-%`).order('lot_number',{ascending:false}).limit(1)
    let n = 1
    if (data && data.length) n = (parseInt(data[0].lot_number.split('-')[2]||'0',10))+1
    return String(n).padStart(4,'0')
  }

  async function openFromSales() {
    if (!selOrders.length) return
    const r = selRecipe
    const seq = await peekNextSeq()
    const totalKg = selOrders.reduce((s,id)=>{ const o=salesNowe.find(x=>x.id===id); return s+parseFloat(o?.quantity_kg||0) },0)
    setRecipeId(r||''); setAttached([...selOrders]); setNextSeq(seq)
    setWsady([{ planned_kg: totalKg>0?String(parseFloat(totalKg.toFixed(3))):'', bb:'1' }]); setBbCount('1')
    setNotes(''); setError(''); setModal(true)
  }
  async function openStock() {
    const seq = await peekNextSeq()
    setRecipeId(''); setAttached([]); setNextSeq(seq)
    setWsady([{ planned_kg:'', bb:'1' }]); setBbCount('1'); setNotes(''); setError(''); setModal(true)
  }

  const recipe = recipes.find(r => r.id === recipeId)

  const nBB = Math.max(1, parseInt(bbCount)||1)

  // bigbagi z planu wsadów — pokazuje wszystkie zadeklarowane BB (1..nBB)
  function bigbagsPreview() {
    const groups = {}
    for (let b=1; b<=nBB; b++) groups[b] = []
    wsady.forEach((w, i) => {
      const bb = Math.min(nBB, Math.max(1, parseInt(w.bb)||1))
      groups[bb].push({ wsad_no:i+1, kg:parseFloat(w.planned_kg||0) })
    })
    return Object.keys(groups).map(Number).sort((a,b)=>a-b).map(bb => {
      const list = groups[bb]
      const code = recipe ? `${recipe.code}/${nextSeq}/${list.length?list.map(w=>'W'+w.wsad_no).join('/'):'—'}/BB${String(bb).padStart(2,'0')}` : '—'
      return { bb, list, kg: list.reduce((s,w)=>s+w.kg,0), code, over: list.length>3, empty: list.length===0 }
    })
  }
  const bbs = bigbagsPreview()
  const totalPlanned = wsady.reduce((s,w)=>s+parseFloat(w.planned_kg||0),0)

  const setW = (i,k,v) => setWsady(ws => ws.map((w,idx)=> idx===i?{...w,[k]:v}:w))
  const addW = () => setWsady(ws => [...ws, { planned_kg:'', bb:'1' }])
  const delW = i => setWsady(ws => ws.length>1 ? ws.filter((_,idx)=>idx!==i) : ws)
  function onBbCount(v) {
    setBbCount(v)
    const n = Math.max(1, parseInt(v)||1)
    setWsady(ws => ws.map(w => (parseInt(w.bb)||1) > n ? { ...w, bb:String(n) } : w))
  }

  async function save() {
    if (!recipeId) { setError('Wybierz recepturę / produkt'); return }
    if (!wsady.length || wsady.some(w => !(parseFloat(w.planned_kg)>0))) { setError('Każdy wsad musi mieć masę > 0'); return }
    if (bbs.some(b => b.over)) { setError('Bigbag może mieć maksymalnie 3 wsady'); return }
    if (bbs.some(b => b.empty)) { setError('Każdy bigbag musi mieć co najmniej 1 wsad (albo zmniejsz liczbę bigbagów)'); return }
    setSaving(true); setError('')
    const seq = await peekNextSeq()
    const year = new Date().getFullYear()
    const prodNo = `PROD-${year}-${seq}`
    const clientName = recipe?.client || (attached.length ? (salesNowe.find(o=>o.id===attached[0])?.clients?.name || null) : null)
    const { data: pb, error: e1 } = await supabase.from('production_batches').insert({
      lot_number: prodNo, recipe_id: recipeId, quantity_kg: parseFloat(totalPlanned.toFixed(3)),
      client: clientName, prod_stage: 'planowana', notes: notes||null, created_by: profile?.id,
    }).select().single()
    if (e1) { setError(e1.message); setSaving(false); return }
    const wsadyRows = wsady.map((w,i) => ({ production_batch_id: pb.id, wsad_no: i+1, planned_kg: parseFloat(w.planned_kg), bb_plan_no: parseInt(w.bb)||1 }))
    const { error: e2 } = await supabase.from('production_wsady').insert(wsadyRows)
    if (e2) { setError(e2.message); setSaving(false); return }
    if (attached.length) {
      await supabase.from('production_order_sales').insert(attached.map(id => {
        const o = salesNowe.find(x=>x.id===id)
        return { production_batch_id: pb.id, order_id: id, alloc_units: o?.qty_units||null, alloc_kg: o?.quantity_kg||null }
      }))
      await supabase.from('orders').update({ status:'zaplanowane', updated_at:new Date().toISOString() }).in('id', attached)
    }
    setSaving(false); setModal(false); setSelOrders([]); load()
  }

  async function delProd(po) {
    if (po.prod_stage!=='planowana') return
    // odczep zlecenia sprzedaży (wróć do nowe)
    const orderIds = (po.production_order_sales||[]).map(x=>x.order_id)
    if (orderIds.length) await supabase.from('orders').update({ status:'nowe' }).in('id', orderIds)
    await supabase.from('production_batches').delete().eq('id', po.id)
    load()
  }

  function bbCountOf(po) {
    const set = new Set((po.production_wsady||[]).map(w => w.bb_plan_no||1)); return set.size
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Planowanie zleceń</div><div className="page-sub">Zlecenia produkcji — wsady, bigbagi, przypięcie zleceń sprzedaży</div></div>
        <div className="flex" style={{ gap:8 }}>
          {canEdit && <button className="btn btn-sm" onClick={openStock}>+ Produkcja na magazyn</button>}
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
      </div>

      {/* Do zaplanowania */}
      <div style={{ fontSize:13, fontWeight:600, color:'#BA7517', margin:'4px 0 8px' }}>Zlecenia sprzedaży do zaplanowania ({salesNowe.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', marginBottom:8 }}>
        <table style={{ minWidth:760 }}>
          <thead><tr><th style={{width:36}}></th><th>Nr zlecenia</th><th>Klient</th><th>Wyrób (BOM)</th><th style={{textAlign:'right'}}>Ilość szt.</th><th style={{textAlign:'right'}}>Waga</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{textAlign:'center',padding:20,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && salesNowe.length===0 && <tr><td colSpan={6} style={{textAlign:'center',padding:20,color:'#888'}}>Brak nowych zleceń</td></tr>}
            {!loading && salesNowe.map(o => {
              const disabled = selOrders.length>0 && recipeOf(o)!==selRecipe && !selOrders.includes(o.id)
              return (
                <tr key={o.id} style={{ opacity: disabled?0.4:1 }}>
                  <td style={{textAlign:'center'}}><input type="checkbox" checked={selOrders.includes(o.id)} disabled={disabled} onChange={() => toggleSel(o)} /></td>
                  <td><span className="lot">{o.order_number||'—'}</span></td>
                  <td style={{fontSize:12}}>{klient(o)}</td>
                  <td style={{fontWeight:500,fontSize:12}}>{o.bom?.code_ext||'—'}</td>
                  <td style={{textAlign:'right'}}>{fmt(o.qty_units)}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>{fmt(o.quantity_kg)} kg</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex" style={{ justifyContent:'space-between', marginBottom:18, alignItems:'center' }}>
        <div className="muted" style={{ fontSize:12 }}>{selOrders.length>0 ? `Wybrano ${selOrders.length} zlec. (jedna receptura)` : 'Zaznacz zlecenia tej samej receptury, aby zaplanować razem.'}</div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={openFromSales} disabled={!selOrders.length}>Zaplanuj produkcję z wybranych →</button>}
      </div>

      {/* Zlecenia produkcji */}
      <div style={{ fontSize:13, fontWeight:600, color:'#0F6E56', margin:'4px 0 8px' }}>Zlecenia produkcji ({prodOrders.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:880 }}>
          <thead><tr><th style={{width:32}}></th><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'center'}}>Wsady</th><th style={{textAlign:'center'}}>Bigbagi</th><th style={{textAlign:'right'}}>Masa plan.</th><th>Sprzedaż</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {!loading && prodOrders.length===0 && <tr><td colSpan={9} style={{textAlign:'center',padding:20,color:'#888'}}>Brak zleceń produkcji</td></tr>}
            {prodOrders.map(po => (
              <React.Fragment key={po.id}>
                <tr>
                  <td style={{textAlign:'center'}}><button onClick={()=>setExpanded(expanded===po.id?null:po.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#5F5E5A'}}>{expanded===po.id?'▲':'▼'}</button></td>
                  <td><span className="lot">{po.lot_number}</span></td>
                  <td style={{fontSize:12,fontWeight:500}}>{po.recipes?.code} — {po.recipes?.name}</td>
                  <td style={{textAlign:'center'}}>{po.production_wsady?.length||0}</td>
                  <td style={{textAlign:'center'}}>{bbCountOf(po)}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>{fmt(po.quantity_kg)} kg</td>
                  <td style={{fontSize:11}}>{(po.production_order_sales||[]).length ? (po.production_order_sales||[]).map(x=>x.orders?.order_number).join(', ') : <span className="muted">na magazyn</span>}</td>
                  <td><span className={`badge ${po.prod_stage==='wyprodukowana'?'b-ok':po.prod_stage==='anulowana'?'b-err':'b-warn'}`} style={{fontSize:10}}>{STAGE[po.prod_stage]||po.prod_stage}</span></td>
                  <td>{canEdit && po.prod_stage==='planowana' && <button className="btn btn-sm btn-danger" onClick={()=>delProd(po)}>Usuń</button>}</td>
                </tr>
                {expanded===po.id && (
                  <tr><td colSpan={9} style={{padding:0,background:'#F9F8F5'}}>
                    <div style={{padding:'10px 16px 12px 40px'}}>
                      <div style={{fontSize:12,fontWeight:600,color:'#0F6E56',marginBottom:6}}>Wsady i bigbagi</div>
                      {(() => {
                        const seq = (po.lot_number.split('-')[2]||'')
                        const groups={}; (po.production_wsady||[]).forEach(w=>{const b=w.bb_plan_no||1;(groups[b]=groups[b]||[]).push(w)})
                        return Object.keys(groups).map(Number).sort((a,b)=>a-b).map(bb=>{
                          const list=groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no)
                          const code=`${po.recipes?.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`
                          return <div key={bb} style={{marginBottom:6,fontSize:12}}>
                            <span className="lot" style={{fontSize:11}}>{code}</span>
                            <span className="muted" style={{marginLeft:8}}>{list.map(w=>`W${w.wsad_no}: ${fmt(w.planned_kg)} kg`).join(' · ')} → razem {fmt(list.reduce((s,w)=>s+parseFloat(w.planned_kg||0),0))} kg</span>
                          </div>
                        })
                      })()}
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal nowego zlecenia produkcji */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth:760 }}>
          <div className="modal-title">Nowe zlecenie produkcji — PROD-{new Date().getFullYear()}-{nextSeq}</div>
          {error && <div className="err-box">{error}</div>}

          <div className="fr">
            <div style={{flex:2}}><label>Receptura / produkt *</label>
              <select value={recipeId} onChange={e => setRecipeId(e.target.value)} disabled={attached.length>0}>
                <option value="">— wybierz —</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.code} — {r.name} (v{r.version})</option>)}
              </select>
            </div>
            <div><label>Przypięte zlecenia</label><input value={attached.length ? attached.map(id=>salesNowe.find(o=>o.id===id)?.order_number).join(', ') : 'na magazyn'} disabled /></div>
          </div>

          <div style={{ marginTop:8 }}>
            <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <label style={{ margin:0 }}>Wsady (masa + przypisanie do bigbaga)</label>
              <div className="flex" style={{ gap:10, alignItems:'center' }}>
                <span style={{ fontSize:12, color:'#5F5E5A' }}>Liczba bigbagów:</span>
                <input type="number" min="1" step="1" value={bbCount} onChange={e=>onBbCount(e.target.value)} style={{ width:60, textAlign:'center' }} />
                <button className="btn btn-sm" onClick={addW}>+ Wsad</button>
              </div>
            </div>
            <table style={{ width:'100%' }}>
              <thead><tr><th style={{width:50}}>Wsad</th><th style={{textAlign:'right'}}>Masa (kg)</th><th style={{width:120,textAlign:'center'}}>Bigbag</th><th style={{width:40}}></th></tr></thead>
              <tbody>
                {wsady.map((w,i) => (
                  <tr key={i}>
                    <td style={{fontWeight:600}}>W{i+1}</td>
                    <td style={{textAlign:'right'}}><input type="number" step="0.001" min="0" value={w.planned_kg} onChange={e=>setW(i,'planned_kg',e.target.value)} style={{width:120,textAlign:'right'}} /></td>
                    <td style={{textAlign:'center'}}>
                      <select value={w.bb} onChange={e=>setW(i,'bb',e.target.value)} style={{width:90}}>
                        {Array.from({length:nBB},(_,k)=>k+1).map(n => <option key={n} value={String(n)}>BB{String(n).padStart(2,'0')}</option>)}
                      </select>
                    </td>
                    <td style={{textAlign:'center'}}>{wsady.length>1 && <button className="btn btn-sm btn-danger" style={{padding:'2px 7px'}} onClick={()=>delW(i)}>×</button>}</td>
                  </tr>
                ))}
                <tr style={{background:'#F1EFE8'}}><td style={{fontWeight:600,textAlign:'right'}} colSpan={1}>Razem</td><td style={{textAlign:'right',fontWeight:700}}>{fmt(totalPlanned)} kg</td><td colSpan={2}></td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginTop:10 }}>
            <label>Bigbagi (podgląd kodów)</label>
            <div style={{ background:'#F9F8F5', borderRadius:6, padding:8 }}>
              {bbs.length===0 && <div className="muted" style={{fontSize:12}}>Dodaj wsady.</div>}
              {bbs.map(b => (
                <div key={b.bb} style={{ fontSize:12, marginBottom:4, color: (b.over||b.empty)?'#A32D2D':undefined }}>
                  <span className="lot" style={{fontSize:11}}>{b.code}</span>
                  {b.empty
                    ? <span style={{marginLeft:8,fontWeight:600}}>⚠ pusty — przypisz wsad lub zmniejsz liczbę bigbagów</span>
                    : <span className="muted" style={{marginLeft:8}}>{b.list.map(w=>'W'+w.wsad_no).join('+')} · {fmt(b.kg)} kg{b.over && <b style={{color:'#A32D2D'}}> ⚠ max 3 wsady</b>}</span>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop:8 }}><label>Uwagi</label><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="opcjonalne" /></div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':'Utwórz zlecenie produkcji'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
