import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Produkcja() {
  const { profile } = useAuth()
  const canEdit = true

  const [view, setView] = useState('list')
  const [planned, setPlanned] = useState([])
  const [done, setDone] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  const [order, setOrder] = useState(null)
  const [recipe, setRecipe] = useState(null)
  const [items, setItems] = useState([])
  const [availByIng, setAvailByIng] = useState({})
  const [picks, setPicks] = useState({})   // `${wsadId}|${ingId}` -> [{batchId, qty}]
  const [operator, setOperator] = useState('')
  const [foreman, setForeman] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [bbCache, setBbCache] = useState({})

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
  const num = v => { const n = parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?0:n }
  const bbCountOf = o => new Set((o.production_wsady||[]).map(w=>w.bb_plan_no||1)).size
  const targetOf = (w, it) => parseFloat(((parseFloat(w.planned_kg||0)*parseFloat(it.percentage||0))/100).toFixed(3))

  async function openProduce(o) {
    setError('')
    const [{ data: rec }, { data: stock }, { data: used }] = await Promise.all([
      supabase.from('recipes').select('id,code,name,version,recipe_items(sort_order,percentage,ingredient_id,ingredients(code,name,has_allergen,allergen_type))').eq('id', o.recipe_id).single(),
      supabase.from('v_stock').select('id,ingredient_id,delivery_lot,current_kg,received_date').order('received_date',{ascending:true}),
      supabase.from('production_batch_items').select('ingredient_batch_id,quantity_used_kg'),
    ])
    const usedMap = {}; (used||[]).forEach(u => { if(u.ingredient_batch_id) usedMap[u.ingredient_batch_id]=(usedMap[u.ingredient_batch_id]||0)+parseFloat(u.quantity_used_kg||0) })
    const avail = {}
    ;(stock||[]).forEach(s => {
      const a = parseFloat(s.current_kg)-(usedMap[s.id]||0)
      if (a>0.001) (avail[s.ingredient_id]=avail[s.ingredient_id]||[]).push({ id:s.id, lot:s.delivery_lot, available:parseFloat(a.toFixed(3)) })
    })
    const ri = [...(rec?.recipe_items||[])].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
    // BEZ sugerowania partii — puste linie, operator wybiera sam
    const pk = {}
    ;(o.production_wsady||[]).forEach(w => { ri.forEach(it => { pk[`${w.id}|${it.ingredient_id}`] = [{ batchId:'', qty:'' }] }) })
    setOrder(o); setRecipe(rec); setItems(ri); setAvailByIng(avail); setPicks(pk)
    setOperator(''); setForeman(''); setView('produce')
  }

  const availMap = {}; Object.values(availByIng).flat().forEach(b => { availMap[b.id]=b.available })
  const allocByBatch = {}; Object.values(picks).flat().forEach(l => { if (l.batchId) allocByBatch[l.batchId]=(allocByBatch[l.batchId]||0)+num(l.qty) })
  const lotOf = {}; Object.values(availByIng).flat().forEach(b => { lotOf[b.id]=b.lot })

  const optionsFor = (ingId, cb, q) => (availByIng[ingId]||[]).map(b => {
    const used = allocByBatch[b.id]||0, own = b.id===cb ? num(q) : 0
    return { ...b, remaining: parseFloat((b.available-(used-own)).toFixed(3)) }
  }).filter(b => b.remaining > 0.001 || b.id===cb)

  const setLine = (key, idx, field, val) => setPicks(p => ({ ...p, [key]: p[key].map((l,i)=> i===idx?{...l,[field]:val}:l) }))
  const addLine = key => setPicks(p => ({ ...p, [key]: [...(p[key]||[]), { batchId:'', qty:'' }] }))
  const delLine = (key, idx) => setPicks(p => ({ ...p, [key]: p[key].length>1 ? p[key].filter((_,i)=>i!==idx) : [{batchId:'',qty:''}] }))

  // Przelicz: wypełnia TYLKO ilości dla partii, które operator JUŻ wybrał (nie sugeruje partii)
  function recompute(scopeWsady) {
    setPicks(prev => {
      const remain = {}; Object.values(availByIng).flat().forEach(b=>{ remain[b.id]=b.available })
      const scopeIds = new Set(scopeWsady.map(w=>String(w.id)))
      Object.entries(prev).forEach(([key,lines]) => {
        if (scopeIds.has(key.split('|')[0])) return
        lines.forEach(l => { if (l.batchId) remain[l.batchId]=parseFloat(((remain[l.batchId]??0)-num(l.qty)).toFixed(3)) })
      })
      const pk = { ...prev }
      scopeWsady.slice().sort((a,b)=>a.wsad_no-b.wsad_no).forEach(w => {
        items.forEach(it => {
          const key=`${w.id}|${it.ingredient_id}`
          const lines = prev[key]||[{batchId:'',qty:''}]
          let need = targetOf(w,it)
          pk[key] = lines.map(l => {
            if (!l.batchId) return { ...l, qty:'' }
            const existing = num(l.qty)
            if (existing > 0) { remain[l.batchId]=parseFloat(((remain[l.batchId]??0)-existing).toFixed(3)); need=parseFloat((need-existing).toFixed(3)); return l }
            const rem = remain[l.batchId] ?? 0
            const take = Math.max(0, Math.min(need, rem))
            remain[l.batchId] = parseFloat((rem-take).toFixed(3))
            need = parseFloat((need-take).toFixed(3))
            return { ...l, qty: take>0 ? String(parseFloat(take.toFixed(3))) : '' }
          })
        })
      })
      return pk
    })
  }
  const przeliczWsad = w => recompute([w])
  const przeliczAll = () => recompute(order.production_wsady||[])

  async function confirmProduce() {
    if (!order) return
    for (const w of (order.production_wsady||[])) {
      for (const it of items) {
        const lines = (picks[`${w.id}|${it.ingredient_id}`]||[]).filter(l => l.batchId && num(l.qty)>0)
        if (lines.length===0) { setError(`W${w.wsad_no}: wybierz partię i ilość dla „${it.ingredients?.code}”`); return }
      }
    }
    for (const [bid, q] of Object.entries(allocByBatch)) {
      if (q > (availMap[bid]||0) + 0.001) { setError(`Partia ${lotOf[bid]||''} przydzielona ponad stan (${q} > ${availMap[bid]||0} kg)`); return }
    }
    setSaving(true); setError('')
    const today = new Date().toISOString().slice(0,10)
    const seq = order.lot_number.split('-')[2] || ''

    const itemRows = []
    ;(order.production_wsady||[]).forEach(w => {
      items.forEach(it => {
        (picks[`${w.id}|${it.ingredient_id}`]||[]).forEach(l => {
          if (l.batchId && num(l.qty)>0) itemRows.push({ production_batch_id: order.id, wsad_id: w.id, ingredient_id: it.ingredient_id, ingredient_batch_id: l.batchId, quantity_used_kg: num(l.qty) })
        })
      })
    })
    const { error: e1 } = await supabase.from('production_batch_items').insert(itemRows)
    if (e1) { setError(e1.message); setSaving(false); return }

    const groups = {}; (order.production_wsady||[]).forEach(w => { const b=w.bb_plan_no||1; (groups[b]=groups[b]||[]).push(w) })
    for (const bb of Object.keys(groups).map(Number).sort((a,b)=>a-b)) {
      const list = groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no)
      const mass = parseFloat(list.reduce((s,w)=>s+parseFloat(w.planned_kg||0),0).toFixed(3))
      const bb_code = `${recipe.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`
      const now=new Date(), yy=String(now.getFullYear()).slice(2), mm=String(now.getMonth()+1).padStart(2,'0'), dd=String(now.getDate()).padStart(2,'0')
      const lot = `L${yy}${mm}${dd}${seq}${String(bb).padStart(2,'0')}`
      const { data: fg, error: e2 } = await supabase.from('finished_goods').insert({
        production_batch_id: order.id, received_date: today, quantity_kg: mass,
        form:'luz', unit_type:'big_bag', unit_count:1, unit_weight_kg:mass,
        bb_code, bb_no: bb, lot_code: lot, created_by: profile?.id,
      }).select().single()
      if (e2) { setError(e2.message); setSaving(false); return }
      await supabase.from('bigbag_wsady').insert(list.map(w => ({ finished_good_id: fg.id, wsad_id: w.id })))
    }

    await supabase.from('production_batches').update({ prod_stage:'wyprodukowana', produced_at:new Date().toISOString(), operator:operator||null, foreman:foreman||null }).eq('id', order.id)
    const orderIds = (order.production_order_sales||[]).map(x=>x.order_id)
    if (orderIds.length) await supabase.from('orders').update({ status:'wyprodukowane', produced_at:new Date().toISOString() }).in('id', orderIds)

    setSaving(false); setView('list'); setOrder(null); load()
  }

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
          <div className="flex" style={{ gap:8 }}>
            <button className="btn btn-sm" style={{ background:'#1D9E75', color:'#fff', borderColor:'#1D9E75' }} onClick={przeliczAll} title="Wypełnia ilości dla wybranych przez Ciebie partii (nie wybiera partii)">⟳ Przelicz ilości</button>
            <button className="btn btn-sm" onClick={() => { setView('list'); setOrder(null) }}>← Wróć</button>
          </div>
        </div>
        {error && <div className="err-box" style={{marginBottom:10}}>{error}</div>}
        {allergens.length>0 && <div className="warn-box" style={{marginBottom:10}}>Alergeny w recepturze: <b>{allergens.join(', ')}</b></div>}
        <div className="muted" style={{fontSize:12, marginBottom:10}}>Partie wybierasz ręcznie. „Przelicz ilości" rozkłada cel tylko na partie, które już wskazałeś — nie podpowiada partii.</div>

        {(order.production_wsady||[]).slice().sort((a,b)=>a.wsad_no-b.wsad_no).map(w => (
          <div className="card" key={w.id} style={{ marginBottom:12 }}>
            <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <div style={{ fontWeight:600, color:'#0F6E56' }}>Wsad W{w.wsad_no} <span className="muted" style={{fontWeight:400,fontSize:12}}>· {fmt(w.planned_kg)} kg · → BB{String(w.bb_plan_no||1).padStart(2,'0')}</span></div>
              <button className="btn btn-sm" style={{ background:'#1D9E75', color:'#fff', borderColor:'#1D9E75' }} onClick={()=>przeliczWsad(w)} title="Wypełnia ilości dla wybranych partii w tym wsadzie">⟳ Przelicz ilości</button>
            </div>
            {items.map(it => {
              const key=`${w.id}|${it.ingredient_id}`, lines=picks[key]||[]
              const target=targetOf(w,it)
              const alloc=lines.reduce((s,l)=>s+num(l.qty),0)
              const short=parseFloat((target-alloc).toFixed(3))
              return (
                <div key={it.ingredient_id} style={{ borderTop:'0.5px solid #EEE', padding:'8px 0' }}>
                  <div className="flex" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <div style={{fontSize:12,fontWeight:500}}>{it.ingredients?.code} — {it.ingredients?.name}{it.ingredients?.has_allergen && <span className="badge b-err" style={{fontSize:9,marginLeft:4}}>{it.ingredients.allergen_type}</span>}</div>
                    <div style={{fontSize:11}} className="muted">cel: <b>{target.toFixed(3)}</b> kg · przydzielono: <b style={{color: Math.abs(short)<=0.001?'#085041':'#A32D2D'}}>{alloc.toFixed(3)}</b>{Math.abs(short)>0.001 && <span style={{color:'#A32D2D'}}> (brak {short.toFixed(3)})</span>}
                      <button className="btn btn-sm" style={{marginLeft:8,padding:'1px 7px'}} onClick={()=>addLine(key)}>+ partia</button>
                    </div>
                  </div>
                  {(availByIng[it.ingredient_id]||[]).length===0 && <div className="badge b-err" style={{fontSize:9,marginBottom:4}}>brak tego surowca na magazynie</div>}
                  {lines.map((l,li) => {
                    const opts=optionsFor(it.ingredient_id, l.batchId, l.qty)
                    return (
                      <div key={li} className="flex" style={{ gap:8, marginBottom:4, alignItems:'center' }}>
                        <select value={l.batchId||''} onChange={e=>setLine(key,li,'batchId',e.target.value)} style={{minWidth:230,flex:1}}>
                          <option value="">— wybierz partię —</option>
                          {opts.map(b => <option key={b.id} value={b.id}>{b.lot} (pozostało {b.remaining} kg)</option>)}
                        </select>
                        <input type="text" inputMode="decimal" value={l.qty||''} onChange={e=>setLine(key,li,'qty',e.target.value)} style={{width:100,textAlign:'right'}} placeholder="kg" />
                        {lines.length>1 && <button className="btn btn-sm btn-danger" style={{padding:'2px 7px'}} onClick={()=>delLine(key,li)}>×</button>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
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
