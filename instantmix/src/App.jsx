import { useState, useEffect, createContext, useContext, Component } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Receptury from './pages/Receptury'
import Skladniki from './pages/Skladniki'
import PrzyjecieDostawy from './pages/PrzyjecieDostawy'
import Kalkulator from './pages/Kalkulator'
import Produkcja from './pages/Produkcja'
import Pakowanie from './pages/Pakowanie'
import Dashboard from './pages/Dashboard'
import Eksport from './pages/Eksport'
import Magazyn from './pages/Magazyn'
import Zlecenia from './pages/Zlecenia'
import MagazynWG from './pages/MagazynWG'
import Klienci from './pages/Klienci'
import Dostawcy from './pages/Dostawcy'
import MagazynOpakowan from './pages/MagazynOpakowan'
import Bom from './pages/Bom'
import ZamowieniaZakupu from './pages/ZamowieniaZakupu'
import { ALL_TABS } from './lib/nav'
import './index.css'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// Mapowanie id zakładki -> komponent. Brak w mapie => placeholder "w budowie".
const COMPONENTS = {
  zlecenia: Zlecenia,
  dostawcy: Dostawcy,
  magazyn_opakowan: MagazynOpakowan,
  bom: Bom,
  zamowienia_zakupu: ZamowieniaZakupu,
  klienci: Klienci,
  magazyn: Magazyn,
  skladniki: Skladniki,
  receptury: Receptury,
  partie: PrzyjecieDostawy,
  kalkulator: Kalkulator,
  produkcja: Produkcja,
  pakowanie: Pakowanie,
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

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('Błąd zakładki:', err, info) }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding:40, maxWidth:800, margin:'0 auto' }}>
          <div style={{ fontSize:18, fontWeight:600, color:'#A32D2D', marginBottom:8 }}>Błąd na tej zakładce</div>
          <pre style={{ whiteSpace:'pre-wrap', fontSize:12, background:'#FCEBEB', border:'0.5px solid #F0B4B4', borderRadius:8, padding:12, color:'#791F1F' }}>{String(this.state.err && this.state.err.message || this.state.err)}</pre>
          <div style={{ color:'#5F5E5A', fontSize:12, marginTop:8 }}>Pozostałe zakładki działają — przełącz się na inną i wróć.</div>
        </div>
      )
    }
    return this.props.children
  }
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
        <ErrorBoundary key={page}>
          {PageComponent
            ? <PageComponent />
            : <Placeholder title={tabInfo?.label || 'Zakładka'} dept={tabInfo?.deptLabel || ''} />}
        </ErrorBoundary>
      </Layout>
    </AuthContext.Provider>
  )
}
