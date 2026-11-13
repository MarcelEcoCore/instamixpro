import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import { DEPARTMENTS } from '../lib/nav'

const ROLE_LABELS = { admin:'Admin', technolog:'Technolog', brygadzista:'Brygadzista', sprzedaz:'Sprzedaż' }
const SIDEBAR_W = 210, TOPBAR_H = 52

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const date = now.toLocaleDateString('pl-PL', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' })
  const time = now.toLocaleTimeString('pl-PL', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', lineHeight:1.3 }}>
      <span style={{ fontSize:15, fontWeight:500, fontFamily:'monospace', color:'#1a1a18', letterSpacing:1 }}>{time}</span>
      <span style={{ fontSize:11, color:'#5F5E5A' }}>{date}</span>
    </div>
  )
}

export default function Layout({ page, setPage, children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'brygadzista'
  const [collapsed, setCollapsed] = useState(false)

  async function logout() { await supabase.auth.signOut() }

  return (
    <div>
      {/* Pasek górny — na stałe */}
      <div style={{ position:'fixed', top:0, left:0, right:0, height:TOPBAR_H, background:'#fff', borderBottom:'0.5px solid #D3D1C7', padding:'0 16px', display:'flex', alignItems:'center', gap:'12px', zIndex:300 }}>
        <button className="btn btn-sm" onClick={() => setCollapsed(c=>!c)} title="Pokaż/ukryj menu" style={{ padding:'4px 9px' }}>☰</button>
        <div style={{ fontSize:'15px', fontWeight:'500' }}>Instant<span style={{ color:'#1D9E75' }}>Mix</span> Pro</div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'14px' }}>
          <LiveClock />
          <div style={{ width:'0.5px', height:28, background:'#D3D1C7' }} />
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:28, height:28, borderRadius:'50%', background:'#CECBF6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:500, color:'#3C3489' }}>
              {profile?.full_name?.slice(0,2).toUpperCase()||'U'}
            </div>
            <div style={{ display:'flex', flexDirection:'column', lineHeight:1.3 }}>
              <span style={{ fontSize:13, color:'#1a1a18' }}>{profile?.full_name||'Użytkownik'}</span>
              <span style={{ fontSize:10, color:'#5F5E5A' }}>{ROLE_LABELS[role]||role}</span>
            </div>
            <button className="btn btn-sm" onClick={logout}>Wyloguj</button>
          </div>
        </div>
      </div>

      {/* Pasek boczny — na stałe */}
      {!collapsed && (
        <aside style={{ position:'fixed', top:TOPBAR_H, left:0, bottom:0, width:SIDEBAR_W, background:'#F7F6F1', borderRight:'0.5px solid #D3D1C7', overflowY:'auto', zIndex:200, padding:'10px 0' }}>
          {DEPARTMENTS.map(d => (
            <div key={d.id} style={{ marginBottom:6 }}>
              <div style={{ padding:'10px 16px 5px', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', color:'#0F6E56' }}>{d.label}</div>
              {d.tabs.map(t => {
                const active = page === t.id
                return (
                  <button key={t.id} onClick={() => setPage(t.id)}
                    style={{ display:'flex', alignItems:'center', gap:6, width:'100%', textAlign:'left', padding:'7px 16px 7px 24px', fontSize:13,
                      border:'none', cursor:'pointer', background: active?'#fff':'transparent',
                      color: active?'#0F6E56':'#3a3a36', fontWeight: active?600:400,
                      borderLeft: active?'3px solid #1D9E75':'3px solid transparent' }}
                    onMouseEnter={e=>{ if(!active) e.currentTarget.style.background='#EFEDE6' }}
                    onMouseLeave={e=>{ if(!active) e.currentTarget.style.background='transparent' }}>
                    <span>{t.label}</span>
                    {t.wip && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:999, background:'#FAEEDA', color:'#8a5a12', fontWeight:500 }}>wkrótce</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </aside>
      )}

      {/* Treść — odsunięta od paska górnego i bocznego */}
      <main style={{ marginTop:TOPBAR_H, marginLeft: collapsed?0:SIDEBAR_W, padding:'16px', minHeight:`calc(100vh - ${TOPBAR_H}px)`, transition:'margin-left .15s' }}>
        <div style={{ maxWidth:1400, margin:'0 auto' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
