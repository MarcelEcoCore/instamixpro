import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STAGE = { planowana:'Zaplanowana', pobrana:'Pobrana', wyprodukowana:'Wyprodukowana', zaakceptowana:'Zaakceptowana', anulowana:'Anulowana' }
let UID = 1
const uid = () => `w${UID++}`

export default function Planowanie() {
  const { profile } = useAuth()
  const canEdit = true

  const [view, setView] = useState('list')
  const [salesNowe, setSalesNowe] = useState([])
  const [prodOrders, setProdOrders] = useState([])
  const [recipes, setRecipes] = useState([])
  const [availByIng, setAvailByIng] = useState({})
  const [luzStock, setLuzStock] = useState({})   // recipe_code -> dostępny półprodukt (kg)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [selOrders, setSelOrders] = useState([])

  // plan
  const [recipeId, setRecipeId] = useState('')
  const [items, setItems] = useState([])
  const [attached, setAttached] = useState([])
  const [wsady, setWsady] = useState([])          // [{uid, planned_kg, bb}]
  const [bbCount, setBbCount] = useState('1')
  const [picks, setPicks] = useState({})          // `${uid}|${ingId}` -> [{batchId, qty}]
  const [plannedBy, setPlannedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [nextSeq, setNextSeq] = useState('NNNN')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: po }, { data: rec }, { data: stock }, { data: used }, { data: vfg }] = await Promise.all([
      supabase.from('orders').select('id,order_number,status,qty_units,quantity_kg,recipe_id,clients(number,name),bom(code_ext,recipe_id,gramatura_kg)').eq('status','nowe').order('ship_date',{ascending:true}),
      supabase.from('production_batches').select('id,lot_number,recipe_id,quantity_kg,client,prod_stage,planned_by,recipes(code,name,version),production_wsady(id,wsad_no,planned_kg,bb_plan_no),production_order_sales(order_id,orders(order_number))').not('prod_stage','is',null).order('lot_number',{ascending:false}),
      supabase.from('recipes').select('id,code,name,version,client,status').eq('status','dopuszczona').order('code'),
      supabase.from('v_stock').select('id,ingredient_id,delivery_lot,current_kg,received_date').order('received_date',{ascending:true}),
      supabase.from('production_batch_items').select('ingredient_batch_id,quantity_used_kg'),
      supabase.from('v_finished_goods').select('recipe_code,available_kg,form'),
    ])
    const usedMap={}; (used||[]).forEach(u=>{ if(u.ingredient_batch_id) usedMap[u.ingredient_batch_id]=(usedMap[u.ingredient_batch_id]||0)+parseFloat(u.quantity_used_kg||0) })
    const avail={}; (stock||[]).forEach(x=>{ const a=parseFloat(x.current_kg)-(usedMap[x.id]||0); if(a>0.001)(avail[x.ingredient_id]=avail[x.ingredient_id]||[]).push({id:x.id,lot:x.delivery_lot,available:parseFloat(a.toFixed(3))}) })
    const lz={}; (vfg||[]).forEach(g=>{ if(g.form!=='spakowane'){ const a=parseFloat(g.available_kg||0); if(a>0.001) lz[g.recipe_code]=(lz[g.recipe_code]||0)+a } })
    setSalesNowe(s||[]); setProdOrders(po||[]); setRecipes(rec||[]); setAvailByIng(avail); setLuzStock(lz)
    setLoading(false)
  }

  const num = v => { const n = parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?0:n }
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})
  const recipeOf = o => o.recipe_id || o.bom?.recipe_id || null
  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'
  const recipe = recipes.find(r => r.id === recipeId)

  const codeById = {}; recipes.forEach(r=>{ codeById[r.id]=r.code })
  const luzForOrder = o => { const code = codeById[recipeOf(o)]; return code ? (luzStock[code]||0) : 0 }
  const unitsFromKg = (kg, o) => { const g=parseFloat(o.bom?.gramatura_kg||0); return g>0 ? Math.floor(kg/g) : 0 }
  async function realizujZMagazynu(o) {
    const kg = luzForOrder(o)
    if (!window.confirm(`Zrealizować zlecenie ${o.order_number} z magazynu?\nDostępny półprodukt: ${fmt(kg)} kg ≈ ${unitsFromKg(kg,o)} szt.\nZlecenie przejdzie na „Wyprodukowane" bez nowej produkcji (do spakowania z istniejących bigbagów).`)) return
    await supabase.from('orders').update({ status:'wyprodukowane', produced_at:new Date().toISOString() }).eq('id', o.id)
    load()
  }

  const selRecipe = selOrders.length ? recipeOf(salesNowe.find(o=>o.id===selOrders[0])||{}) : null
  function toggleSel(o) {
    const r = recipeOf(o)
    if (selOrders.includes(o.id)) setSelOrders(selOrders.filter(x=>x!==o.id))
    else { if (selOrders.length && r!==selRecipe) return; setSelOrders([...selOrders, o.id]) }
  }

  async function peekNextSeq() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('production_batches').select('lot_number').like('lot_number',`PROD-${year}-%`).order('lot_number',{ascending:false}).limit(1)
    let n = 1; if (data && data.length) n=(parseInt(data[0].lot_number.split('-')[2]||'0',10))+1
    return String(n).padStart(4,'0')
  }

  async function loadItemsFor(rid, wsadyList) {
    const { data: r } = await supabase.from('recipes').select('recipe_items(sort_order,percentage,ingredient_id,ingredients(code,name,has_allergen,allergen_type))').eq('id', rid).single()
    const ri = [...(r?.recipe_items||[])].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
    setItems(ri)
    setPicks(buildEmptyPicks(wsadyList, ri))
  }
  function buildEmptyPicks(wsadyList, ri) {
    const pk={}; wsadyList.forEach(w=>ri.forEach(it=>{ pk[`${w.uid}|${it.ingredient_id}`]=[{batchId:'',qty:''}] })); return pk
  }

  async function openFromSales() {
    if (!selOrders.length) return
    const r = selRecipe; const seq = await peekNextSeq()
    const totalKg = selOrders.reduce((s,id)=>{const o=salesNowe.find(x=>x.id===id);return s+parseFloat(o?.quantity_kg||0)},0)
    const w0=[{ uid:uid(), planned_kg: totalKg>0?String(parseFloat(totalKg.toFixed(3))):'', bb:'1' }]
    setRecipeId(r||''); setAttached([...selOrders]); setNextSeq(seq); setWsady(w0); setBbCount('1'); setPlannedBy(''); setNotes(''); setError('')
    if (r) await loadItemsFor(r, w0); else { setItems([]); setPicks({}) }
    setView('plan')
  }
  async function openStock() {
    const seq = await peekNextSeq(); const w0=[{ uid:uid(), planned_kg:'', bb:'1' }]
    setRecipeId(''); setAttached([]); setNextSeq(seq); setWsady(w0); setBbCount('1'); setItems([]); setPicks({}); setPlannedBy(''); setNotes(''); setError('')
    setView('plan')
  }
  async function onRecipeChange(rid) {
    setRecipeId(rid)
    if (rid) await loadItemsFor(rid, wsady); else { setItems([]); setPicks({}) }
  }

  // wsady
  const nBB = Math.max(1, parseInt(bbCount)||1)
  const setW = (i,k,v) => setWsady(ws => ws.map((w,idx)=> idx===i?{...w,[k]:v}:w))
  function addW() {
    const w={ uid:uid(), planned_kg:'', bb:'1' }
    setWsady(ws=>[...ws,w])
    setPicks(p=>{ const np={...p}; items.forEach(it=>{ np[`${w.uid}|${it.ingredient_id}`]=[{batchId:'',qty:''}] }); return np })
  }
  function delW(i) {
    setWsady(ws=>{ if(ws.length<=1) return ws; const rem=ws[i]; setPicks(p=>{const np={...p};Object.keys(np).forEach(k=>{if(k.startsWith(rem.uid+'|'))delete np[k]});return np}); return ws.filter((_,idx)=>idx!==i) })
  }
  function onBbCount(v){ setBbCount(v); const n=Math.max(1,parseInt(v)||1); setWsady(ws=>ws.map(w=>(parseInt(w.bb)||1)>n?{...w,bb:String(n)}:w)) }

  function bigbagsPreview() {
    const groups={}; for(let b=1;b<=nBB;b++)groups[b]=[]
    wsady.forEach((w,i)=>{ const bb=Math.min(nBB,Math.max(1,parseInt(w.bb)||1)); groups[bb].push({wsad_no:i+1,kg:num(w.planned_kg)}) })
    return Object.keys(groups).map(Number).sort((a,b)=>a-b).map(bb=>{
      const list=groups[bb]
      const code=recipe?`${recipe.code}/${nextSeq}/${list.length?list.map(w=>'W'+w.wsad_no).join('/'):'—'}/BB${String(bb).padStart(2,'0')}`:'—'
      return { bb, list, kg:list.reduce((s,w)=>s+w.kg,0), code, over:list.length>3, empty:list.length===0 }
    })
  }
  const bbs = bigbagsPreview()
  const totalPlanned = wsady.reduce((s,w)=>s+num(w.planned_kg),0)

  // partie — pula wspólna z planem i rezerwacjami w bazie
  const availMap={}; Object.values(availByIng).flat().forEach(b=>{availMap[b.id]=b.available})
  const allocByBatch={}; Object.values(picks).flat().forEach(l=>{ if(l.batchId) allocByBatch[l.batchId]=(allocByBatch[l.batchId]||0)+num(l.qty) })
  const lotOf={}; Object.values(availByIng).flat().forEach(b=>{lotOf[b.id]=b.lot})
  const optionsFor=(ingId,cb,q)=>(availByIng[ingId]||[]).map(b=>{const used=allocByBatch[b.id]||0,own=b.id===cb?num(q):0;return{...b,remaining:parseFloat((b.available-(used-own)).toFixed(3))}}).filter(b=>b.remaining>0.001||b.id===cb)
  const targetOf=(w,it)=>parseFloat(((num(w.planned_kg)*parseFloat(it.percentage||0))/100).toFixed(3))
  const setLine=(key,idx,field,val)=>setPicks(p=>({...p,[key]:p[key].map((l,i)=>i===idx?{...l,[field]:val}:l)}))
  const addLine=key=>setPicks(p=>({...p,[key]:[...(p[key]||[]),{batchId:'',qty:''}]}))
  const delLine=(key,idx)=>setPicks(p=>({...p,[key]:p[key].length>1?p[key].filter((_,i)=>i!==idx):[{batchId:'',qty:''}]}))

  function recompute(scopeUids) {
    setPicks(prev=>{
      const remain={}; Object.values(availByIng).flat().forEach(b=>{remain[b.id]=b.available})
      const scope=new Set(scopeUids)
      Object.entries(prev).forEach(([key,lines])=>{ if(scope.has(key.split('|')[0]))return; lines.forEach(l=>{if(l.batchId)remain[l.batchId]=parseFloat(((remain[l.batchId]??0)-num(l.qty)).toFixed(3))}) })
      const pk={...prev}
      wsady.forEach(w=>{ if(!scope.has(w.uid))return; items.forEach(it=>{
        const key=`${w.uid}|${it.ingredient_id}`; const lines=prev[key]||[{batchId:'',qty:''}]; let need=targetOf(w,it)
        pk[key]=lines.map(l=>{ if(!l.batchId)return{...l,qty:''}; const ex=num(l.qty); if(ex>0){remain[l.batchId]=parseFloat(((remain[l.batchId]??0)-ex).toFixed(3));need=parseFloat((need-ex).toFixed(3));return l}
          const rem=remain[l.batchId]??0; const take=Math.max(0,Math.min(need,rem)); remain[l.batchId]=parseFloat((rem-take).toFixed(3)); need=parseFloat((need-take).toFixed(3)); return{...l,qty:take>0?String(parseFloat(take.toFixed(3))):''} })
      }) })
      return pk
    })
  }

  async function save() {
    if (!recipeId) { setError('Wybierz recepturę / produkt'); return }
    if (!wsady.length || wsady.some(w=>!(num(w.planned_kg)>0))) { setError('Każdy wsad musi mieć masę > 0'); return }
    if (bbs.some(b=>b.over)) { setError('Bigbag może mieć maksymalnie 3 wsady'); return }
    if (bbs.some(b=>b.empty)) { setError('Każdy bigbag musi mieć co najmniej 1 wsad'); return }
    for (const w of wsady) for (const it of items) {
      const lines=(picks[`${w.uid}|${it.ingredient_id}`]||[]).filter(l=>l.batchId&&num(l.qty)>0)
      if (lines.length===0) { setError(`W${wsady.indexOf(w)+1}: wybierz partię i ilość dla „${it.ingredients?.code}”`); return }
    }
    for (const [bid,q] of Object.entries(allocByBatch)) if (q>(availMap[bid]||0)+0.001) { setError(`Partia ${lotOf[bid]||''} ponad stan (${q} > ${availMap[bid]||0} kg)`); return }
    setSaving(true); setError('')
    const seq = await peekNextSeq(); const prodNo=`PROD-${new Date().getFullYear()}-${seq}`
    const clientName = recipe?.client || (attached.length ? (salesNowe.find(o=>o.id===attached[0])?.clients?.name||null) : null)
    const { data: pb, error: e1 } = await supabase.from('production_batches').insert({ lot_number:prodNo, recipe_id:recipeId, quantity_kg:parseFloat(totalPlanned.toFixed(3)), client:clientName, prod_stage:'planowana', planned_by:plannedBy||profile?.full_name||null, notes:notes||null, created_by:profile?.id }).select().single()
    if (e1) { setError(e1.message); setSaving(false); return }
    const wsadyRows = wsady.map((w,i)=>({ production_batch_id:pb.id, wsad_no:i+1, planned_kg:num(w.planned_kg), bb_plan_no:parseInt(w.bb)||1 }))
    const { data: wIns, error: e2 } = await supabase.from('production_wsady').insert(wsadyRows).select()
    if (e2) { setError(e2.message); setSaving(false); return }
    const idByNo={}; (wIns||[]).forEach(r=>{idByNo[r.wsad_no]=r.id})
    const itemRows=[]
    wsady.forEach((w,i)=>{ items.forEach(it=>{ (picks[`${w.uid}|${it.ingredient_id}`]||[]).forEach(l=>{ if(l.batchId&&num(l.qty)>0) itemRows.push({ production_batch_id:pb.id, wsad_id:idByNo[i+1], ingredient_id:it.ingredient_id, ingredient_batch_id:l.batchId, quantity_used_kg:num(l.qty) }) }) }) })
    const { error: e3 } = await supabase.from('production_batch_items').insert(itemRows)
    if (e3) { setError(e3.message); setSaving(false); return }
    if (attached.length) {
      await supabase.from('production_order_sales').insert(attached.map(id=>{const o=salesNowe.find(x=>x.id===id);return{production_batch_id:pb.id,order_id:id,alloc_units:o?.qty_units||null,alloc_kg:o?.quantity_kg||null}}))
      await supabase.from('orders').update({ status:'zaplanowane', updated_at:new Date().toISOString() }).in('id', attached)
    }
    setSaving(false); setView('list'); setSelOrders([]); load()
  }

  async function delProd(po) {
    if (!['planowana'].includes(po.prod_stage)) return
    const orderIds=(po.production_order_sales||[]).map(x=>x.order_id)
    await supabase.from('production_batch_items').delete().eq('production_batch_id', po.id)
    await supabase.from('production_batches').delete().eq('id', po.id)
    if (orderIds.length) await supabase.from('orders').update({ status:'nowe' }).in('id', orderIds)
    load()
  }

  async function printOrder(po) {
    const [{ data: pbi }, { data: ws }] = await Promise.all([
      supabase.from('production_batch_items').select('wsad_id,quantity_used_kg,ingredients(code,name),ingredient_batches(delivery_lot)').eq('production_batch_id', po.id),
      supabase.from('production_wsady').select('id,wsad_no,planned_kg,bb_plan_no').eq('production_batch_id', po.id).order('wsad_no'),
    ])
    const seq=po.lot_number.split('-')[2]||''
    const byWsad={}; (pbi||[]).forEach(r=>{(byWsad[r.wsad_id]=byWsad[r.wsad_id]||[]).push(r)})
    const groups={}; (ws||[]).forEach(w=>{const b=w.bb_plan_no||1;(groups[b]=groups[b]||[]).push(w)})
    const bbBlocks=Object.keys(groups).map(Number).sort((a,b)=>a-b).map(bb=>{
      const list=groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no)
      const code=`${po.recipes?.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`
      const wrows=list.map(w=>{
        const rows=(byWsad[w.id]||[]).map(r=>`<tr><td>${r.ingredients?.code||''}</td><td>${r.ingredients?.name||''}</td><td style="font-family:monospace">${r.ingredient_batches?.delivery_lot||''}</td><td style="text-align:right">${parseFloat(r.quantity_used_kg).toFixed(3)}</td><td style="width:70px"></td></tr>`).join('')
        return `<tr class="wsad"><td colspan="5">Wsad W${w.wsad_no} — ${parseFloat(w.planned_kg).toFixed(3)} kg</td></tr>${rows}`
      }).join('')
      return `<div class="bb"><div class="bb-h">Bigbag ${code}</div><table><thead><tr><th>Kod</th><th>Składnik</th><th>Nr partii</th><th style="text-align:right">Ilość (kg)</th><th>Pobrano ✓</th></tr></thead><tbody>${wrows}</tbody></table></div>`
    }).join('')
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Zlecenie produkcji ${po.lot_number}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:10px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.lot{font-size:14px;font-weight:bold;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#F1EFE8;font-size:9px;text-transform:uppercase;padding:4px 6px;border:1px solid #D3D1C7;text-align:left}td{padding:4px 6px;border:1px solid #D3D1C7;font-size:10px}.wsad td{background:#E1F5EE;font-weight:bold}.bb-h{font-weight:bold;margin:8px 0 4px;font-size:12px}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-top:20px}.sl{border-bottom:1.5px solid #333;margin-top:28px;margin-bottom:4px}.sn{font-size:9px;color:#888}@media print{@page{margin:10mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div style="font-weight:bold;margin-top:3px">Zlecenie produkcji — karta dozowania</div><div class="lot" style="margin-top:3px">${po.lot_number}</div></div>
<div style="text-align:right;font-size:10px;color:#555"><div>Produkt: <b>${po.recipes?.code} — ${po.recipes?.name}</b></div><div>Masa plan.: <b>${parseFloat(po.quantity_kg).toFixed(3)} kg</b></div><div>Data druku: ${new Date().toLocaleDateString('pl-PL')}</div></div></div>
${bbBlocks}
<div class="sig-grid"><div><div class="sn">PLANISTA — plan</div><div class="sl"></div><div class="sn">podpis · data</div></div><div><div class="sn">MAGAZYNIER — pobranie</div><div class="sl"></div><div class="sn">podpis · data</div></div><div><div class="sn">OPERATOR — wykonanie</div><div class="sl"></div><div class="sn">podpis · data</div></div><div><div class="sn">PLANISTA — akceptacja</div><div class="sl"></div><div class="sn">podpis · data</div></div></div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  // ====== WIDOK PLANOWANIA ======
  if (view==='plan') {
    const allergens=[...new Set(items.filter(i=>i.ingredients?.has_allergen).map(i=>i.ingredients.allergen_type))]
    return (
      <div>
        <div className="page-header">
          <div><div className="page-title">Planowanie produkcji — PROD-{new Date().getFullYear()}-{nextSeq}</div><div className="page-sub">Plan bigbagów i wsadów + wybór partii składników (rezerwacja stanu)</div></div>
          <button className="btn btn-sm" onClick={()=>setView('list')}>← Wróć</button>
        </div>
        {error && <div className="err-box" style={{marginBottom:10}}>{error}</div>}

        <div className="card" style={{marginBottom:12}}>
          <div className="fr">
            <div style={{flex:2}}><label>Receptura / produkt *</label>
              <select value={recipeId} onChange={e=>onRecipeChange(e.target.value)} disabled={attached.length>0}>
                <option value="">— wybierz —</option>
                {recipes.map(r=><option key={r.id} value={r.id}>{r.code} — {r.name} (v{r.version})</option>)}
              </select>
            </div>
            <div><label>Przypięte zlecenia</label><input value={attached.length?attached.map(id=>salesNowe.find(o=>o.id===id)?.order_number).join(', '):'na magazyn'} disabled /></div>
            <div><label>Planista</label><input value={plannedBy} onChange={e=>setPlannedBy(e.target.value)} placeholder="imię i nazwisko" /></div>
          </div>
          <div style={{marginTop:8}}>
            <div className="flex" style={{justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <label style={{margin:0}}>Wsady (masa + bigbag)</label>
              <div className="flex" style={{gap:10,alignItems:'center'}}>
                <span style={{fontSize:12,color:'#5F5E5A'}}>Liczba bigbagów:</span>
                <input type="number" min="1" step="1" value={bbCount} onChange={e=>onBbCount(e.target.value)} style={{width:60,textAlign:'center'}} />
                <button className="btn btn-sm" onClick={addW}>+ Wsad</button>
              </div>
            </div>
            <table style={{width:'100%'}}>
              <thead><tr><th style={{width:50}}>Wsad</th><th style={{textAlign:'right'}}>Masa (kg)</th><th style={{width:120,textAlign:'center'}}>Bigbag</th><th style={{width:40}}></th></tr></thead>
              <tbody>
                {wsady.map((w,i)=>(
                  <tr key={w.uid}>
                    <td style={{fontWeight:600}}>W{i+1}</td>
                    <td style={{textAlign:'right'}}><input type="text" inputMode="decimal" value={w.planned_kg} onChange={e=>setW(i,'planned_kg',e.target.value)} style={{width:120,textAlign:'right'}} /></td>
                    <td style={{textAlign:'center'}}><select value={w.bb} onChange={e=>setW(i,'bb',e.target.value)} style={{width:90}}>{Array.from({length:nBB},(_,k)=>k+1).map(n=><option key={n} value={String(n)}>BB{String(n).padStart(2,'0')}</option>)}</select></td>
                    <td style={{textAlign:'center'}}>{wsady.length>1&&<button className="btn btn-sm btn-danger" style={{padding:'2px 7px'}} onClick={()=>delW(i)}>×</button>}</td>
                  </tr>
                ))}
                <tr style={{background:'#F1EFE8'}}><td style={{fontWeight:600,textAlign:'right'}}>Razem</td><td style={{textAlign:'right',fontWeight:700}}>{fmt(totalPlanned)} kg</td><td colSpan={2}></td></tr>
              </tbody>
            </table>
            <div style={{marginTop:8,background:'#F9F8F5',borderRadius:6,padding:8}}>
              {bbs.map(b=>(<div key={b.bb} style={{fontSize:12,marginBottom:3,color:(b.over||b.empty)?'#A32D2D':undefined}}><span className="lot" style={{fontSize:11}}>{b.code}</span>{b.empty?<span style={{marginLeft:8,fontWeight:600}}>⚠ pusty</span>:<span className="muted" style={{marginLeft:8}}>{b.list.map(w=>'W'+w.wsad_no).join('+')} · {fmt(b.kg)} kg{b.over&&<b style={{color:'#A32D2D'}}> ⚠ max 3</b>}</span>}</div>))}
            </div>
          </div>
        </div>

        {!recipeId && <div className="muted" style={{padding:12}}>Wybierz recepturę, aby wskazać partie składników.</div>}
        {recipeId && allergens.length>0 && <div className="warn-box" style={{marginBottom:10}}>Alergeny: <b>{allergens.join(', ')}</b></div>}
        {recipeId && wsady.map((w,wi)=>(
          <div className="card" key={w.uid} style={{marginBottom:12}}>
            <div className="flex" style={{justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontWeight:600,color:'#0F6E56'}}>Wsad W{wi+1} <span className="muted" style={{fontWeight:400,fontSize:12}}>· {fmt(w.planned_kg)} kg · → BB{String(w.bb||1).padStart(2,'0')}</span></div>
              <button className="btn btn-sm" style={{background:'#1D9E75',color:'#fff',borderColor:'#1D9E75'}} onClick={()=>recompute([w.uid])}>⟳ Przelicz ilości</button>
            </div>
            {items.map(it=>{
              const key=`${w.uid}|${it.ingredient_id}`, lines=picks[key]||[]
              const target=targetOf(w,it), alloc=lines.reduce((s,l)=>s+num(l.qty),0), short=parseFloat((target-alloc).toFixed(3))
              return (
                <div key={it.ingredient_id} style={{borderTop:'0.5px solid #EEE',padding:'8px 0'}}>
                  <div className="flex" style={{justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <div style={{fontSize:12,fontWeight:500}}>{it.ingredients?.code} — {it.ingredients?.name}{it.ingredients?.has_allergen&&<span className="badge b-err" style={{fontSize:9,marginLeft:4}}>{it.ingredients.allergen_type}</span>}</div>
                    <div style={{fontSize:11}} className="muted">cel: <b>{target.toFixed(3)}</b> · przydz.: <b style={{color:Math.abs(short)<=0.001?'#085041':'#A32D2D'}}>{alloc.toFixed(3)}</b>{Math.abs(short)>0.001&&<span style={{color:'#A32D2D'}}> (brak {short.toFixed(3)})</span>}<button className="btn btn-sm" style={{marginLeft:8,padding:'1px 7px'}} onClick={()=>addLine(key)}>+ partia</button></div>
                  </div>
                  {(availByIng[it.ingredient_id]||[]).length===0&&<div className="badge b-err" style={{fontSize:9,marginBottom:4}}>brak surowca na magazynie</div>}
                  {lines.map((l,li)=>{const opts=optionsFor(it.ingredient_id,l.batchId,l.qty);return(
                    <div key={li} className="flex" style={{gap:8,marginBottom:4,alignItems:'center'}}>
                      <select value={l.batchId||''} onChange={e=>setLine(key,li,'batchId',e.target.value)} style={{minWidth:230,flex:1}}><option value="">— wybierz partię —</option>{opts.map(b=><option key={b.id} value={b.id}>{b.lot} (pozostało {b.remaining} kg)</option>)}</select>
                      <input type="text" inputMode="decimal" value={l.qty||''} onChange={e=>setLine(key,li,'qty',e.target.value)} style={{width:100,textAlign:'right'}} placeholder="kg" />
                      {lines.length>1&&<button className="btn btn-sm btn-danger" style={{padding:'2px 7px'}} onClick={()=>delLine(key,li)}>×</button>}
                    </div>)})}
                </div>
              )
            })}
          </div>
        ))}

        <div><label>Uwagi</label><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="opcjonalne" /></div>
        <div className="flex" style={{justifyContent:'flex-end',gap:8,marginTop:12}}>
          <button className="btn" onClick={()=>setView('list')}>Anuluj</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':'Zapisz plan (rezerwuj surowce)'}</button>
        </div>
      </div>
    )
  }

  // ====== LISTA ======
  const bbCountOf = o => new Set((o.production_wsady||[]).map(w=>w.bb_plan_no||1)).size
  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Planowanie zleceń</div><div className="page-sub">Plan produkcji — wsady, bigbagi, wybór partii, wydruk zlecenia</div></div>
        <div className="flex" style={{gap:8}}>
          {canEdit && <button className="btn btn-sm" onClick={openStock}>+ Produkcja na magazyn</button>}
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
      </div>

      <div style={{fontSize:13,fontWeight:600,color:'#BA7517',margin:'4px 0 8px'}}>Zlecenia sprzedaży do zaplanowania ({salesNowe.length})</div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto',marginBottom:8}}>
        <table style={{minWidth:760}}>
          <thead><tr><th style={{width:36}}></th><th>Nr zlecenia</th><th>Klient</th><th>Wyrób (BOM)</th><th style={{textAlign:'right'}}>Ilość szt.</th><th style={{textAlign:'right'}}>Waga</th><th style={{textAlign:'right'}}>Na stanie (półprodukt)</th><th></th></tr></thead>
          <tbody>
            {loading&&<tr><td colSpan={8} style={{textAlign:'center',padding:20,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading&&salesNowe.length===0&&<tr><td colSpan={8} style={{textAlign:'center',padding:20,color:'#888'}}>Brak nowych zleceń</td></tr>}
            {!loading&&salesNowe.map(o=>{const disabled=selOrders.length>0&&recipeOf(o)!==selRecipe&&!selOrders.includes(o.id);const kg=luzForOrder(o);const uu=unitsFromKg(kg,o);const enough=o.qty_units&&uu>=parseInt(o.qty_units);return(
              <tr key={o.id} style={{opacity:disabled?0.4:1, background: kg>0.001?'#F0FAF5':undefined}}>
                <td style={{textAlign:'center'}}><input type="checkbox" checked={selOrders.includes(o.id)} disabled={disabled} onChange={()=>toggleSel(o)} /></td>
                <td><span className="lot">{o.order_number||'—'}</span></td><td style={{fontSize:12}}>{klient(o)}</td><td style={{fontWeight:500,fontSize:12}}>{o.bom?.code_ext||'—'}</td><td style={{textAlign:'right'}}>{fmt(o.qty_units)}</td><td style={{textAlign:'right',fontWeight:600}}>{fmt(o.quantity_kg)} kg</td>
                <td style={{textAlign:'right'}}>{kg>0.001 ? <span style={{color:enough?'#085041':'#BA7517',fontWeight:600}}>{fmt(kg)} kg <span className="muted" style={{fontSize:10}}>(~{uu} szt.{enough?' ✓':''})</span></span> : <span className="muted">—</span>}</td>
                <td>{canEdit && kg>0.001 && <button className="btn btn-sm" style={{background:'#1D9E75',color:'#fff',borderColor:'#1D9E75'}} onClick={()=>realizujZMagazynu(o)}>Z magazynu</button>}</td>
              </tr>)})}
          </tbody>
        </table>
      </div>
      <div className="flex" style={{justifyContent:'space-between',marginBottom:18,alignItems:'center'}}>
        <div className="muted" style={{fontSize:12}}>{selOrders.length>0?`Wybrano ${selOrders.length} zlec. (jedna receptura)`:'Zaznacz zlecenia tej samej receptury.'}</div>
        {canEdit&&<button className="btn btn-primary btn-sm" onClick={openFromSales} disabled={!selOrders.length}>Zaplanuj produkcję z wybranych →</button>}
      </div>

      <div style={{fontSize:13,fontWeight:600,color:'#0F6E56',margin:'4px 0 8px'}}>Zlecenia produkcji ({prodOrders.length})</div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto'}}>
        <table style={{minWidth:900}}>
          <thead><tr><th style={{width:32}}></th><th>Nr produkcji</th><th>Produkt</th><th style={{textAlign:'center'}}>Wsady</th><th style={{textAlign:'center'}}>Bigbagi</th><th style={{textAlign:'right'}}>Masa</th><th>Sprzedaż</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {!loading&&prodOrders.length===0&&<tr><td colSpan={9} style={{textAlign:'center',padding:20,color:'#888'}}>Brak zleceń produkcji</td></tr>}
            {prodOrders.map(po=>(
              <React.Fragment key={po.id}>
                <tr>
                  <td style={{textAlign:'center'}}><button onClick={()=>setExpanded(expanded===po.id?null:po.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#5F5E5A'}}>{expanded===po.id?'▲':'▼'}</button></td>
                  <td><span className="lot">{po.lot_number}</span></td>
                  <td style={{fontSize:12,fontWeight:500}}>{po.recipes?.code} — {po.recipes?.name}</td>
                  <td style={{textAlign:'center'}}>{po.production_wsady?.length||0}</td>
                  <td style={{textAlign:'center'}}>{bbCountOf(po)}</td>
                  <td style={{textAlign:'right',fontWeight:600}}>{fmt(po.quantity_kg)} kg</td>
                  <td style={{fontSize:11}}>{(po.production_order_sales||[]).length?(po.production_order_sales||[]).map(x=>x.orders?.order_number).join(', '):<span className="muted">na magazyn</span>}</td>
                  <td><span className={`badge ${po.prod_stage==='zaakceptowana'?'b-ok':po.prod_stage==='anulowana'?'b-err':'b-warn'}`} style={{fontSize:10}}>{STAGE[po.prod_stage]||po.prod_stage}</span></td>
                  <td><div className="flex" style={{gap:4}}>
                    <button className="btn btn-sm" onClick={()=>printOrder(po)}>🖨 Zlecenie</button>
                    {canEdit&&po.prod_stage==='planowana'&&<button className="btn btn-sm btn-danger" onClick={()=>delProd(po)}>Usuń</button>}
                  </div></td>
                </tr>
                {expanded===po.id&&(
                  <tr><td colSpan={9} style={{padding:0,background:'#F9F8F5'}}>
                    <div style={{padding:'10px 16px 12px 40px'}}>
                      <div style={{fontSize:12,fontWeight:600,color:'#0F6E56',marginBottom:6}}>Bigbagi i wsady · planista: {po.planned_by||'—'}</div>
                      {(()=>{const seq=po.lot_number.split('-')[2]||'';const groups={};(po.production_wsady||[]).forEach(w=>{const b=w.bb_plan_no||1;(groups[b]=groups[b]||[]).push(w)});return Object.keys(groups).map(Number).sort((a,b)=>a-b).map(bb=>{const list=groups[bb].sort((a,b)=>a.wsad_no-b.wsad_no);const code=`${po.recipes?.code}/${seq}/${list.map(w=>'W'+w.wsad_no).join('/')}/BB${String(bb).padStart(2,'0')}`;return <div key={bb} style={{fontSize:12,marginBottom:4}}><span className="lot" style={{fontSize:11}}>{code}</span> <span className="muted">{list.map(w=>`W${w.wsad_no}: ${fmt(w.planned_kg)}kg`).join(' · ')}</span></div>})})()}
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
