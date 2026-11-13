import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const CORR_LABELS = { korekta_inwentury:'Korekta inwentury', uszkodzenie:'Uszkodzenie', reklamacja:'Reklamacja', inne:'Inne' }

export default function MagazynWG() {
  const { profile } = useAuth()
  const canEdit = true

  const [goods, setGoods] = useState([])      // merged finished_goods + available
  const [wzDocs, setWzDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('polprodukt')
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [wzModal, setWzModal] = useState(false)
  const [wzGood, setWzGood] = useState(null)
  const [wzForm, setWzForm] = useState({})
  const [corrModal, setCorrModal] = useState(false)
  const [corrGood, setCorrGood] = useState(null)
  const [corrForm, setCorrForm] = useState({ correction_type:'korekta_inwentury', delta_kg:'', reason:'', event_date:new Date().toISOString().slice(0,10) })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: vfg }, { data: fgx }, { data: wz }] = await Promise.all([
      supabase.from('v_finished_goods').select('*'),
      supabase.from('finished_goods').select('id,bb_code,lot_code,order_id,orders(order_number,bom(code_ext))'),
      supabase.from('wz_documents').select('*').order('created_at',{ascending:false}).limit(30),
    ])
    const xmap={}; (fgx||[]).forEach(x=>{xmap[x.id]=x})
    const merged=(vfg||[]).map(g=>{ const x=xmap[g.id]||{}; return { ...g, bb_code:x.bb_code, lot_code:x.lot_code, order_id:x.order_id, order_number:x.orders?.order_number||g.order_number, bom_code:x.orders?.bom?.code_ext||null } })
    setGoods(merged); setWzDocs(wz||[]); setLoading(false)
  }

  const num = v => { const n=parseFloat(String(v==null?'':v).replace(',','.')); return isNaN(n)?0:n }
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})

  const avail = g => parseFloat(g.available_kg||0)
  const luz = goods.filter(g => (g.form!=='spakowane') && avail(g)>0.001)
  const spak = goods.filter(g => g.form==='spakowane' && avail(g)>0.001)

  function group(list, keyFn, labelFn) {
    const m={}
    list.forEach(g=>{ const k=keyFn(g)||'—'; if(!m[k]) m[k]={ key:k, label:labelFn(g), available:0, items:[] }; m[k].available+=avail(g); m[k].items.push(g) })
    return Object.values(m).sort((a,b)=>String(a.key).localeCompare(String(b.key)))
  }
  const q=search.toLowerCase()
  const luzGroups = group(luz, g=>g.recipe_code, g=>`${g.recipe_code} — ${g.recipe_name}`).filter(gr=>!q||gr.key.toLowerCase().includes(q)||gr.label.toLowerCase().includes(q))
  const spakGroups = group(spak, g=>g.bom_code||g.recipe_code, g=>g.bom_code?`${g.bom_code}`:`${g.recipe_code} — ${g.recipe_name}`).filter(gr=>!q||gr.key.toLowerCase().includes(q)||gr.label.toLowerCase().includes(q))

  // ── Korekta ──
  function openCorr(g){ setCorrGood(g); setCorrForm({ correction_type:'korekta_inwentury', delta_kg:'', reason:'', event_date:new Date().toISOString().slice(0,10) }); setError(''); setCorrModal(true) }
  async function saveCorr(){
    const delta=num(corrForm.delta_kg)
    if (!delta) { setError('Podaj wartość korekty (± kg)'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('fg_corrections').insert({ finished_good_id:corrGood.id, correction_type:corrForm.correction_type, delta_kg:delta, reason:corrForm.reason||null, event_date:corrForm.event_date, approved_by:profile?.id })
    setSaving(false); if (err) { setError(err.message); return }
    setCorrModal(false); load()
  }

  // ── WZ ──
  async function genWz(){ const y=new Date().getFullYear(); const { data }=await supabase.from('wz_documents').select('wz_number').ilike('wz_number',`WZ-${y}-%`).order('wz_number',{ascending:false}).limit(1); let n=1; if(data&&data.length){n=(parseInt(data[0].wz_number.split('-')[2])||0)+1} return `WZ-${y}-${String(n).padStart(4,'0')}` }
  function openWz(g){ setWzGood(g); setWzForm({ issue_date:new Date().toISOString().slice(0,10), quantity_kg:avail(g).toFixed(3), recipient:g.client||'', carrier:'', notes:'', unit_type:g.unit_type||'worek', pallets:g.pallets??'', unit_count:g.unit_count??'', unit_weight_kg:g.unit_weight_kg??'' }); setError(''); setWzModal(true) }
  async function saveWz(){
    const qty=num(wzForm.quantity_kg)
    if (!(qty>0)) { setError('Podaj ilość do wydania'); return }
    if (qty>avail(wzGood)+0.001) { setError(`Za dużo — dostępne ${avail(wzGood).toFixed(3)} kg`); return }
    setSaving(true); setError('')
    const wzNumber=await genWz()
    const { error: err } = await supabase.from('wz_documents').insert({ wz_number:wzNumber, finished_good_id:wzGood.id, order_id:wzGood.order_id||null, issue_date:wzForm.issue_date, quantity_kg:qty, recipient:wzForm.recipient||null, carrier:wzForm.carrier||null, notes:wzForm.notes||null, unit_type:wzForm.unit_type||null, pallets:wzForm.pallets===''?null:parseInt(wzForm.pallets), unit_count:wzForm.unit_count===''?null:parseInt(wzForm.unit_count), unit_weight_kg:wzForm.unit_weight_kg===''?null:num(wzForm.unit_weight_kg), issued_by:profile?.id })
    if (err) { setError(err.message); setSaving(false); return }
    // pełne wydanie zlecenia -> status wyslane
    if (wzGood.order_id && qty+0.001>=avail(wzGood)) await supabase.from('orders').update({ status:'wyslane', updated_at:new Date().toISOString() }).eq('id', wzGood.order_id)
    setSaving(false); setWzModal(false); printWz(wzNumber, wzGood, { ...wzForm, quantity_kg:qty }); load()
  }

  function printWz(wzNumber, good, form){
    const qty=parseFloat(form.quantity_kg).toFixed(3)
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>WZ ${wzNumber}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:14px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.wz-number{font-size:18px;font-weight:bold;color:#0F6E56;margin-top:4px}.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}.info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}.info-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}.info-value{font-size:13px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-bottom:14px}th{background:#0F6E56;color:#fff;padding:6px;font-size:9px;text-align:left;border:1px solid #085041}td{padding:6px;border:1px solid #D3D1C7;font-size:11px}.total td{background:#E1F5EE;font-weight:bold}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}.sig-line{border-bottom:1px solid #333;margin-top:28px;margin-bottom:4px}.sig-label{font-size:9px;color:#888;text-transform:uppercase}@media print{@page{margin:10mm;size:A4}}</style></head><body><div class="header"><div><div class="company">InstantMix Pro</div><div style="font-size:13px;font-weight:bold;margin-top:3px">Wydanie Zewnętrzne (WZ)</div><div class="wz-number">${wzNumber}</div></div><div style="text-align:right;font-size:10px;color:#555">Data wydania: <strong>${form.issue_date}</strong><br>Wystawił: <strong>${profile?.full_name||'—'}</strong></div></div><div class="info-grid"><div class="info-box"><div class="info-label">Odbiorca</div><div class="info-value">${form.recipient||'—'}</div></div><div class="info-box"><div class="info-label">Przewoźnik</div><div class="info-value">${form.carrier||'—'}</div></div><div class="info-box"><div class="info-label">Nr zlecenia</div><div class="info-value">${good.order_number||'—'}</div></div><div class="info-box"><div class="info-label">Wyrób (BOM)</div><div class="info-value">${good.bom_code||good.recipe_code}</div></div><div class="info-box"><div class="info-label">LOT</div><div class="info-value">${good.lot_code||'—'}</div></div><div class="info-box"><div class="info-label">Produkt</div><div class="info-value">${good.recipe_code} — ${good.recipe_name}</div></div></div><table><thead><tr><th>Lp.</th><th>Wyrób</th><th>LOT</th><th style="text-align:right">Palety</th><th style="text-align:right">Opakowań</th><th style="text-align:right">Ilość (kg)</th></tr></thead><tbody><tr><td>1</td><td>${good.bom_code||good.recipe_name}</td><td>${good.lot_code||'—'}</td><td style="text-align:right">${form.pallets||'—'}</td><td style="text-align:right">${form.unit_count||'—'}</td><td style="text-align:right;font-weight:bold">${qty}</td></tr><tr class="total"><td colspan="5" style="text-align:right">RAZEM:</td><td style="text-align:right">${qty} kg</td></tr></tbody></table>${form.notes?`<div style="font-size:10px;color:#555;margin-bottom:10px"><strong>Uwagi:</strong> ${form.notes}</div>`:''}<div class="sig-grid"><div><div class="sig-label">Wydał (magazyn)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Odebrał</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div><script>window.onload=function(){window.print()}</script></body></html>`
    const w=window.open('','_blank'); w.document.write(html); w.document.close()
  }

  const renderGroups = (groups, kind) => (
    <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
      <table style={{ minWidth:720 }}>
        <thead><tr><th style={{width:32}}></th><th>{kind==='luz'?'Produkt':'Kod BOM'}</th><th>{kind==='luz'?'':'Produkt'}</th><th style={{textAlign:'center'}}>Pozycji</th><th style={{textAlign:'right'}}>Dostępne (kg)</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={5} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
          {!loading && groups.length===0 && <tr><td colSpan={5} style={{textAlign:'center',padding:24,color:'#888'}}>Brak</td></tr>}
          {groups.map(gr=>(
            <React.Fragment key={gr.key}>
              <tr>
                <td style={{textAlign:'center'}}><button onClick={()=>setExpanded(expanded===kind+gr.key?null:kind+gr.key)} style={{background:'none',border:'none',cursor:'pointer',color:'#5F5E5A'}}>{expanded===kind+gr.key?'▲':'▼'}</button></td>
                <td><span className="lot">{gr.key}</span></td>
                <td style={{fontSize:12}}>{kind==='luz'?'':gr.items[0]?.recipe_name}</td>
                <td style={{textAlign:'center'}}>{gr.items.length}</td>
                <td style={{textAlign:'right',fontWeight:700,color:'#0F6E56'}}>{fmt(gr.available)}</td>
              </tr>
              {expanded===kind+gr.key && (
                <tr><td colSpan={5} style={{padding:0,background:'#F9F8F5'}}>
                  <div style={{padding:'8px 16px 12px 40px'}}>
                    <table style={{width:'auto',minWidth:560}}>
                      <thead><tr>{kind==='luz'?<th>Kod bigbaga</th>:<th>Zlecenie</th>}<th>LOT</th><th style={{textAlign:'right'}}>Dostępne (kg)</th><th></th></tr></thead>
                      <tbody>
                        {gr.items.map(g=>(
                          <tr key={g.id}>
                            <td style={{fontSize:11}}>{kind==='luz'?<span className="lot">{g.bb_code||'—'}</span>:(g.order_number||'—')}</td>
                            <td><span className="lot" style={{fontSize:11}}>{g.lot_code||'—'}</span></td>
                            <td style={{textAlign:'right',fontWeight:600}}>{fmt(avail(g))}</td>
                            <td><div className="flex" style={{gap:4}}>
                              {kind==='spakowane' && canEdit && <button className="btn btn-sm btn-primary" onClick={()=>openWz(g)}>WZ</button>}
                              {canEdit && <button className="btn btn-sm" onClick={()=>openCorr(g)}>Korekta</button>}
                            </div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Magazyn wyrobów gotowych</div><div className="page-sub">Półprodukt (bigbagi) i wyrób spakowany (wg BOM) · WZ i korekty</div></div>
        <div className="flex" style={{gap:8}}>
          <input className="search" placeholder="Szukaj..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:200}} />
          <button className="btn btn-sm" onClick={load}>↻</button>
        </div>
      </div>

      <div className="flex" style={{gap:6,marginBottom:10}}>
        {[['polprodukt','Półprodukt (bigbagi)'],['spakowane','Wyrób spakowany']].map(([v,l])=>(
          <button key={v} className="btn btn-sm" onClick={()=>{setSection(v);setExpanded(null)}} style={{background:section===v?'#1D9E75':undefined,color:section===v?'#fff':undefined,borderColor:section===v?'#1D9E75':undefined}}>{l}</button>
        ))}
      </div>

      {section==='polprodukt' ? renderGroups(luzGroups,'luz') : renderGroups(spakGroups,'spakowane')}

      <div style={{fontSize:13,fontWeight:600,color:'#5F5E5A',margin:'18px 0 8px'}}>Ostatnie WZ ({wzDocs.length})</div>
      <div style={{background:'#fff',border:'0.5px solid #D3D1C7',borderRadius:8,overflowX:'auto'}}>
        <table style={{minWidth:560}}>
          <thead><tr><th>Nr WZ</th><th>Data</th><th>Odbiorca</th><th style={{textAlign:'right'}}>Ilość (kg)</th></tr></thead>
          <tbody>
            {wzDocs.length===0 && <tr><td colSpan={4} style={{textAlign:'center',padding:16,color:'#888'}}>Brak</td></tr>}
            {wzDocs.map(w=>(<tr key={w.id}><td><span className="lot">{w.wz_number}</span></td><td className="muted" style={{fontSize:11}}>{w.issue_date}</td><td style={{fontSize:12}}>{w.recipient||'—'}</td><td style={{textAlign:'right',fontWeight:500}}>{fmt(w.quantity_kg)}</td></tr>))}
          </tbody>
        </table>
      </div>

      {/* Modal WZ */}
      <div className={`modal-overlay ${wzModal?'open':''}`} onClick={e=>e.target===e.currentTarget && setWzModal(false)}>
        <div className="modal" style={{maxWidth:540}}>
          <div className="modal-title">Wydanie (WZ) — {wzGood?.bom_code||wzGood?.recipe_code}</div>
          {wzGood && <div style={{background:'#F1EFE8',borderRadius:8,padding:10,marginBottom:10,fontSize:13}}>LOT: <b>{wzGood.lot_code}</b> · zlecenie: {wzGood.order_number||'—'} · dostępne: <b>{fmt(avail(wzGood))}</b> kg</div>}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data wydania</label><input type="date" value={wzForm.issue_date||''} onChange={e=>setWzForm(f=>({...f,issue_date:e.target.value}))} /></div>
            <div><label>Ilość (kg) *</label><input type="text" inputMode="decimal" value={wzForm.quantity_kg||''} onChange={e=>setWzForm(f=>({...f,quantity_kg:e.target.value}))} /></div>
          </div>
          <div className="fr">
            <div style={{flex:2}}><label>Odbiorca</label><input value={wzForm.recipient||''} onChange={e=>setWzForm(f=>({...f,recipient:e.target.value}))} /></div>
            <div><label>Przewoźnik</label><input value={wzForm.carrier||''} onChange={e=>setWzForm(f=>({...f,carrier:e.target.value}))} /></div>
          </div>
          <div className="fr">
            <div><label>Palety</label><input type="number" value={wzForm.pallets||''} onChange={e=>setWzForm(f=>({...f,pallets:e.target.value}))} /></div>
            <div><label>Opakowań</label><input type="number" value={wzForm.unit_count||''} onChange={e=>setWzForm(f=>({...f,unit_count:e.target.value}))} /></div>
          </div>
          <div><label>Uwagi</label><input value={wzForm.notes||''} onChange={e=>setWzForm(f=>({...f,notes:e.target.value}))} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={()=>setWzModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveWz} disabled={saving}>{saving?'Zapisywanie...':'Wydaj i drukuj WZ'}</button>
          </div>
        </div>
      </div>

      {/* Modal korekta */}
      <div className={`modal-overlay ${corrModal?'open':''}`} onClick={e=>e.target===e.currentTarget && setCorrModal(false)}>
        <div className="modal" style={{maxWidth:440}}>
          <div className="modal-title">Korekta — {corrGood?.lot_code||corrGood?.bb_code}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ</label><select value={corrForm.correction_type} onChange={e=>setCorrForm(f=>({...f,correction_type:e.target.value}))}>{Object.entries(CORR_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
            <div><label>Korekta (± kg) *</label><input type="text" inputMode="decimal" value={corrForm.delta_kg} onChange={e=>setCorrForm(f=>({...f,delta_kg:e.target.value}))} placeholder="np. -2 lub 1,5" /></div>
          </div>
          <div><label>Data</label><input type="date" value={corrForm.event_date} onChange={e=>setCorrForm(f=>({...f,event_date:e.target.value}))} /></div>
          <div><label>Powód</label><input value={corrForm.reason} onChange={e=>setCorrForm(f=>({...f,reason:e.target.value}))} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={()=>setCorrModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveCorr} disabled={saving}>{saving?'Zapisywanie...':'Zapisz korektę'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
