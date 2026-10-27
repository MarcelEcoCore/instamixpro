import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const WH = [
  { id:'surowce',    label:'Surowce',       unit:'kg' },
  { id:'opakowania', label:'Opakowania',    unit:'szt.' },
  { id:'wg',         label:'Wyrób gotowy',  unit:'kg' },
]

export default function Inwentura() {
  const { profile } = useAuth()
  const canEdit = true // dostępy później

  const [wh, setWh] = useState('surowce')
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})     // batch_id -> policzono (string)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0,10))
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { loadWh(wh) }, [wh])

  async function loadWh(w) {
    setLoading(true); setError(''); setMsg(''); setCounts({})
    let data = []
    if (w === 'surowce') {
      const [{ data: st }, { data: ing }] = await Promise.all([
        supabase.from('v_stock').select('*').order('received_date',{ascending:true}),
        supabase.from('ingredients').select('id,code,name,unit'),
      ])
      const im = {}; (ing||[]).forEach(x => { im[x.id]=x })
      data = (st||[]).filter(s => parseFloat(s.current_kg||0) > 0.0005).map(s => ({
        id: s.id, item: im[s.ingredient_id] ? `${im[s.ingredient_id].code} — ${im[s.ingredient_id].name}` : '—',
        lot: s.delivery_lot, form:null, unit:'kg', system: parseFloat(s.current_kg||0),
      }))
    } else if (w === 'opakowania') {
      const [{ data: st }, { data: m }] = await Promise.all([
        supabase.from('v_packaging_stock').select('*').order('received_date',{ascending:true}),
        supabase.from('packaging_materials').select('id,code,name,unit'),
      ])
      const mm = {}; (m||[]).forEach(x => { mm[x.id]=x })
      data = (st||[]).filter(s => parseFloat(s.current_qty||0) > 0.0005).map(s => ({
        id: s.id, item: mm[s.packaging_material_id] ? `${mm[s.packaging_material_id].code} — ${mm[s.packaging_material_id].name}` : '—',
        lot: s.delivery_lot, form:null, unit: mm[s.packaging_material_id]?.unit || 'szt.', system: parseFloat(s.current_qty||0),
      }))
    } else {
      const { data: v } = await supabase.from('v_finished_goods').select('*').order('received_date',{ascending:true})
      data = (v||[]).filter(g => parseFloat(g.available_kg||0) > 0.0005).map(g => ({
        id: g.id, item: `${g.recipe_code||''} — ${g.recipe_name||''}`.trim(), lot: g.lot_number,
        form: g.form || 'luz', unit:'kg', system: parseFloat(g.available_kg||0),
      }))
    }
    setRows(data); setLoading(false)
  }

  const setCount = (id,v) => setCounts(p => ({ ...p, [id]: v }))
  const deltaOf = r => { const c = counts[r.id]; if (c==='' || c==null || isNaN(parseFloat(c))) return null; return parseFloat((parseFloat(c) - r.system).toFixed(3)) }

  const filtered = rows.filter(r => !search || r.item.toLowerCase().includes(search.toLowerCase()) || (r.lot||'').toLowerCase().includes(search.toLowerCase()))
  const diffs = rows.map(r => ({ r, d: deltaOf(r) })).filter(x => x.d !== null && Math.abs(x.d) > 0.0005)

  async function saveAll() {
    if (diffs.length === 0) { setMsg('Brak różnic do zapisania.'); return }
    setSaving(true); setError(''); setMsg('')
    const reason = `Inwentura ${eventDate}`
    let inserted = 0
    for (const { r, d } of diffs) {
      let err = null
      if (wh === 'surowce') {
        ({ error: err } = await supabase.from('stock_corrections').insert({ ingredient_batch_id:r.id, correction_type:'korekta_inwentury', delta_kg:d, reason, event_date:eventDate }))
      } else if (wh === 'opakowania') {
        ({ error: err } = await supabase.from('packaging_corrections').insert({ packaging_batch_id:r.id, correction_type:'korekta_inwentury', delta_qty:d, reason, event_date:eventDate, approved_by:profile?.id }))
      } else {
        ({ error: err } = await supabase.from('fg_corrections').insert({ finished_good_id:r.id, correction_type:'korekta_inwentury', delta_kg:d, reason, event_date:eventDate, approved_by:profile?.id }))
      }
      if (err) { setError(`Błąd przy zapisie (${r.item}): ${err.message}`); setSaving(false); return }
      inserted++
    }
    setSaving(false); setMsg(`Zapisano ${inserted} korekt inwentaryzacyjnych.`); loadWh(wh)
  }

  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})
  const unitLabel = WH.find(x => x.id===wh)?.unit || ''

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Inwentura</div><div className="page-sub">Spis z natury — różnice zapisywane jako korekty magazynowe</div></div>
        <div className="flex" style={{ gap:8 }}>
          <input className="search" placeholder="Szukaj: pozycja / nr partii..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:240 }} />
          <button className="btn btn-sm" onClick={() => loadWh(wh)}>↻</button>
        </div>
      </div>

      <div className="flex" style={{ gap:6, marginBottom:10, flexWrap:'wrap' }}>
        {WH.map(w => (
          <button key={w.id} className="btn btn-sm" onClick={() => setWh(w.id)}
            style={{ background:wh===w.id?'#1D9E75':undefined, color:wh===w.id?'#fff':undefined, borderColor:wh===w.id?'#1D9E75':undefined }}>{w.label}</button>
        ))}
        <div style={{ marginLeft:'auto' }} className="flex">
          <label style={{ fontSize:12, color:'#5F5E5A', marginRight:6, alignSelf:'center' }}>Data inwentury:</label>
          <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} style={{ width:150 }} />
        </div>
      </div>

      {error && <div className="err-box" style={{marginBottom:10}}>{error}</div>}
      {msg && <div style={{ background:'#E1F5EE', border:'0.5px solid #1D9E75', color:'#085041', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:13 }}>{msg}</div>}

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:720 }}>
          <thead style={{ position:'sticky', top:0, background:'#fff', zIndex:10 }}><tr>
            <th>Pozycja</th><th>Nr partii</th>{wh==='wg' && <th>Forma</th>}
            <th style={{textAlign:'right'}}>Stan systemowy</th>
            <th style={{textAlign:'right', width:140}}>Policzono</th>
            <th style={{textAlign:'right'}}>Różnica</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={wh==='wg'?6:5} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={wh==='wg'?6:5} style={{textAlign:'center',padding:24,color:'#888'}}>Brak pozycji na stanie</td></tr>}
            {!loading && filtered.map(r => {
              const d = deltaOf(r)
              return (
                <tr key={r.id}>
                  <td style={{fontWeight:500,fontSize:12}}>{r.item}</td>
                  <td><span className="lot" style={{fontSize:11}}>{r.lot||'—'}</span></td>
                  {wh==='wg' && <td><span className={`badge ${r.form==='spakowane'?'b-ok':'b-info'}`} style={{fontSize:10}}>{r.form}</span></td>}
                  <td style={{textAlign:'right',fontWeight:600}}>{fmt(r.system)} {r.unit}</td>
                  <td style={{textAlign:'right'}}>
                    <input type="number" step="0.001" value={counts[r.id]??''} onChange={e => setCount(r.id, e.target.value)}
                      placeholder={fmt(r.system)} style={{ width:110, textAlign:'right', padding:'4px 6px', fontSize:12 }} />
                  </td>
                  <td style={{textAlign:'right', fontWeight:700, color: d==null?'#888' : Math.abs(d)<=0.0005?'#888' : d<0?'#A32D2D':'#085041'}}>
                    {d==null ? '—' : (d>0?'+':'')+fmt(d)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex" style={{ justifyContent:'space-between', marginTop:12, alignItems:'center' }}>
        <div className="muted" style={{ fontSize:13 }}>Różnic do zapisania: <b style={{ color: diffs.length?'#BA7517':'#5F5E5A' }}>{diffs.length}</b>{diffs.length>0 && ` (${unitLabel})`}</div>
        {canEdit && <button className="btn btn-primary" onClick={saveAll} disabled={saving || diffs.length===0}>{saving?'Zapisywanie...':`Zapisz różnice (${diffs.length})`}</button>}
      </div>
    </div>
  )
}
