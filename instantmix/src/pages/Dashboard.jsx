import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ST = [
  { id:'nowe',          label:'Nowe',          color:'#0C447C' },
  { id:'zaplanowane',   label:'Zaplanowane',   color:'#0C447C' },
  { id:'w_produkcji',   label:'W produkcji',   color:'#BA7517' },
  { id:'wyprodukowane', label:'Wyprodukowane', color:'#BA7517' },
  { id:'w_pakowaniu',   label:'W pakowaniu',   color:'#BA7517' },
  { id:'spakowane',     label:'Do wysyłki',    color:'#0F6E56' },
]

export default function Dashboard() {
  const [orders, setOrders] = useState([])
  const [surBrak, setSurBrak] = useState([])
  const [opakBrak, setOpakBrak] = useState([])
  const [expiring, setExpiring] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const in30 = new Date(Date.now()+30*864e5).toISOString().slice(0,10)
    const today = new Date().toISOString().slice(0,10)
    const [{ data: ords }, { data: st }, { data: ing }, { data: ps }, { data: pm }, { data: exp }] = await Promise.all([
      supabase.from('orders').select('order_number,status,qty_units,ship_date,planned_date,production_priority,clients(number,name),bom(code_ext)').order('ship_date',{ascending:true}),
      supabase.from('v_stock').select('ingredient_id,current_kg'),
      supabase.from('ingredients').select('id,code,name,min_stock,unit'),
      supabase.from('v_packaging_stock').select('packaging_material_id,current_qty'),
      supabase.from('packaging_materials').select('id,code,name,min_stock,unit'),
      supabase.from('ingredient_batches').select('delivery_lot,expiry_date,quantity_kg,ingredients(code,name)').eq('status','dopuszczona').gte('expiry_date',today).lte('expiry_date',in30).order('expiry_date'),
    ])
    setOrders(ords||[])
    // braki surowców
    const sMap = {}; (st||[]).forEach(s => { sMap[s.ingredient_id]=(sMap[s.ingredient_id]||0)+parseFloat(s.current_kg||0) })
    setSurBrak((ing||[]).map(i => ({ ...i, stan: sMap[i.id]||0 })).filter(i => parseFloat(i.min_stock||0)>0 && i.stan <= parseFloat(i.min_stock)).sort((a,b)=>a.stan-b.stan))
    // braki opakowań
    const pMap = {}; (ps||[]).forEach(s => { pMap[s.packaging_material_id]=(pMap[s.packaging_material_id]||0)+parseFloat(s.current_qty||0) })
    setOpakBrak((pm||[]).map(m => ({ ...m, stan: pMap[m.id]||0 })).filter(m => parseFloat(m.min_stock||0)>0 && m.stan <= parseFloat(m.min_stock)).sort((a,b)=>a.stan-b.stan))
    setExpiring(exp||[])
    setLoading(false)
  }

  const cnt = s => orders.filter(o => o.status===s).length
  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'
  const wyrob = o => o.bom?.code_ext || '—'
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL',{maximumFractionDigits:3})

  const kolejka = orders.filter(o => o.status==='zaplanowane').sort((a,b)=>(parseInt(a.production_priority||0))-(parseInt(b.production_priority||0)))
  const doPak = orders.filter(o => ['wyprodukowane','w_pakowaniu'].includes(o.status))

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Pulpit</div><div className="page-sub">Przegląd zleceń, kolejki i braków magazynowych</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>

      {loading ? <div style={{ padding:24, color:'#888' }}>Ładowanie...</div> : <>
        <div className="stat-grid">
          {ST.map(s => (
            <div className="stat-card" key={s.id}><div className="stat-label">{s.label}</div><div className="stat-val" style={{ color:s.color }}>{cnt(s.id)}</div></div>
          ))}
          <div className="stat-card"><div className="stat-label">Braki surowców</div><div className="stat-val" style={{ color: surBrak.length?'#A32D2D':'#5F5E5A' }}>{surBrak.length}</div></div>
          <div className="stat-card"><div className="stat-label">Braki opakowań</div><div className="stat-val" style={{ color: opakBrak.length?'#A32D2D':'#5F5E5A' }}>{opakBrak.length}</div></div>
          <div className="stat-card"><div className="stat-label">Surowce — wygasa ≤30 dni</div><div className="stat-val" style={{ color: expiring.length?'#BA7517':'#5F5E5A' }}>{expiring.length}</div></div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:8 }}>
          <Panel title={`Kolejka produkcji (${kolejka.length})`} color="#0F6E56">
            <SimpleTable cols={['#','Zlecenie','Klient','Wyrób','Data']} rows={kolejka.slice(0,10).map(o => [
              o.production_priority||'—', o.order_number||'—', klient(o), wyrob(o), o.planned_date||'—'
            ])} empty="Kolejka pusta" />
          </Panel>

          <Panel title={`Do spakowania (${doPak.length})`} color="#BA7517">
            <SimpleTable cols={['Zlecenie','Klient','Wyrób','Status']} rows={doPak.slice(0,10).map(o => [
              o.order_number||'—', klient(o), wyrob(o), o.status==='w_pakowaniu'?'W pakowaniu':'Wyprodukowane'
            ])} empty="Brak" />
          </Panel>

          <Panel title={`Braki surowców (${surBrak.length})`} color="#A32D2D">
            <SimpleTable cols={['Kod','Nazwa','Stan','Min']} rows={surBrak.slice(0,10).map(i => [
              i.code, i.name, `${fmt(i.stan)} ${i.unit||'kg'}`, fmt(i.min_stock)
            ])} empty="Brak alertów" />
          </Panel>

          <Panel title={`Braki opakowań (${opakBrak.length})`} color="#A32D2D">
            <SimpleTable cols={['Kod','Nazwa','Stan','Min']} rows={opakBrak.slice(0,10).map(m => [
              m.code, m.name, `${fmt(m.stan)} ${m.unit||'szt.'}`, fmt(m.min_stock)
            ])} empty="Brak alertów" />
          </Panel>
        </div>

        {expiring.length>0 && (
          <Panel title={`Surowce wygasające w 30 dni (${expiring.length})`} color="#BA7517" style={{ marginTop:16 }}>
            <SimpleTable cols={['Składnik','Nr partii','Przydatność','Ilość']} rows={expiring.slice(0,12).map(b => [
              b.ingredients ? `${b.ingredients.code} — ${b.ingredients.name}` : '—', b.delivery_lot||'—', b.expiry_date||'—', `${fmt(b.quantity_kg)} kg`
            ])} empty="—" />
          </Panel>
        )}
      </>}
    </div>
  )
}

function Panel({ title, color, children, style }) {
  return (
    <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflow:'hidden', ...style }}>
      <div style={{ fontSize:13, fontWeight:600, color, padding:'8px 12px', borderBottom:'0.5px solid #E3E1D8' }}>{title}</div>
      <div style={{ overflowX:'auto' }}>{children}</div>
    </div>
  )
}
function SimpleTable({ cols, rows, empty }) {
  return (
    <table style={{ width:'100%' }}>
      <thead><tr>{cols.map((c,i) => <th key={i} style={i>=2?{textAlign:i===cols.length-1?'right':'left'}:undefined}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.length===0 && <tr><td colSpan={cols.length} style={{ textAlign:'center', padding:16, color:'#888' }}>{empty}</td></tr>}
        {rows.map((r,ri) => <tr key={ri}>{r.map((cell,ci) => <td key={ci} style={{ fontSize:12, textAlign: ci===r.length-1?'right':'left' }}>{cell}</td>)}</tr>)}
      </tbody>
    </table>
  )
}
