import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const SECTIONS = [
  { id:'skladniki',  label:'Składniki',      unit:'kg',   title:'Bilans magazynowy — Składniki' },
  { id:'opakowania', label:'Opakowania',     unit:'',     title:'Bilans magazynowy — Opakowania' },
  { id:'wg',         label:'Wyrób gotowy',   unit:'kg',   title:'Bilans magazynowy — Wyroby gotowe' },
]

// sumowanie kg+wartość po kluczu
function sumBy(arr, getKey, getQty, getVal) {
  const kg = {}, val = {}
  for (const it of (arr||[])) {
    const k = getKey(it); if (k==null) continue
    kg[k]  = (kg[k]||0)  + parseFloat(getQty(it)||0)
    val[k] = (val[k]||0) + parseFloat(getVal(it)||0)
  }
  return { kg, val }
}

export default function Inwentura() {
  const { profile } = useAuth()

  const [section, setSection] = useState('skladniki')
  const [dat1, setDat1] = useState(() => { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10) })
  const [dat2, setDat2] = useState(new Date().toISOString().slice(0,10))
  const [mode, setMode] = useState('miesiac')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  function setMiesiac() { const n=new Date(),y=n.getFullYear(),m=n.getMonth(); setDat1(`${y}-${String(m+1).padStart(2,'0')}-01`); setDat2(`${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`); setMode('miesiac') }
  function setKwartal() { const n=new Date(),y=n.getFullYear(),q=Math.floor(n.getMonth()/3),fm=q*3+1,lm=q*3+3; setDat1(`${y}-${String(fm).padStart(2,'0')}-01`); setDat2(`${y}-${String(lm).padStart(2,'0')}-${String(new Date(y,lm,0).getDate()).padStart(2,'0')}`); setMode('kwartal') }
  function setRok() { const y=new Date().getFullYear(); setDat1(`${y}-01-01`); setDat2(`${y}-12-31`); setMode('rok') }

  // ── SKŁADNIKI ──
  async function computeSkladniki(d1, d2) {
    const [{ data: ings }, { data: pBefore }, { data: pW }, { data: kBefore }, { data: kW }, { data: rBefore }, { data: rW }] = await Promise.all([
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('ingredient_batches').select('ingredient_id,quantity_kg,unit_price_pln').lt('received_date',d1),
      supabase.from('ingredient_batches').select('ingredient_id,quantity_kg,unit_price_pln').gte('received_date',d1).lte('received_date',d2),
      supabase.from('stock_corrections').select('delta_kg,ingredient_batches(ingredient_id,unit_price_pln)').lt('event_date',d1),
      supabase.from('stock_corrections').select('delta_kg,ingredient_batches(ingredient_id,unit_price_pln)').gte('event_date',d1).lte('event_date',d2),
      supabase.from('production_batch_items').select('ingredient_id,quantity_used_kg,ingredient_batches(unit_price_pln),production_batches(production_date)').lt('production_batches.production_date',d1),
      supabase.from('production_batch_items').select('ingredient_id,quantity_used_kg,ingredient_batches(unit_price_pln),production_batches(production_date)').gte('production_batches.production_date',d1).lte('production_batches.production_date',d2),
    ])
    const price = x => parseFloat(x||0)
    const boP = sumBy(pBefore, p=>p.ingredient_id, p=>p.quantity_kg, p=>price(p.unit_price_pln)*parseFloat(p.quantity_kg))
    const boK = sumBy(kBefore, k=>k.ingredient_batches?.ingredient_id, k=>k.delta_kg, k=>price(k.ingredient_batches?.unit_price_pln)*parseFloat(k.delta_kg))
    const boR = sumBy((rBefore||[]).filter(p=>p.production_batches?.production_date<d1), p=>p.ingredient_id, p=>p.quantity_used_kg, p=>price(p.ingredient_batches?.unit_price_pln)*parseFloat(p.quantity_used_kg))
    const przych = sumBy(pW, p=>p.ingredient_id, p=>p.quantity_kg, p=>price(p.unit_price_pln)*parseFloat(p.quantity_kg))
    const kor = sumBy(kW, k=>k.ingredient_batches?.ingredient_id, k=>k.delta_kg, k=>price(k.ingredient_batches?.unit_price_pln)*parseFloat(k.delta_kg))
    const rozch = sumBy((rW||[]).filter(p=>{const d=p.production_batches?.production_date;return d&&d>=d1&&d<=d2}), p=>p.ingredient_id, p=>p.quantity_used_kg, p=>price(p.ingredient_batches?.unit_price_pln)*parseFloat(p.quantity_used_kg))
    return (ings||[]).map(ing => mkRow(ing.id, ing.code, ing.name, 'kg', boP, boK, boR, przych, kor, rozch))
      .filter(nonEmpty)
  }

  // ── OPAKOWANIA ──
  async function computeOpakowania(d1, d2) {
    const [{ data: mats }, { data: pBefore }, { data: pW }, { data: kBefore }, { data: kW }, { data: consAll }] = await Promise.all([
      supabase.from('packaging_materials').select('id,code,name,unit').order('code'),
      supabase.from('packaging_batches').select('packaging_material_id,quantity,unit_price,received_date').lt('received_date',d1),
      supabase.from('packaging_batches').select('packaging_material_id,quantity,unit_price,received_date').gte('received_date',d1).lte('received_date',d2),
      supabase.from('packaging_corrections').select('delta_qty,event_date,packaging_batches(packaging_material_id,unit_price)').lt('event_date',d1),
      supabase.from('packaging_corrections').select('delta_qty,event_date,packaging_batches(packaging_material_id,unit_price)').gte('event_date',d1).lte('event_date',d2),
      supabase.from('packaging_consumed').select('quantity,packaging_batches(packaging_material_id,unit_price),packing_operations(packing_date)'),
    ])
    const price = x => parseFloat(x||0)
    const consBefore = (consAll||[]).filter(c => (c.packing_operations?.packing_date||'') < d1)
    const consW = (consAll||[]).filter(c => { const d=c.packing_operations?.packing_date; return d && d>=d1 && d<=d2 })
    const boP = sumBy(pBefore, p=>p.packaging_material_id, p=>p.quantity, p=>price(p.unit_price)*parseFloat(p.quantity))
    const boK = sumBy(kBefore, k=>k.packaging_batches?.packaging_material_id, k=>k.delta_qty, k=>price(k.packaging_batches?.unit_price)*parseFloat(k.delta_qty))
    const boR = sumBy(consBefore, c=>c.packaging_batches?.packaging_material_id, c=>c.quantity, c=>price(c.packaging_batches?.unit_price)*parseFloat(c.quantity))
    const przych = sumBy(pW, p=>p.packaging_material_id, p=>p.quantity, p=>price(p.unit_price)*parseFloat(p.quantity))
    const kor = sumBy(kW, k=>k.packaging_batches?.packaging_material_id, k=>k.delta_qty, k=>price(k.packaging_batches?.unit_price)*parseFloat(k.delta_qty))
    const rozch = sumBy(consW, c=>c.packaging_batches?.packaging_material_id, c=>c.quantity, c=>price(c.packaging_batches?.unit_price)*parseFloat(c.quantity))
    return (mats||[]).map(m => mkRow(m.id, m.code, m.name, m.unit||'szt.', boP, boK, boR, przych, kor, rozch))
      .filter(nonEmpty)
  }

  // ── WYRÓB GOTOWY (grupowanie po recepturze) ──
  async function computeWG(d1, d2) {
    const { data: allGoods } = await supabase.from('finished_goods').select('id,production_batch_id,quantity_kg')
    const batchIds = [...new Set((allGoods||[]).map(x=>x.production_batch_id).filter(Boolean))]
    const bv = {}
    if (batchIds.length) {
      const { data: pbi } = await supabase.from('production_batch_items').select('production_batch_id,quantity_used_kg,ingredient_batches(unit_price_pln)').in('production_batch_id', batchIds)
      for (const it of (pbi||[])) { bv[it.production_batch_id]=(bv[it.production_batch_id]||0)+parseFloat(it.ingredient_batches?.unit_price_pln||0)*parseFloat(it.quantity_used_kg||0) }
    }
    const fgVal = {}; (allGoods||[]).forEach(g => { fgVal[g.id]=bv[g.production_batch_id]||0 })
    const fgOrig = {}; (allGoods||[]).forEach(g => { fgOrig[g.id]=parseFloat(g.quantity_kg||0) })
    const [{ data: przyj }, { data: przyjB }, { data: wzP }, { data: wzB }, { data: corrP }, { data: corrB }] = await Promise.all([
      supabase.from('finished_goods').select('id,quantity_kg,received_date,production_batches(recipes(code,name))').gte('received_date',d1).lte('received_date',d2),
      supabase.from('finished_goods').select('id,quantity_kg,received_date,production_batches(recipes(code,name))').lt('received_date',d1),
      supabase.from('wz_documents').select('quantity_kg,issue_date,finished_good_id,finished_goods(production_batches(recipes(code,name)))').gte('issue_date',d1).lte('issue_date',d2),
      supabase.from('wz_documents').select('quantity_kg,issue_date,finished_good_id,finished_goods(production_batches(recipes(code,name)))').lt('issue_date',d1),
      supabase.from('fg_corrections').select('delta_kg,event_date,finished_good_id,finished_goods(production_batches(recipes(code,name)))').gte('event_date',d1).lte('event_date',d2),
      supabase.from('fg_corrections').select('delta_kg,event_date,finished_good_id,finished_goods(production_batches(recipes(code,name)))').lt('event_date',d1),
    ])
    const rr = it => it?.production_batches?.recipes || it?.finished_goods?.production_batches?.recipes
    const rk = it => { const r=rr(it); return r ? r.code+'||'+r.name : null }
    const keys=new Set(), boMap={}, przychMap={}, rozchMap={}, korMap={}, nameMap={}, codeMap={}
    const boValMap={}, przychValMap={}, rozchValMap={}, korValMap={}, wzBeforeValMap={}, corrBeforeValMap={}
    const share = (fgId, q) => fgOrig[fgId]>0 ? Math.round((parseFloat(q)/fgOrig[fgId])*(fgVal[fgId]||0)*100)/100 : 0
    for (const w of (wzB||[])) { const k=rk(w); if(!k)continue; keys.add(k); boMap[k]=(boMap[k]||0)-parseFloat(w.quantity_kg); wzBeforeValMap[k]=(wzBeforeValMap[k]||0)+share(w.finished_good_id,w.quantity_kg); nameMap[k]=rr(w).name; codeMap[k]=rr(w).code }
    for (const c of (corrB||[])) { const k=rk(c); if(!k)continue; keys.add(k); boMap[k]=(boMap[k]||0)+parseFloat(c.delta_kg); corrBeforeValMap[k]=(corrBeforeValMap[k]||0)+share(c.finished_good_id,c.delta_kg); nameMap[k]=rr(c).name; codeMap[k]=rr(c).code }
    for (const p of (przyjB||[])) { const k=rk(p); if(!k)continue; keys.add(k); boMap[k]=(boMap[k]||0)+parseFloat(p.quantity_kg); boValMap[k]=(boValMap[k]||0)+(fgVal[p.id]||0); nameMap[k]=rr(p).name; codeMap[k]=rr(p).code }
    for (const k of Object.keys(boValMap)) { boValMap[k]=Math.max(0,(boValMap[k]||0)-(wzBeforeValMap[k]||0)+(corrBeforeValMap[k]||0)) }
    for (const p of (przyj||[])) { const k=rk(p); if(!k)continue; keys.add(k); przychMap[k]=(przychMap[k]||0)+parseFloat(p.quantity_kg); przychValMap[k]=(przychValMap[k]||0)+(fgVal[p.id]||0); nameMap[k]=rr(p).name; codeMap[k]=rr(p).code }
    for (const w of (wzP||[])) { const k=rk(w); if(!k)continue; keys.add(k); rozchMap[k]=(rozchMap[k]||0)+parseFloat(w.quantity_kg); rozchValMap[k]=(rozchValMap[k]||0)+share(w.finished_good_id,w.quantity_kg); nameMap[k]=rr(w).name; codeMap[k]=rr(w).code }
    for (const c of (corrP||[])) { const k=rk(c); if(!k)continue; keys.add(k); korMap[k]=(korMap[k]||0)+parseFloat(c.delta_kg); korValMap[k]=(korValMap[k]||0)+share(c.finished_good_id,c.delta_kg); nameMap[k]=rr(c).name; codeMap[k]=rr(c).code }
    return [...keys].map(k => {
      const bo=parseFloat(Math.max(0,boMap[k]||0).toFixed(3)), przych=parseFloat((przychMap[k]||0).toFixed(3))
      const kor=parseFloat((korMap[k]||0).toFixed(3)), rozch=parseFloat((rozchMap[k]||0).toFixed(3))
      const bz=parseFloat(Math.max(0,bo+przych+kor-rozch).toFixed(3))
      const boVal=parseFloat((boValMap[k]||0).toFixed(2)), przychVal=parseFloat((przychValMap[k]||0).toFixed(2))
      const rozchVal=parseFloat((rozchValMap[k]||0).toFixed(2)), korVal=parseFloat((korValMap[k]||0).toFixed(2))
      const bzVal=parseFloat(Math.max(0,boVal+przychVal+korVal-rozchVal).toFixed(2))
      return { code:codeMap[k], name:nameMap[k], unit:'kg', bo, boVal, przych, przychVal, kor, korVal, rozch, rozchVal, bz, bzVal }
    }).filter(nonEmpty).sort((a,b)=>a.code.localeCompare(b.code))
  }

  function mkRow(id, code, name, unit, boP, boK, boR, przych, kor, rozch) {
    const bo=parseFloat(Math.max(0,(boP.kg[id]||0)+(boK.kg[id]||0)-(boR.kg[id]||0)).toFixed(3))
    const boVal=parseFloat(Math.max(0,(boP.val[id]||0)+(boK.val[id]||0)-(boR.val[id]||0)).toFixed(2))
    const pr=parseFloat((przych.kg[id]||0).toFixed(3)), prV=parseFloat((przych.val[id]||0).toFixed(2))
    const ko=parseFloat((kor.kg[id]||0).toFixed(3)), koV=parseFloat((kor.val[id]||0).toFixed(2))
    const ro=parseFloat((rozch.kg[id]||0).toFixed(3)), roV=parseFloat((rozch.val[id]||0).toFixed(2))
    const bz=parseFloat(Math.max(0,bo+pr+ko-ro).toFixed(3)), bzV=parseFloat(Math.max(0,boVal+prV+koV-roV).toFixed(2))
    return { code, name, unit, bo, boVal, przych:pr, przychVal:prV, kor:ko, korVal:koV, rozch:ro, rozchVal:roV, bz, bzVal:bzV }
  }
  function nonEmpty(r) { return r.bo>0 || r.przych>0 || r.kor!==0 || r.rozch>0 || r.bz>0 || r.boVal>0 }

  const compute = useCallback(async () => {
    setLoading(true)
    let data = []
    try {
      if (section==='skladniki') data = await computeSkladniki(dat1, dat2)
      else if (section==='opakowania') data = await computeOpakowania(dat1, dat2)
      else data = await computeWG(dat1, dat2)
    } catch (e) { data = [] }
    setRows(data); setLoading(false); setLoaded(true)
  }, [section, dat1, dat2])

  useEffect(() => { setRows([]); setLoaded(false) }, [section])

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{minimumFractionDigits:3,maximumFractionDigits:3})
  const fmtV = v => v>0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : v<0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'
  const sec = SECTIONS.find(s => s.id===section)
  const sum = key => rows.reduce((s,r)=>s+r[key],0)

  function printBilans() {
    const d1str=new Date(dat1).toLocaleDateString('pl-PL'), d2str=new Date(dat2).toLocaleDateString('pl-PL')
    const f3=v=>parseFloat(v||0).toFixed(3), f2=v=>parseFloat(v||0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})
    const body = rows.map((r,i)=>`<tr><td>${i+1}</td><td style="font-family:monospace;font-size:8px">${r.code}</td><td>${r.name}</td><td style="text-align:right">${f3(r.bo)}</td><td style="text-align:right;color:#0C447C">${r.boVal>0?f2(r.boVal):'—'}</td><td style="text-align:right;color:#085041">${f3(r.przych)}</td><td style="text-align:right;color:#085041">${r.przychVal>0?f2(r.przychVal):'—'}</td><td style="text-align:right;color:${r.kor<0?'#A32D2D':'#633806'}">${r.kor!==0?(r.kor>0?'+':'')+f3(r.kor):'—'}</td><td style="text-align:right">${r.kor!==0?f2(r.korVal):'—'}</td><td style="text-align:right;color:#7B3F00">${f3(r.rozch)}</td><td style="text-align:right;color:#7B3F00">${r.rozchVal>0?f2(r.rozchVal):'—'}</td><td style="text-align:right;font-weight:bold;color:#3C3489">${f3(r.bz)}</td><td style="text-align:right;font-weight:bold;color:#3C3489">${r.bzVal>0?f2(r.bzVal):'—'}</td></tr>`).join('')
    const suma = `<tr class="total"><td colspan="3" style="text-align:right">SUMA:</td><td style="text-align:right">${f3(sum('bo'))}</td><td style="text-align:right">${f2(sum('boVal'))}</td><td style="text-align:right;color:#085041">${f3(sum('przych'))}</td><td style="text-align:right;color:#085041">${f2(sum('przychVal'))}</td><td style="text-align:right">${f3(sum('kor'))}</td><td style="text-align:right">${f2(sum('korVal'))}</td><td style="text-align:right;color:#7B3F00">${f3(sum('rozch'))}</td><td style="text-align:right;color:#7B3F00">${f2(sum('rozchVal'))}</td><td style="text-align:right;font-weight:bold">${f3(sum('bz'))}</td><td style="text-align:right;font-weight:bold">${f2(sum('bzVal'))}</td></tr>`
    const empty = rows.length===0?`<tr><td colspan="13" style="text-align:center;padding:16px;color:#888;font-style:italic">Brak ruchów magazynowych w wybranym okresie</td></tr>`:''
    const uh = sec.unit ? ` (${sec.unit})` : ''
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>${sec.title}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9px;padding:14px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:8px;margin-bottom:10px}.company{font-size:15px;font-weight:bold;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#0F6E56;color:#fff;padding:4px 5px;border:1px solid #085041;font-size:7px;text-align:left}td{padding:3px 5px;border:1px solid #D3D1C7;font-size:8px}tr:nth-child(even) td{background:#FAFAF8}.total td{background:#E1F5EE!important;font-weight:bold}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}.sig-line{border-bottom:1.5px solid #333;margin-top:24px;margin-bottom:4px}.sig-label{font-size:8px;color:#888;text-transform:uppercase}@media print{@page{margin:8mm;size:A4 landscape}}</style></head><body><div class="header"><div><div class="company">InstantMix Pro</div><div style="font-size:12px;font-weight:bold;margin-top:3px">${sec.title}</div><div style="font-size:13px;font-weight:bold;color:#0F6E56;margin-top:2px">Okres: ${d1str} — ${d2str}</div></div><div style="text-align:right;font-size:9px;color:#555">Wygenerowano: ${new Date().toLocaleDateString('pl-PL')}<br>Wydrukował: ${profile?.full_name||'—'}</div></div><table><thead><tr><th style="width:18px">Lp.</th><th style="width:55px">Kod</th><th>Nazwa</th><th style="width:48px;text-align:right">BO${uh}</th><th style="width:58px;text-align:right">Wart. BO</th><th style="width:55px;text-align:right">Przychód${uh}</th><th style="width:60px;text-align:right">Wart. przych.</th><th style="width:48px;text-align:right">Korekty${uh}</th><th style="width:56px;text-align:right">Wart. kor.</th><th style="width:50px;text-align:right">Rozchód${uh}</th><th style="width:60px;text-align:right">Wart. rozch.</th><th style="width:48px;text-align:right">BZ${uh}</th><th style="width:60px;text-align:right">Wart. BZ</th></tr></thead><tbody>${rows.length===0?empty:body+suma}</tbody></table><div class="sig-grid"><div><div class="sig-label">Sporządził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Weryfikował</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div><script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  const uh = sec.unit ? ` (${sec.unit})` : ''

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Inwentura</div><div className="page-sub">Bilans magazynowy — BO / przychód / korekty / rozchód / BZ</div></div>
      </div>

      <div className="flex" style={{ gap:6, marginBottom:10, flexWrap:'wrap' }}>
        {SECTIONS.map(s => (
          <button key={s.id} className="btn btn-sm" onClick={() => setSection(s.id)}
            style={{ background:section===s.id?'#1D9E75':undefined, color:section===s.id?'#fff':undefined, borderColor:section===s.id?'#1D9E75':undefined }}>{s.label}</button>
        ))}
      </div>

      <div className="card" style={{ marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, flexWrap:'wrap', gap:8 }}>
          <span style={{ fontWeight:500, fontSize:13 }}>Okres bilansu</span>
          <div className="flex" style={{ gap:6 }}>
            <button className={`btn btn-sm ${mode==='miesiac'?'btn-primary':''}`} onClick={setMiesiac}>Bieżący miesiąc</button>
            <button className={`btn btn-sm ${mode==='kwartal'?'btn-primary':''}`} onClick={setKwartal}>Bieżący kwartał</button>
            <button className={`btn btn-sm ${mode==='rok'?'btn-primary':''}`} onClick={setRok}>Bieżący rok</button>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'auto auto auto auto auto 1fr', gap:10, alignItems:'end' }}>
          <div><label>Bilans otwarcia na</label><input type="date" value={dat1} onChange={e => { setDat1(e.target.value); setMode('custom') }} /></div>
          <div style={{ paddingBottom:6, color:'#888' }}>→</div>
          <div><label>Bilans zamknięcia na</label><input type="date" value={dat2} onChange={e => { setDat2(e.target.value); setMode('custom') }} /></div>
          <button className="btn btn-primary btn-sm" onClick={compute} disabled={loading}>{loading?'Obliczam...':'Oblicz bilans'}</button>
          {loaded && rows.length>0 && <button className="btn btn-sm" onClick={printBilans}>Drukuj bilans</button>}
        </div>
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:1000 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th>Kod</th><th>Nazwa</th>
            <th style={{ textAlign:'right', background:'#E6F1FB', color:'#0C447C' }}>BO{uh}</th>
            <th style={{ textAlign:'right', background:'#E6F1FB', color:'#0C447C', fontSize:10 }}>Wart. BO</th>
            <th style={{ textAlign:'right', background:'#E1F5EE', color:'#085041' }}>Przychód{uh}</th>
            <th style={{ textAlign:'right', background:'#E1F5EE', color:'#085041', fontSize:10 }}>Wart.</th>
            <th style={{ textAlign:'right', background:'#FFF8E1', color:'#E65100' }}>Korekty{uh}</th>
            <th style={{ textAlign:'right', background:'#FFF8E1', color:'#E65100', fontSize:10 }}>Wart.</th>
            <th style={{ textAlign:'right', background:'#FAEEDA', color:'#7B3F00' }}>Rozchód{uh}</th>
            <th style={{ textAlign:'right', background:'#FAEEDA', color:'#7B3F00', fontSize:10 }}>Wart.</th>
            <th style={{ textAlign:'right', background:'#EEEDFE', color:'#3C3489' }}>BZ{uh}</th>
            <th style={{ textAlign:'right', background:'#EEEDFE', color:'#3C3489', fontSize:10 }}>Wart. BZ</th>
          </tr></thead>
          <tbody>
            {!loaded && !loading && <tr><td colSpan={12} style={{ textAlign:'center', padding:24, color:'#888' }}>Wybierz okres i kliknij „Oblicz bilans".</td></tr>}
            {loading && <tr><td colSpan={12} style={{ textAlign:'center', padding:24, color:'#888' }}><span className="spinner" /> Obliczam bilans...</td></tr>}
            {loaded && !loading && rows.length===0 && <tr><td colSpan={12} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak ruchów magazynowych w wybranym okresie.</td></tr>}
            {!loading && rows.map((r,i) => (
              <tr key={i}>
                <td><span className="lot">{r.code}</span></td>
                <td style={{ fontWeight:500 }}>{r.name}{section==='opakowania' && <span className="muted" style={{ fontSize:10, marginLeft:4 }}>({r.unit})</span>}</td>
                <td style={{ textAlign:'right', color:'#0C447C' }}>{fmt(r.bo)}</td>
                <td style={{ textAlign:'right', color:'#0C447C', fontSize:11 }}>{fmtV(r.boVal)}</td>
                <td style={{ textAlign:'right', color:'#085041', fontWeight:500 }}>{fmt(r.przych)}</td>
                <td style={{ textAlign:'right', color:'#085041', fontSize:11 }}>{fmtV(r.przychVal)}</td>
                <td style={{ textAlign:'right', color: r.kor<0?'#A32D2D':r.kor>0?'#085041':'#888', fontWeight:500 }}>{r.kor!==0?(r.kor>0?'+':'')+fmt(r.kor):'—'}</td>
                <td style={{ textAlign:'right', color: r.korVal<0?'#A32D2D':'#E65100', fontSize:11 }}>{r.kor!==0?fmtV(r.korVal):'—'}</td>
                <td style={{ textAlign:'right', color:'#7B3F00', fontWeight:500 }}>{fmt(r.rozch)}</td>
                <td style={{ textAlign:'right', color:'#7B3F00', fontSize:11 }}>{fmtV(r.rozchVal)}</td>
                <td style={{ textAlign:'right', color:'#3C3489', fontWeight:700 }}>{fmt(r.bz)}</td>
                <td style={{ textAlign:'right', color:'#3C3489', fontWeight:600, fontSize:11 }}>{fmtV(r.bzVal)}</td>
              </tr>
            ))}
            {loaded && !loading && rows.length>0 && (
              <tr style={{ background:'#F1EFE8' }}>
                <td colSpan={2} style={{ fontWeight:500, textAlign:'right' }}>SUMA</td>
                <td style={{ textAlign:'right', fontWeight:700 }}>{fmt(sum('bo'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, fontSize:11 }}>{fmtV(sum('boVal'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#085041' }}>{fmt(sum('przych'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#085041', fontSize:11 }}>{fmtV(sum('przychVal'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#E65100' }}>{fmt(sum('kor'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#E65100', fontSize:11 }}>{fmtV(sum('korVal'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#7B3F00' }}>{fmt(sum('rozch'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#7B3F00', fontSize:11 }}>{fmtV(sum('rozchVal'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489' }}>{fmt(sum('bz'))}</td>
                <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489', fontSize:11 }}>{fmtV(sum('bzVal'))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
