import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Produkcja() {
  const { profile } = useAuth()
  const canEdit = true // dostępy później

  const [running, setRunning] = useState([])
  const [done, setDone] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [items, setItems] = useState({})   // order_id -> [consumed lots]
  const [busy, setBusy] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const sel = '*, clients(number,name), bom(code_ext), recipes(code,name,version), production_batches(lot_number,quantity_kg,operator,foreman,created_at)'
    const [{ data: r }, { data: d }] = await Promise.all([
      supabase.from('orders').select(sel).eq('status','w_produkcji').order('planned_date',{ascending:true}),
      supabase.from('orders').select(sel).eq('status','wyprodukowane').order('produced_at',{ascending:false}).limit(20),
    ])
    setRunning(r || []); setDone(d || [])
    setLoading(false)
  }

  const klient = o => o.clients ? `${o.clients.number||''} ${o.clients.name||''}`.trim() : '—'
  const wyrob = o => o.bom?.code_ext || o.recipes?.code || '—'
  const fmt = v => parseFloat(v||0).toLocaleString('pl-PL')

  async function toggleItems(o) {
    if (expanded === o.id) { setExpanded(null); return }
    setExpanded(o.id)
    if (!items[o.id] && o.production_batch_id) {
      const { data } = await supabase.from('production_batch_items')
        .select('quantity_used_kg, fifo_order, ingredients(code,name), ingredient_batches(delivery_lot)')
        .eq('production_batch_id', o.production_batch_id)
        .order('fifo_order',{ascending:true})
      setItems(p => ({ ...p, [o.id]: data || [] }))
    }
  }

  async function markDone(o) {
    setBusy(o.id)
    await supabase.from('orders').update({ status:'wyprodukowane', produced_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id', o.id)
    setBusy(null); load()
  }
  async function revert(o) {
    setBusy(o.id)
    await supabase.from('orders').update({ status:'w_produkcji', produced_at:null, updated_at:new Date().toISOString() }).eq('id', o.id)
    setBusy(null); load()
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Produkcja</div><div className="page-sub">Zlecenia w toku — oznacz jako wyprodukowane po zmieszaniu</div></div>
        <button className="btn btn-sm" onClick={load}>↻</button>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#0F6E56', margin:'4px 0 8px' }}>W produkcji ({running.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', marginBottom:18 }}>
        <table style={{ minWidth:900 }}>
          <thead><tr><th style={{width:32}}></th><th>Nr zlecenia</th><th>Klient</th><th>Wyrób</th><th>Nr partii</th><th style={{textAlign:'right'}}>Masa</th><th>Operator</th><th>Start</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{textAlign:'center',padding:24,color:'#888'}}>Ładowanie...</td></tr>}
            {!loading && running.length===0 && <tr><td colSpan={9} style={{textAlign:'center',padding:24,color:'#888'}}>Brak zleceń w produkcji</td></tr>}
            {!loading && running.map(o => (
              <React.Fragment key={o.id}>
                <tr>
                  <td style={{textAlign:'center'}}><button onClick={() => toggleItems(o)} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:'#5F5E5A'}}>{expanded===o.id?'▲':'▼'}</button></td>
                  <td><span className="lot">{o.order_number||'—'}</span></td>
                  <td style={{fontSize:12}}>{klient(o)}</td>
                  <td style={{fontWeight:500,fontSize:12}}>{wyrob(o)}</td>
                  <td><span className="lot" style={{fontSize:11}}>{o.production_batches?.lot_number||'—'}</span></td>
                  <td style={{textAlign:'right',fontWeight:600}}>{fmt(o.production_batches?.quantity_kg)} kg</td>
                  <td style={{fontSize:12}}>{o.production_batches?.operator||'—'}</td>
                  <td className="muted" style={{fontSize:11}}>{o.production_batches?.created_at ? o.production_batches.created_at.slice(0,10) : '—'}</td>
                  <td>{canEdit && <button className="btn btn-sm btn-primary" onClick={() => markDone(o)} disabled={busy===o.id}>{busy===o.id?'...':'Wyprodukowane ✓'}</button>}</td>
                </tr>
                {expanded===o.id && (
                  <tr><td colSpan={9} style={{padding:0,background:'#F9F8F5'}}>
                    <div style={{padding:'8px 16px 12px 40px'}}>
                      <div style={{fontSize:12,fontWeight:500,color:'#0F6E56',marginBottom:8}}>Zużyte partie surowców (FIFO)</div>
                      {!items[o.id] ? <div className="muted" style={{fontSize:12}}>Ładowanie...</div> :
                        items[o.id].length===0 ? <div className="muted" style={{fontSize:12}}>Brak pozycji</div> : (
                        <table style={{width:'auto',minWidth:480}}>
                          <thead><tr><th>Składnik</th><th>Partia dostawy</th><th style={{textAlign:'right'}}>Zużyto</th></tr></thead>
                          <tbody>{items[o.id].map((it,i) => (
                            <tr key={i}><td style={{fontSize:12}}>{it.ingredients?.code} — {it.ingredients?.name}</td>
                            <td><span className="lot" style={{fontSize:11}}>{it.ingredient_batches?.delivery_lot||'—'}</span></td>
                            <td style={{textAlign:'right',fontWeight:500}}>{parseFloat(it.quantity_used_kg||0).toFixed(3)} kg</td></tr>
                          ))}</tbody>
                        </table>
                      )}
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize:13, fontWeight:600, color:'#5F5E5A', margin:'4px 0 8px' }}>Wyprodukowane — ostatnie ({done.length})</div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
        <table style={{ minWidth:760 }}>
          <thead><tr><th>Nr zlecenia</th><th>Klient</th><th>Wyrób</th><th>Nr partii</th><th style={{textAlign:'right'}}>Masa</th><th>Data</th><th></th></tr></thead>
          <tbody>
            {done.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:20,color:'#888'}}>Brak</td></tr>}
            {done.map(o => (
              <tr key={o.id}>
                <td><span className="lot">{o.order_number||'—'}</span></td>
                <td style={{fontSize:12}}>{klient(o)}</td>
                <td style={{fontWeight:500,fontSize:12}}>{wyrob(o)}</td>
                <td><span className="lot" style={{fontSize:11}}>{o.production_batches?.lot_number||'—'}</span></td>
                <td style={{textAlign:'right'}}>{fmt(o.production_batches?.quantity_kg)} kg</td>
                <td className="muted" style={{fontSize:11}}>{o.produced_at ? o.produced_at.slice(0,10) : '—'}</td>
                <td>{canEdit && <button className="btn btn-sm" onClick={() => revert(o)} disabled={busy===o.id}>Cofnij</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
