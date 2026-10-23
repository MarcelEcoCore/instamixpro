import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Receptury from './pages/Receptury'
import Skladniki from './pages/Skladniki'
import Partie from './pages/Partie'
import Kalkulator from './pages/Kalkulator'
import Produkcja from './pages/Produkcja'
import Dashboard from './pages/Dashboard'
import Eksport from './pages/Eksport'
import Magazyn from './pages/Magazyn'
import Zlecenia from './pages/Zlecenia'
import MagazynWG from './pages/MagazynWG'
import Klienci from './pages/Klienci'
import Dostawcy from './pages/Dostawcy'
import { ALL_TABS } from './lib/nav'
import './index.css'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// Mapowanie id zakładki -> komponent. Brak w mapie => placeholder "w budowie".
const COMPONENTS = {
  zlecenia: Zlecenia,
  dostawcy: Dostawcy,
  klienci: Klienci,
  magazyn: Magazyn,
  skladniki: Skladniki,
  receptury: Receptury,
  partie: Partie,
  kalkulator: Kalkulator,
  produkcja: Produkcja,
  magazynwg: MagazynWG,
  dashboard: Dashboard,
  eksport: Eksport,
}

function Placeholder({ title, dept }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 20px', textAlign:'center', color:'#5F5E5A' }}>
      <div style={{ fontSize:38, marginBottom:12 }}>🚧</div>
      <div style={{ fontSize:18, fontWeight:600, color:'#1a1a18', marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:13, maxWidth:420 }}>
        Dział: <b>{dept}</b>. Ta zakładka jest w budowie — dodamy ją w kolejnym etapie przebudowy.
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('zlecenia')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
    setLoading(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#5F5E5A' }}>
      Ładowanie...
    </div>
  )

  if (!session) return <Login />

  const tabInfo = ALL_TABS.find(t => t.id === page) || ALL_TABS[0]
  const PageComponent = COMPONENTS[page]

  return (
    <AuthContext.Provider value={{ session, profile }}>
      <Layout page={page} setPage={setPage}>
        {PageComponent
          ? <PageComponent />
          : <Placeholder title={tabInfo?.label || 'Zakładka'} dept={tabInfo?.deptLabel || ''} />}
      </Layout>
    </AuthContext.Provider>
  )
}
