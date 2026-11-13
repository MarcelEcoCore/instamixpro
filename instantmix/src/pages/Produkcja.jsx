import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Produkcja() {
  const { profile } = useAuth()
  const canEdit = true

  const [view, setView] = useState('list')      // 'list' | 'produce'
  const [planned, setPlanned] = useState([])
  const [done, setDone] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  // panel produkcji
  const [order, setOrder] = useState(null)
  const [recipe, setRecipe] = useState(null)
  const [items, setItems] = useState([])         // recipe_items
  const [availByIng, setAvailByIng] = useState({})
  const [ingMap, setIngMap] = useState({})
  const [picks, setPicks] = useState({})         // `${wsadId}|${ingId}` -> {batchId, qty}
  const [operator, setOperator] = useState('')
  const [foreman, setForeman] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const sel = 'id,lot_number,recipe_id,quantity_kg,client,prod_stage,recipes(code,name,version),production_wsady(id,wsad_no,planned_kg,bb_plan_no),production_order_sales(order_id)'
    const [{ data: p }, { data: d }] = await Promise.all([
      supabase.from('production_batches').select(sel).eq('prod_stage','planowana').order('lot_number'),
      supabase.from('production_batches').select('id,lot_number,recipe_id,quantity_kg,prod_stage,produced_at,recipes(code,name)').eq('prod_stage','wyprodukowana').order('produced_at',{ascending:false}).limit(20),
    ])
    setPlanned(p||[]); setDone(d||[])
    setLoading(false)
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})
  const bbCountOf = o => new Set((o.production_wsady||[]).map(w=>w.bb_plan_no||1)).size

  async function openProduce(o) {
    setError('')
    const [{ data: rec }, { data: stock }, { data: used }, { data: ings }] = await Promise.all([
      supabase.from('recipes').select('id,code,name,version,recipe_items(sort_order,percentage,ingredient_id,ingredients(code,name,has_allergen,allergen_type))').eq('id', o.recipe_id).single(),
      supabase.from('v_stock').select('id,ingredient_id,delivery_lot,current_kg,received_date').order('received_date',{ascending:true}),
      supabase.from('production_batch_items').select('ingredient_batch_id,quantity_used_kg'),
      supabase.from('ingredients').select('id,code,name'),
    ])
    const usedMap = {}; (used||[]).forEach(u => { if(u.ingredient_batch_id) usedMap[u.ingredient_batch_id]=(usedMap[u.ingredient_batch_id]||0)+parseFloat(u.quantity_used_kg||0) })
    const avail = {}
    ;(stock||[]).forEach(s => {
      const a = parseFloat(s.current_kg)-(usedMap[s.id]||0)
      if (a>0.001) (avail[s.ingredient_id]=avail[s.ingredient_id]||[]).push({ id:s.id, lot:s.delivery_lot, available:parseFloat(a.toFixed(3)) })
    })
    const im={}; (ings||[]).forEach(x=>{im[x.id]=x})
    const ri = [...(rec?.recipe_items||[])].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
    // domyślne wybory: pierwsza partia + ilość = cel (% × masa wsadu)
    const pk = {}
    ;(o.production_wsady||[]).forEach(w => {
      ri.forEach(it => {
        const target = parseFloat(((parseFloat(w.planned_kg||0)*parseFloat(it.percentage||0))/100).toFixed(3))
        const first = (avail[it.ingredient_id]||[])[0]
        pk[`${w.id}|${it.ingredient_id}`] = { batchId: first?.id||'', qty: String(target) }
      })
    })
    setOrder(o); setRecipe(rec); setItems(ri); setAvailByIng(avail); setIngMap(im); setPicks(pk)
    setOperator(''); setForeman(''); setView('produce')
  }

  const setPick = (key, field, val) => setPicks(p => ({ ...p, [key]: { ...p[key], [field]: val } }))

  function lotCode(seq, bbno) {
    const now=new Date(), yy=String(now.getFullYear()).slice(2), mm=String(now.getMonth()+1).padStart(2,'0'), dd=String(now.getDate()).padStart(2,'0')
    return `L${yy}${mm}${dd}${seq}${String(bbno).padStart(2,'0')}`
  }

  async function confirmProduce() {
    if (!order) return
    // walidacja: każdy pick ma partię i ilość>0
    for (const w of (order.production_wsady||[])) {
      for (const it of items) {
        const p = picks[`${w.id}|${it.ingredient_id}`]
        if (!p || !p.batchId) { setError(`W${w.wsad_no}: wybierz partię dla „${it.ingredients?.code}”`); return }
        if (!(parseFloat(p.qty)>0)) { setError(`W${w.wsad_no}: podaj ilość dla „${it.ingredients?.code}”`); return }
      }
    }
    setSaving(true); setError('')
    const today = new Date().toISOString().slice(0,10)
    const seq = order.lot_number.split('-')[2] || ''

    // 1) zużycie surowców (production_batch_items + wsad_id)
    const itemRows = []
    ;(order.production_wsady||[]).forEach(w => {
      items.forEach(it => {
        const p = picks[`${w.id}|${it.ingredient_id}`]
        itemRows.push({ production_batch_id: order.id, wsad_id: w.id, ingredient_id: it.ingredient_id, ingredient_batch_id: p.batchId, quantity_used_kg: parseFloat(p.qty) })
      })
    })
    const { error: e1 } = await supabase.from('production_batch_items').insert(itemRows)
    if (e1) { setError(e1.message); setSaving(false); return }

    // 2) bigbagi (grupy wsadów po bb_plan_no) -> finished_goods luz + bigbag_wsady
    const groups = {}
    ;(order.production_wsady||[]).forEach(w => { const b=w.bb_plan_no||1; (groups[b]=groups[b]||[]).push(w) })
    for (const bb of Object.keys(groups).map(Number).sort((a,b)=>a-b)) {
      const list = groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no)
      const mass = parseFloat(list.reduce((s,w)=>s+parseFloat(w.planned_kg||0),0).toFixed(3))
      const bb_code = `${recipe.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`
      const lot = lotCode(seq, bb)
      const { data: fg, error: e2 } = await supabase.from('finished_goods').insert({
        production_batch_id: order.id, received_date: today, quantity_kg: mass,
        form:'luz', unit_type:'big_bag', unit_count:1, unit_weight_kg:mass,
        bb_code, bb_no: bb, lot_code: lot, created_by: profile?.id,
      }).select().single()
      if (e2) { setError(e2.message); setSaving(false); return }
      await supabase.from('bigbag_wsady').insert(list.map(w => ({ finished_good_id: fg.id, wsad_id: w.id })))
    }

    // 3) status zlecenia produkcji + operator/brygadzista + powiązane zlecenia sprzedaży
    await supabase.from('production_batches').update({ prod_stage:'wyprodukowana', produced_at:new Date().toISOString(), operator:operator||null, foreman:foreman||null }).eq('id', order.id)
    const orderIds = (order.production_order_sales||[]).map(x=>x.order_id)
    if (orderIds.length) await supabase.from('orders').update({ status:'wyprodukowane', produced_at:new Date().toISOString() }).in('id', orderIds)

    setSaving(false); setView('list'); setOrder(null); load()
  }

  // ── Podgląd bigbagów dla zlecenia (done) ──
  const [bbCache, setBbCache] = useState({})
  async function toggleDone(id) {
    if (expanded===id) { setExpanded(null); return }
    setExpanded(id)
    if (!bbCache[id]) {
      const { data } = await supabase.from('finished_goods').select('bb_code,lot_code,quantity_kg,bb_no').eq('production_batch_id',id).eq('form','luz').order('bb_no')
      setBbCache(c => ({ ...c, [id]: data||[] }))
    }
  }

  if (view==='produce' && order) {
    const allergens = [...new Set(items.filter(i=>i.ingredients?.has_allergen).map(i=>i.ingredients.allergen_type))]
    return (
      <div>
        <div className="page-header">
          <div><div className="page-title">Produkcja — {order.lot_number}</div><div className="page-sub">{recipe?.code} — {recipe?.name} · ręczny wybór partii surowców per wsad</div></div>
          <button className="btn btn-sm" onClick={() => { setView('list'); setOrder(null) }}>← Wróć</button>
        </div>
        {error && <div className="err-box" style={{marginBottom:10}}>{error}</div>}
        {allergens.length>0 && <div className="warn-box" style={{marginBottom:10}}>Alergeny w recepturze: <b>{allergens.join(', ')}</b></div>}

        {(order.production_wsady||[]).sort((a,b)=>a.wsad_no-b.wsad_no).map(w => (
          <div className="card" key={w.id} style={{ marginBottom:12 }}>
            <div style={{ fontWeight:600, color:'#0F6E56', marginBottom:8 }}>Wsad W{w.wsad_no} <span className="muted" style={{fontWeight:400,fontSize:12}}>· {fmt(w.planned_kg)} kg · → BB{String(w.bb_plan_no||1).padStart(2,'0')}</span></div>
            <table style={{ width:'100%' }}>
              <thead><tr><th>Składnik</th><th style={{textAlign:'right'}}>Cel (kg)</th><th>Partia (ręcznie)</th><th style={{textAlign:'right',width:110}}>Ilość (kg)</th></tr></thead>
              <tbody>
                {items.map(it => {
                  const key=`${w.id}|${it.ingredient_id}`, p=picks[key]||{}
                  const target=parseFloat(((parseFloat(w.planned_kg||0)*parseFloat(it.percentage||0))/100).toFixed(3))
                  const opts=availByIng[it.ingredient_id]||[]
                  return (
                    <tr key={it.ingredient_id}>
                      <td style={{fontSize:12,fontWeight:500}}>{it.ingredients?.code} — {it.ingredients?.name}{it.ingredients?.has_allergen && <span className="badge b-err" style={{fontSize:9,marginLeft:4}}>{it.ingredients.allergen_type}</span>}</td>
                      <td style={{textAlign:'right',color:'#888'}}>{target.toFixed(3)}</td>
                      <td>
                        <select value={p.batchId||''} onChange={e=>setPick(key,'batchId',e.target.value)} style={{minWidth:200}}>
                          <option value="">— wybierz partię —</option>
                          {opts.map(b => <option key={b.id} value={b.id}>{b.lot} (dost. {b.available} kg)</option>)}
                        </select>
                        {opts.length===0 && <span className="badge b-err" style={{fontSize:9,marginLeft:4}}>brak na magazynie</span>}
                      </td>
                      <td style={{textAlign:'right'}}><input type="number" step="0.001" min="0" value={p.qty||''} onChange={e=>setPick(key,'qty',e.target.value)} style={{width:100,textAlign:'right'}} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}

        <div className="card" style={{ marginBottom:12 }}>
          <div className="fr">
            <div><label>Operator</label><input value={operator} onChange={e=>setOperator(e.target.value)} /></div>
            <div><label>Brygadzista</label><input value={foreman} onChange={e=>setForeman(e.target.value)} /></div>
          </div>
          <div className="muted" style={{fontSize:12,marginTop:6}}>Po zatwierdzeniu: surowce zejdą z magazynu, powstaną bigbagi z numerami LOT (L…) jako luz w Magazynie WG, a przypięte zlecenia sprzedaży przejdą na „Wyprodukowane".</div>
        </div>

        <div className="flex" style={{ justifyContent:'flex-end', gap:8 }}>
          <button className="btn" onClick={() => { setView('list'); setOrder(null) }}>Anuluj</button>
          <button className="btn btn-primary" onClick={confirmProduce} disabled={saving}>{saving?'Przetwarzanie...':'Zatwierdź produkcję'}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Produkcja</div><div className="page-sub">Realizacja zleceń produkcji — wybór partii surowców, bigbagi, LOT-y</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#0F6E56', margin:'4px 0 8px' }}>Do produkcji ({planned.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', marginBottom:18 }}>
        <table style={{ minWidth:820 }}>
          <thead><tr><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'center'}}>Wsady</th><th style={{textAlign:'center'}}>Bigbagi</th><th style={{textAlign:'right'}}>Masa plan.</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && planned.length===0 && <tr><td colSpan={6} style={{textAlign:'center',padding:24,color:'#888'}}>Brak zleceń do produkcji</td></tr>}
            {!loading && planned.map(o => (
              <tr key={o.id}>
                <td><span className="lot">{o.lot_number}</span></td>
                <td style={{fontSize:12,fontWeight:500}}>{o.recipes?.code} — {o.recipes?.name}</td>
                <td style={{textAlign:'center'}}>{o.production_wsady?.length||0}</td>
                <td style={{textAlign:'center'}}>{bbCountOf(o)}</td>
                <td style={{textAlign:'right',fontWeight:600}}>{fmt(o.quantity_kg)} kg</td>
                <td>{canEdit && <button className="btn btn-sm btn-primary" onClick={()=>openProduce(o)}>Produkuj</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#5F5E5A', margin:'4px 0 8px' }}>Wyprodukowane — ostatnie ({done.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:640 }}>
          <thead><tr><th style={{width:32}}></th><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'right'}}>Masa</th><th>Data</th></tr></thead>
          <tbody>
            {done.length===0 && <tr><td colSpan={5} style={{textAlign:'center',padding:20,color:'#888'}}>Brak</td></tr>}
            {done.map(o => (
              <React.Fragment key={o.id}>
                <tr>
                  <td style={{textAlign:'center'}}><button onClick={()=>toggleDone(o.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#5F5E5A'}}>{expanded===o.id?'▲':'▼'}</button></td>
                  <td><span className="lot">{o.lot_number}</span></td>
                  <td style={{fontSize:12}}>{o.recipes?.code} — {o.recipes?.name}</td>
                  <td style={{textAlign:'right'}}>{fmt(o.quantity_kg)} kg</td>
                  <td className="muted" style={{fontSize:11}}>{o.produced_at?o.produced_at.slice(0,10):'—'}</td>
                </tr>
                {expanded===o.id && (
                  <tr><td colSpan={5} style={{padding:0,background:'#F9F8F5'}}>
                    <div style={{padding:'8px 16px 12px 40px'}}>
                      <div style={{fontSize:12,fontWeight:600,color:'#0F6E56',marginBottom:6}}>Bigbagi (luz) — kody i LOT</div>
                      {!bbCache[o.id] ? <div className="muted" style={{fontSize:12}}>Ładowanie...</div> :
                        bbCache[o.id].length===0 ? <div className="muted" style={{fontSize:12}}>Brak</div> :
                        bbCache[o.id].map((b,i)=>(
                          <div key={i} style={{fontSize:12,marginBottom:3}}><span className="lot" style={{fontSize:11}}>{b.bb_code}</span> <span className="muted">LOT: {b.lot_code} · {fmt(b.quantity_kg)} kg</span></div>
                        ))}
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
