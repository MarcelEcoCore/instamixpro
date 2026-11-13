import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Pakowanie() {
  const { profile } = useAuth()
  const canEdit = true

  const [view, setView] = useState('list')
  const [salesOrders, setSalesOrders] = useState([])
  const [packedByOrder, setPackedByOrder] = useState({})   // order_id -> units packed
  const [loading, setLoading] = useState(true)

  // pack view
  const [order, setOrder] = useState(null)
  const [bigbags, setBigbags] = useState([])    // luz dla receptury zlecenia, z available
  const [bigbagId, setBigbagId] = useState('')
  const [units, setUnits] = useState('')
  const [mats, setMats] = useState({})          // material_id -> {code,name,unit}
  const [pkgStock, setPkgStock] = useState([])  // v_packaging_stock
  const [packs, setPacks] = useState({})        // material_id -> [{batchId, qty}]
  const [packedBy, setPackedBy] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  const num = v => { const n=parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?0:n }
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})
  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'

  async function load() {
    setLoading(true)
    const [{ data: ords }, { data: fg }] = await Promise.all([
      supabase.from('orders').select('id,order_number,status,qty_units,recipe_id,clients(number,name),bom(code_ext,gramatura_kg,units_per_pallet,unit_material_id,pallet_material_id,recipe_id,bom_items(packaging_material_id,qty_per,per))').in('status',['wyprodukowane','w_pakowaniu']).order('ship_date',{ascending:true}),
      supabase.from('finished_goods').select('id,quantity_kg,unit_count,order_id,form').eq('form','spakowane'),
    ])
    const pk={}; (fg||[]).forEach(g=>{ if(g.order_id) pk[g.order_id]=(pk[g.order_id]||0)+(parseInt(g.unit_count)||0) })
    setSalesOrders(ords||[]); setPackedByOrder(pk)
    setLoading(false)
  }

  const recipeOf = o => o.recipe_id || o.bom?.recipe_id || null

  async function openPack(o) {
    setError('')
    const rid = recipeOf(o)
    const [{ data: fg }, { data: consumed }, { data: m }, { data: ps }] = await Promise.all([
      supabase.from('finished_goods').select('id,bb_code,lot_code,quantity_kg,production_batch_id,production_batches(recipe_id)').eq('form','luz'),
      supabase.from('packing_consumed').select('source_finished_good_id,quantity_kg'),
      supabase.from('packaging_materials').select('id,code,name,unit'),
      supabase.from('v_packaging_stock').select('*').order('received_date',{ascending:true}),
    ])
    const usedLuz={}; (consumed||[]).forEach(c=>{ if(c.source_finished_good_id) usedLuz[c.source_finished_good_id]=(usedLuz[c.source_finished_good_id]||0)+parseFloat(c.quantity_kg||0) })
    const bbs=(fg||[]).filter(g=>g.production_batches?.recipe_id===rid).map(g=>({ ...g, available: parseFloat((parseFloat(g.quantity_kg)-(usedLuz[g.id]||0)).toFixed(3)) })).filter(g=>g.available>0.001)
    const mm={}; (m||[]).forEach(x=>{mm[x.id]=x})
    setOrder(o); setBigbags(bbs); setBigbagId(''); setUnits(''); setMats(mm); setPkgStock(ps||[]); setPacks({}); setPackedBy(''); setView('pack')
  }

  const bigbag = bigbags.find(b=>b.id===bigbagId)
  const gramatura = parseFloat(order?.bom?.gramatura_kg||0)
  const upp = parseInt(order?.bom?.units_per_pallet||0)
  const remainingUnits = order ? Math.max(0, parseInt(order.qty_units||0) - (packedByOrder[order.id]||0)) : 0
  const maxUnitsFromBB = (bigbag && gramatura>0) ? Math.floor(bigbag.available/gramatura) : 0

  // zapotrzebowanie opakowań dla u sztuk
  function needs(u) {
    const pallets = upp>0 ? Math.ceil(u/upp) : 0
    const list=[]
    const b=order?.bom||{}
    if (b.unit_material_id) list.push({ material_id:b.unit_material_id, qty:u, label:'worek' })
    if (b.pallet_material_id && pallets>0) list.push({ material_id:b.pallet_material_id, qty:pallets, label:'paleta' })
    ;(b.bom_items||[]).forEach(bi=>{ const naP=bi.per==='paleta'; const q=naP?parseFloat(bi.qty_per||0)*pallets:parseFloat(bi.qty_per||0)*u; if(q>0) list.push({ material_id:bi.packaging_material_id, qty:parseFloat(q.toFixed(3)), label:naP?'na paletę':'na szt.' }) })
    return { pallets, list }
  }
  const u = parseInt(units)||0
  const plan = needs(u)

  // pula partii opakowań
  const pkgByMat={}; pkgStock.forEach(s=>{ (pkgByMat[s.packaging_material_id]=pkgByMat[s.packaging_material_id]||[]).push({ id:s.id, lot:s.delivery_lot, available:parseFloat(s.current_qty||0) }) })
  const pkgAvail={}; pkgStock.forEach(s=>{pkgAvail[s.id]=parseFloat(s.current_qty||0)})
  const pkgAlloc={}; Object.values(packs).flat().forEach(l=>{ if(l.batchId) pkgAlloc[l.batchId]=(pkgAlloc[l.batchId]||0)+num(l.qty) })
  const pkgOpts=(matId,cb,q)=>(pkgByMat[matId]||[]).map(b=>{const used=pkgAlloc[b.id]||0,own=b.id===cb?num(q):0;return{...b,remaining:parseFloat((b.available-(used-own)).toFixed(3))}}).filter(b=>b.remaining>0.001||b.id===cb)

  const setPL=(mid,idx,f,v)=>setPacks(p=>({...p,[mid]:(p[mid]||[{batchId:'',qty:''}]).map((l,i)=>i===idx?{...l,[f]:v}:l)}))
  const addPL=mid=>setPacks(p=>({...p,[mid]:[...(p[mid]||[{batchId:'',qty:''}]),{batchId:'',qty:''}]}))
  const delPL=(mid,idx)=>setPacks(p=>({...p,[mid]:(p[mid]||[]).length>1?p[mid].filter((_,i)=>i!==idx):[{batchId:'',qty:''}]}))
  function przeliczPkg() {
    setPacks(prev=>{
      const remain={...pkgAvail}
      Object.values(prev).flat().forEach(l=>{}) // brak innych zakresów — pełna pula
      const pk={}
      plan.list.forEach(n=>{
        const lines = prev[n.material_id]||[{batchId:'',qty:''}]
        let need=n.qty
        pk[n.material_id]=lines.map(l=>{ if(!l.batchId) return {...l,qty:''}; const ex=num(l.qty); if(ex>0){need=parseFloat((need-ex).toFixed(3));return l} const av=remain[l.batchId]??0; const take=Math.max(0,Math.min(need,av)); remain[l.batchId]=av-take; need=parseFloat((need-take).toFixed(3)); return {...l,qty:take>0?String(parseFloat(take.toFixed(3))):''} })
      })
      // zachowaj materiały bez planu
      return { ...prev, ...pk }
    })
  }

  async function peekPakSeq() {
    const year=new Date().getFullYear()
    const { data } = await supabase.from('packing_operations').select('pack_number').like('pack_number',`PAK-${year}-%`).order('pack_number',{ascending:false}).limit(1)
    let n=1; if(data&&data.length&&data[0].pack_number) n=(parseInt(data[0].pack_number.split('-')[2]||'0',10))+1
    return String(n).padStart(4,'0')
  }

  async function confirmPack() {
    if (!order) return
    if (!bigbagId) { setError('Wybierz bigbag (półprodukt) do pakowania'); return }
    if (!(u>0)) { setError('Podaj liczbę sztuk do spakowania'); return }
    if (gramatura<=0) { setError('BOM nie ma gramatury'); return }
    const mass = parseFloat((u*gramatura).toFixed(3))
    if (mass > bigbag.available + 0.001) { setError(`Za mało w bigbagu: dostępne ${bigbag.available} kg (${maxUnitsFromBB} szt.)`); return }
    // walidacja opakowań: każda pozycja z planu ma pokrycie
    for (const n of plan.list) {
      const lines=(packs[n.material_id]||[]).filter(l=>l.batchId&&num(l.qty)>0)
      const sum=lines.reduce((s,l)=>s+num(l.qty),0)
      if (sum + 0.001 < n.qty) { setError(`Opakowanie ${mats[n.material_id]?.code||''}: przydzielono ${sum}, potrzeba ${n.qty}`); return }
    }
    for (const [bid,q] of Object.entries(pkgAlloc)) if (q>(pkgAvail[bid]||0)+0.001) { setError(`Partia opakowania ponad stan`); return }
    setSaving(true); setError('')
    const seq = await peekPakSeq()
    const year=new Date().getFullYear()
    const packNo=`PAK-${year}-${seq}`
    const now=new Date(), yy=String(now.getFullYear()).slice(2)
    const bbno = String(bigbag.bb_code?.match(/BB(\d+)/)?.[1] || '01').padStart(2,'0')
    const lot=`LP${yy}${seq}${bbno}`
    const today=now.toISOString().slice(0,10)

    const { data: op, error: e1 } = await supabase.from('packing_operations').insert({ order_id:order.id, packing_date:today, packed_by:packedBy||profile?.full_name||null, total_packed_kg:mass, pack_number:packNo, lot_code:lot }).select().single()
    if (e1) { setError(e1.message); setSaving(false); return }
    await supabase.from('packing_consumed').insert({ packing_operation_id:op.id, source_finished_good_id:bigbag.id, quantity_kg:mass })
    await supabase.from('finished_goods').insert({ production_batch_id:bigbag.production_batch_id, order_id:order.id, received_date:today, quantity_kg:mass, form:'spakowane', unit_type:'worek', unit_weight_kg:gramatura, unit_count:u, pallets:plan.pallets||null, bags_per_pallet:upp||null, packing_operation_id:op.id, lot_code:lot, created_by:profile?.id })
    const pcRows=[]
    plan.list.forEach(n=>{ (packs[n.material_id]||[]).forEach(l=>{ if(l.batchId&&num(l.qty)>0) pcRows.push({ packing_operation_id:op.id, packaging_batch_id:l.batchId, quantity:num(l.qty) }) }) })
    if (pcRows.length) await supabase.from('packaging_consumed').insert(pcRows)

    const packedAfter=(packedByOrder[order.id]||0)+u
    const newStatus = packedAfter+0.0001 >= parseInt(order.qty_units||0) ? 'spakowane' : order.status
    await supabase.from('orders').update({ status:newStatus, updated_at:new Date().toISOString() }).eq('id', order.id)

    setSaving(false); setView('list'); setOrder(null); load()
  }

  // ===== PACK VIEW =====
  if (view==='pack' && order) {
    return (
      <div>
        <div className="page-header">
          <div><div className="page-title">Pakowanie — {order.order_number}</div><div className="page-sub">{klient(order)} · {order.bom?.code_ext} · bigbag → worki wg BOM</div></div>
          <button className="btn btn-sm" onClick={()=>{setView('list');setOrder(null)}}>← Wróć</button>
        </div>
        {error && <div className="err-box" style={{marginBottom:10}}>{error}</div>}

        <div className="card" style={{marginBottom:12}}>
          <div className="fr">
            <div style={{flex:2}}><label>Bigbag (półprodukt) *</label>
              <select value={bigbagId} onChange={e=>{setBigbagId(e.target.value); const b=bigbags.find(x=>x.id===e.target.value); if(b&&gramatura>0){const mx=Math.floor(b.available/gramatura); setUnits(String(Math.min(mx,remainingUnits)||mx))}}}>
                <option value="">— wybierz bigbag —</option>
                {bigbags.map(b=><option key={b.id} value={b.id}>{b.bb_code} · LOT {b.lot_code} · dost. {b.available} kg</option>)}
              </select>
              {bigbags.length===0 && <span className="badge b-err" style={{fontSize:9,marginLeft:4}}>brak półproduktu dla tej receptury</span>}
            </div>
            <div><label>Sztuk do spakowania</label><input type="text" inputMode="numeric" value={units} onChange={e=>setUnits(e.target.value.replace(/[^0-9]/g,''))} /></div>
            <div><label>Pakujący</label><input value={packedBy} onChange={e=>setPackedBy(e.target.value)} placeholder="imię i nazwisko" /></div>
          </div>
          <div className="muted" style={{fontSize:12,marginTop:6}}>
            Cel zlecenia: <b>{fmt(order.qty_units)}</b> szt · spakowano: <b>{fmt(packedByOrder[order.id]||0)}</b> · pozostało: <b>{fmt(remainingUnits)}</b>
            {bigbag && <> · z bigbaga max: <b>{maxUnitsFromBB}</b> szt ({fmt(bigbag.available)} kg) · masa teraz: <b>{fmt(u*gramatura)}</b> kg · palet: <b>{plan.pallets}</b></>}
          </div>
        </div>

        {u>0 && <>
          <div className="flex" style={{justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <div style={{fontSize:13,fontWeight:600,color:'#0F6E56'}}>Opakowania wg BOM — wybór partii (ręcznie)</div>
            <button className="btn btn-sm" style={{background:'#1D9E75',color:'#fff',borderColor:'#1D9E75'}} onClick={przeliczPkg}>⟳ Przelicz ilości</button>
          </div>
          {plan.list.length===0 && <div className="muted" style={{padding:8}}>BOM nie ma zdefiniowanych opakowań.</div>}
          {plan.list.map(n=>{
            const lines=packs[n.material_id]||[{batchId:'',qty:''}]
            const alloc=lines.reduce((s,l)=>s+num(l.qty),0), short=parseFloat((n.qty-alloc).toFixed(3))
            return (
              <div className="card" key={n.material_id} style={{marginBottom:8}}>
                <div className="flex" style={{justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <div style={{fontSize:12,fontWeight:500}}>{mats[n.material_id]?.code} — {mats[n.material_id]?.name} <span className="muted" style={{fontSize:10}}>({n.label})</span></div>
                  <div style={{fontSize:11}} className="muted">potrzeba: <b>{fmt(n.qty)}</b> {mats[n.material_id]?.unit} · przydz.: <b style={{color:Math.abs(short)<=0.001?'#085041':'#A32D2D'}}>{fmt(alloc)}</b>{short>0.001&&<span style={{color:'#A32D2D'}}> (brak {fmt(short)})</span>}<button className="btn btn-sm" style={{marginLeft:8,padding:'1px 7px'}} onClick={()=>addPL(n.material_id)}>+ partia</button></div>
                </div>
                {(pkgByMat[n.material_id]||[]).length===0 && <div className="badge b-err" style={{fontSize:9,marginBottom:4}}>brak tego opakowania na magazynie</div>}
                {lines.map((l,li)=>{const opts=pkgOpts(n.material_id,l.batchId,l.qty);return(
                  <div key={li} className="flex" style={{gap:8,marginBottom:4,alignItems:'center'}}>
                    <select value={l.batchId||''} onChange={e=>setPL(n.material_id,li,'batchId',e.target.value)} style={{minWidth:230,flex:1}}><option value="">— wybierz partię —</option>{opts.map(b=><option key={b.id} value={b.id}>{b.lot||'(bez nr)'} (pozostało {b.remaining})</option>)}</select>
                    <input type="text" inputMode="decimal" value={l.qty||''} onChange={e=>setPL(n.material_id,li,'qty',e.target.value)} style={{width:100,textAlign:'right'}} placeholder="ilość" />
                    {lines.length>1&&<button className="btn btn-sm btn-danger" style={{padding:'2px 7px'}} onClick={()=>delPL(n.material_id,li)}>×</button>}
                  </div>)})}
              </div>
            )
          })}
        </>}

        <div className="flex" style={{justifyContent:'flex-end',gap:8,marginTop:12}}>
          <button className="btn" onClick={()=>{setView('list');setOrder(null)}}>Anuluj</button>
          <button className="btn btn-primary" onClick={confirmPack} disabled={saving}>{saving?'Pakowanie...':'Spakuj (nadaj LOT)'}</button>
        </div>
      </div>
    )
  }

  // ===== LIST =====
  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Pakowanie</div><div className="page-sub">Pakowanie bigbagów w worki wg BOM — ręczny wybór partii opakowań</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto'}}>
        <table style={{minWidth:860}}>
          <thead><tr><th>Nr zlecenia</th><th>Klient</th><th>Wyrób (BOM)</th><th style={{textAlign:'right'}}>Cel (szt.)</th><th style={{textAlign:'right'}}>Spakowano</th><th style={{textAlign:'right'}}>Pozostało</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && salesOrders.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'#888'}}>Brak zleceń do pakowania</td></tr>}
            {!loading && salesOrders.map(o=>{const packed=packedByOrder[o.id]||0,target=parseInt(o.qty_units||0),rem=Math.max(0,target-packed);return(
              <tr key={o.id}>
                <td><span className="lot">{o.order_number||'—'}</span></td>
                <td style={{fontSize:12}}>{klient(o)}</td>
                <td style={{fontWeight:500,fontSize:12}}>{o.bom?.code_ext||'—'}</td>
                <td style={{textAlign:'right'}}>{fmt(target)}</td>
                <td style={{textAlign:'right',color:'#085041'}}>{fmt(packed)}</td>
                <td style={{textAlign:'right',fontWeight:600}}>{fmt(rem)}</td>
                <td>{canEdit && rem>0 && <button className="btn btn-sm btn-primary" onClick={()=>openPack(o)}>Pakuj</button>}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}
