import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import * as XLSX from 'xlsx'

const MODULES_ADMIN = [
  { id: 'produkcja',  label: 'Produkcja',            desc: 'Wszystkie partie produkcyjne z recepturami i statusami', icon: '🏭' },
  { id: 'skladniki',  label: 'Składniki',            desc: 'Baza składników z alergenami, GMO i specyfikacjami',     icon: '🧪' },
  { id: 'partie',     label: 'Partie składników',    desc: 'Przyjęcia dostaw ze stanami, wartościami i korektami',   icon: '📦' },
  { id: 'dostawcy',   label: 'Dostawcy',             desc: 'Rejestr dostawców i przypisania składników',            icon: '🚚' },
  { id: 'opakowania', label: 'Magazyn opakowań',     desc: 'Materiały opakowaniowe i stany partii (FIFO)',          icon: '📦' },
  { id: 'receptury',  label: 'Receptury',            desc: 'Receptury ze składnikami i udziałami procentowymi',      icon: '📋' },
  { id: 'bom',        label: 'BOM (wyroby)',         desc: 'Składy wyrobów: worek, gramatura, paleta, dodatki',     icon: '🧱' },
  { id: 'zlecenia',   label: 'Zamówienia sprzedaży', desc: 'Zlecenia ze statusami, BOM i datami',                   icon: '📝' },
  { id: 'zakupy',     label: 'Zamówienia zakupu',    desc: 'ZZ z pozycjami (surowce i opakowania)',                icon: '🛒' },
  { id: 'kalkulator', label: 'Historia produkcji',   desc: 'Powiązania partii produkcyjnych ze składnikami (FIFO)', icon: '🔢' },
  { id: 'magazynwg',  label: 'Magazyn WG',           desc: 'Stany wyrobów gotowych i dokumenty WZ',                 icon: '🏪' },
  { id: 'klienci',    label: 'Kartoteka klientów',   desc: 'Lista klientów z numerami i powiązanymi recepturami',   icon: '👥' },
  { id: 'pelny',      label: 'Pełna kopia zapasowa', desc: 'Wszystkie moduły w jednym pliku — do archiwum',         icon: '💾' },
]

const MODULES_SPRZEDAZ = [
  { id: 'klienci',    label: 'Kartoteka klientów',   desc: 'Lista klientów z numerami i powiązanymi recepturami',   icon: '👥' },
  { id: 'magazynwg',  label: 'Magazyn WG',           desc: 'Stany wyrobów gotowych i dokumenty WZ',                 icon: '🏪' },
  { id: 'receptury',  label: 'Receptury',            desc: 'Receptury ze składnikami i udziałami procentowymi',      icon: '📋' },
  { id: 'zlecenia',   label: 'Zamówienia sprzedaży', desc: 'Zlecenia ze statusami, BOM i datami',                   icon: '📝' },
]

function today() { return new Date().toISOString().slice(0, 10) }
function fname(name) { return `InstantMix_${name}_${today()}.xlsx` }

function styleHeader(ws, range, color = '0F6E56') {
  if (!ws['!ref']) return
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C })
    if (!ws[addr]) continue
    ws[addr].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: color } }, alignment: { horizontal: 'center' } }
  }
}

async function fetchProdukcja() {
  const { data: prod } = await supabase.from('v_production').select('*').order('production_date', { ascending: false })
  return (prod || []).map(r => ({
    'Nr partii produkcji': r.lot_number, 'Kod receptury': r.recipe_code, 'Nazwa mieszanki': r.recipe_name,
    'Wersja receptury': r.recipe_version, 'Linia produkcyjna': r.production_line === 'bezglutenowa' ? 'Bezglutenowa' : 'Zwykła',
    'Klient': r.client || '', 'Data produkcji': r.production_date, 'Ilość (kg)': parseFloat(r.quantity_kg),
    'Status': r.status, 'Operator': r.operator || '', 'Brygadzista': r.foreman || '', 'Technolog': r.technologist || '', 'Uwagi': r.notes || '',
  }))
}

async function fetchSkladniki() {
  const { data } = await supabase.from('ingredients').select('*').order('code')
  return (data || []).map(r => ({
    'Kod składnika': r.code, 'Nazwa': r.name, 'Producent': r.producer || '', 'Dostawca': r.supplier || '',
    'Kraj pochodzenia': r.country_of_origin || '', 'Alergen': r.has_allergen ? 'TAK' : 'NIE', 'Typ alergenu': r.allergen_type || '',
    'GMO': r.gmo ? 'TAK' : 'NIE', 'Nr specyfikacji': r.spec_number || '', 'Data zatw. spec.': r.spec_approved_at || '',
    'Status': r.status, 'Data dodania': r.created_at?.slice(0, 10) || '',
  }))
}

async function fetchPartie() {
  const { data: b } = await supabase.from('ingredient_batches').select('*, ingredients(code,name)').order('received_date', { ascending: false })
  const { data: c } = await supabase.from('stock_corrections').select('*')
  const corrMap = {}
  for (const corr of (c || [])) { corrMap[corr.ingredient_batch_id] = (corrMap[corr.ingredient_batch_id]||0) + parseFloat(corr.delta_kg) }
  return (b || []).map(r => {
    const delta = corrMap[r.id] || 0, qty = parseFloat(r.quantity_kg), unitPrice = parseFloat(r.unit_price_pln || 0)
    const totalValue = parseFloat(r.total_value_pln || 0) || (unitPrice > 0 ? qty * unitPrice : 0)
    const currentKg = qty + delta, currentValue = unitPrice > 0 ? currentKg * unitPrice : 0
    return {
      'Kod składnika': r.ingredients?.code || '', 'Nazwa składnika': r.ingredients?.name || '', 'Nr partii dostawy': r.delivery_lot,
      'Nr faktury': r.invoice_number || '', 'Dostawca': r.supplier_name || '', 'Data produkcji': r.production_date || '',
      'Data ważności': r.expiry_date || '', 'Data przyjęcia': r.received_date, 'Ilość oryginalna (kg)': qty,
      'Cena jednostkowa (zł/kg)': unitPrice || '', 'Wartość przyjęcia (zł)': totalValue > 0 ? parseFloat(totalValue.toFixed(2)) : '',
      'Korekty (kg)': delta, 'Stan aktualny (kg)': parseFloat(currentKg.toFixed(3)),
      'Wartość aktualna (zł)': currentValue > 0 ? parseFloat(currentValue.toFixed(2)) : '', 'Lokalizacja': r.warehouse_location || '', 'Status': r.status,
    }
  })
}

async function fetchDostawcy() {
  const { data } = await supabase.from('suppliers').select('*').order('name')
  return (data || []).map(r => ({
    'Nazwa': r.name, 'NIP': r.nip || '', 'Kontakt': r.contact_person || '', 'Telefon': r.phone || '', 'E-mail': r.email || '',
    'Aktywny': r.active ? 'TAK' : 'NIE', 'Uwagi': r.notes || '', 'Data dodania': r.created_at?.slice(0,10) || '',
  }))
}
async function fetchPrzypisaniaDostawcow() {
  const { data } = await supabase.from('supplier_ingredients').select('*, suppliers(name), ingredients(code,name)')
  return (data || []).map(r => ({
    'Dostawca': r.suppliers?.name || '', 'Kod składnika': r.ingredients?.code || '', 'Nazwa składnika': r.ingredients?.name || '',
    'Aktualny': r.is_current ? 'TAK' : 'NIE', 'Nr specyfikacji': r.spec_number || '', 'Data zatw. spec.': r.spec_approved_at || '', 'Cena (zł)': r.price ?? '',
  }))
}

async function fetchOpakowania() {
  const { data: m } = await supabase.from('packaging_materials').select('id,code,name,type,unit,segment_code,min_stock')
  const { data: st } = await supabase.from('v_packaging_stock').select('*').order('received_date', { ascending: true })
  const mm = {}; (m||[]).forEach(x => { mm[x.id]=x })
  return (st || []).map(s => {
    const mat = mm[s.packaging_material_id] || {}
    return {
      'Kod': mat.code || '', 'Nazwa': mat.name || '', 'Typ': mat.type || '', 'Segment BOM': mat.segment_code || '',
      'Nr partii': s.delivery_lot || '', 'Data przyjęcia': s.received_date, 'Przyjęto': parseFloat(s.original_qty || 0),
      'Korekty': parseFloat(s.corrections_qty || 0), 'Stan aktualny': parseFloat(s.current_qty || 0), 'Jedn.': mat.unit || '',
      'Cena jedn. (zł)': s.unit_price ?? '', 'Lokalizacja': s.warehouse_location || '',
    }
  })
}

async function fetchReceptury() {
  const { data } = await supabase.from('recipes').select('*, recipe_items(sort_order, percentage, ingredients(code,name,has_allergen,allergen_type))').order('code')
  const rows = []
  for (const r of (data || [])) {
    const items = (r.recipe_items || []).sort((a, b) => a.sort_order - b.sort_order)
    if (items.length === 0) {
      rows.push({ 'Kod receptury': r.code, 'Klient': r.client || '', 'Nazwa': r.name, 'Wersja': r.version, 'Linia': r.production_line, 'Status': r.status, 'Data zatw.': r.approved_at || '', 'Data zmiany': r.change_date || '', 'Kod skł.': '', 'Nazwa skł.': '', 'Udział %': '', 'Alergen': '' })
    } else {
      items.forEach((it, i) => {
        rows.push({
          'Kod receptury': i === 0 ? r.code : '', 'Klient': i === 0 ? (r.client || '') : '', 'Nazwa': i === 0 ? r.name : '',
          'Wersja': i === 0 ? r.version : '', 'Linia': i === 0 ? r.production_line : '', 'Status': i === 0 ? r.status : '',
          'Data zatw.': i === 0 ? (r.approved_at || '') : '', 'Data zmiany': i === 0 ? (r.change_date || '') : '',
          'Kod skł.': it.ingredients?.code || '', 'Nazwa skł.': it.ingredients?.name || '', 'Udział %': parseFloat(it.percentage),
          'Alergen': it.ingredients?.has_allergen ? it.ingredients.allergen_type : '',
        })
      })
    }
  }
  return rows
}

async function fetchBom() {
  const { data } = await supabase.from('bom').select('*, clients(number,name), recipes(code,name,version), bom_items(qty_per,per,packaging_materials(code,name,unit))').order('code_ext')
  const rows = []
  for (const b of (data || [])) {
    const base = {
      'Kod wyrobu (BOM)': b.code_ext, 'Klient': b.clients ? `${b.clients.number||''} ${b.clients.name||''}`.trim() : '',
      'Receptura': b.recipes?.code || '', 'Nazwa': b.recipes?.name || '', 'Gramatura (kg/szt.)': parseFloat(b.gramatura_kg||0),
      'Szt./paletę': b.units_per_pallet || '', 'Status': b.status || '',
    }
    const items = b.bom_items || []
    if (items.length === 0) { rows.push({ ...base, 'Dodatek': '', 'Przelicznik': '', 'Na': '' }) }
    else items.forEach((it, i) => rows.push({
      ...(i===0 ? base : { 'Kod wyrobu (BOM)': '', 'Klient':'', 'Receptura':'', 'Nazwa':'', 'Gramatura (kg/szt.)':'', 'Szt./paletę':'', 'Status':'' }),
      'Dodatek': it.packaging_materials ? `${it.packaging_materials.code} — ${it.packaging_materials.name}` : '',
      'Przelicznik': parseFloat(it.qty_per||0), 'Na': it.per === 'paleta' ? 'paletę' : 'sztukę',
    }))
  }
  return rows
}

async function fetchZlecenia() {
  const { data } = await supabase.from('orders')
    .select('*, clients(number,name), bom(code_ext), recipes(code,name,version), production_batches(lot_number)')
    .order('ship_date', { ascending: false })
  return (data || []).map(r => ({
    'Nr zlecenia': r.order_number,
    'Klient': r.clients ? `${r.clients.number||''} ${r.clients.name||''}`.trim() : (r.client || ''),
    'Wyrób (BOM)': r.bom?.code_ext || '', 'Kod receptury': r.recipes?.code || '', 'Nazwa mieszanki': r.recipes?.name || '',
    'Ilość (szt.)': r.qty_units ?? '', 'Ilość (kg)': r.quantity_kg != null ? parseFloat(r.quantity_kg) : '',
    'Data wysyłki': r.ship_date || '', 'Data produkcji': r.planned_date || '', 'Status': r.status,
    'Nr partii produkcji': r.production_batches?.lot_number || '', 'Uwagi': r.notes || '', 'Data utworzenia': r.created_at?.slice(0, 10) || '',
  }))
}

async function fetchZakupy() {
  const { data } = await supabase.from('purchase_order_items')
    .select('*, ingredients(code,name), packaging_materials(code,name), purchase_orders(po_number,order_date,expected_date,status,suppliers(name))')
    .order('created_at', { ascending: false })
  return (data || []).map(r => {
    const po = r.purchase_orders || {}
    const poz = r.item_type === 'surowiec' ? (r.ingredients ? `${r.ingredients.code} — ${r.ingredients.name}` : '') : (r.packaging_materials ? `${r.packaging_materials.code} — ${r.packaging_materials.name}` : '')
    return {
      'Nr ZZ': po.po_number || '', 'Dostawca': po.suppliers?.name || '', 'Data ZZ': po.order_date || '', 'Termin': po.expected_date || '',
      'Typ': r.item_type, 'Pozycja': poz, 'Zamówiono': parseFloat(r.qty_ordered||0), 'Jedn.': r.unit || '',
      'Cena (zł)': r.unit_price ?? '', 'Status pozycji': r.status || '', 'Status ZZ': po.status || '',
    }
  })
}

async function fetchKalkulator() {
  const { data } = await supabase.from('production_batch_items').select('*, production_batches(lot_number, production_date, quantity_kg), ingredient_batches(delivery_lot, received_date), ingredients(code,name)').order('created_at', { ascending: false })
  return (data || []).map(r => ({
    'Nr partii produkcji': r.production_batches?.lot_number || '', 'Data produkcji': r.production_batches?.production_date || '',
    'Masa wsadu (kg)': r.production_batches?.quantity_kg || '', 'Kod składnika': r.ingredients?.code || '', 'Nazwa składnika': r.ingredients?.name || '',
    'Nr partii dostawy': r.ingredient_batches?.delivery_lot || '', 'Data przyjęcia partii': r.ingredient_batches?.received_date || '',
    'Użyto (kg)': parseFloat(r.quantity_used_kg), 'Kolejność FIFO': r.fifo_order,
  }))
}

async function fetchMagazynWG() {
  const { data: fg } = await supabase.from('v_finished_goods').select('*').order('received_date', { ascending: false })
  const { data: wz } = await supabase.from('wz_documents').select('*').order('issue_date', { ascending: false })
  const fgRows = (fg || []).map(r => ({
    'Nr partii produkcji': r.lot_number, 'Kod receptury': r.recipe_code, 'Nazwa mieszanki': r.recipe_name, 'Wersja': r.recipe_version,
    'Nr zlecenia': r.order_number || '', 'Klient': r.client || '', 'Forma': r.form || 'luz', 'Data przyjęcia na mag.': r.received_date,
    'Przyjęto (kg)': parseFloat(r.original_kg), 'Wydano (kg)': parseFloat(r.issued_kg), 'Spakowano (kg)': parseFloat(r.packed_out_kg || 0),
    'Dostępne (kg)': parseFloat(r.available_kg), 'Palety': r.pallets || '', 'Lokalizacja': r.location || '', 'Uwagi': r.notes || '',
  }))
  const wzRows = (wz || []).map(r => ({
    'Nr WZ': r.wz_number, 'Data wydania': r.issue_date, 'Nr zlecenia': r.order_id || '', 'Odbiorca': r.recipient || '',
    'Przewoźnik': r.carrier || '', 'Ilość wydana (kg)': parseFloat(r.quantity_kg), 'Uwagi': r.notes || '',
  }))
  return { fgRows, wzRows }
}

async function fetchKlienci() {
  const { data } = await supabase.from('clients').select('*, recipes(code, name, version)').order('number')
  return (data || []).map(c => ({
    'Nr klienta': c.number, 'Nazwa klienta': c.name, 'Status': c.status || '', 'Uwagi': c.notes || '',
    'Liczba receptur': c.recipes?.length || 0, 'Receptury': (c.recipes || []).map(r => `${r.code} (${r.version})`).join(', '), 'Data dodania': c.created_at?.slice(0, 10) || '',
  }))
}

function buildWorkbook(sheets) {
  const wb = XLSX.utils.book_new()
  for (const { name, data } of sheets) {
    if (!data || data.length === 0) continue
    const ws = XLSX.utils.json_to_sheet(data)
    const range = XLSX.utils.decode_range(ws['!ref'])
    styleHeader(ws, range)
    ws['!cols'] = Object.keys(data[0]).map(k => ({ wch: Math.max(k.length, 12) }))
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }
  return wb
}

export default function Eksport() {
  const { profile } = useAuth()
  const isSprzedaz = profile?.role === 'sprzedaz'
  const modules = isSprzedaz ? MODULES_SPRZEDAZ : MODULES_ADMIN

  const [loading, setLoading] = useState({})
  const [lastExport, setLastExport] = useState({})

  async function doExport(moduleId) {
    setLoading(p => ({ ...p, [moduleId]: true }))
    try {
      let wb, filename
      if (moduleId === 'pelny') {
        const [prod, skl, par, dost, przyp, opak, rec, bom, zl, zak, kal, kli] = await Promise.all([
          fetchProdukcja(), fetchSkladniki(), fetchPartie(), fetchDostawcy(), fetchPrzypisaniaDostawcow(), fetchOpakowania(),
          fetchReceptury(), fetchBom(), fetchZlecenia(), fetchZakupy(), fetchKalkulator(), fetchKlienci(),
        ])
        const { fgRows, wzRows } = await fetchMagazynWG()
        wb = buildWorkbook([
          { name: 'Produkcja', data: prod }, { name: 'Składniki', data: skl }, { name: 'Partie składników', data: par },
          { name: 'Dostawcy', data: dost }, { name: 'Przypisania dostawców', data: przyp }, { name: 'Magazyn opakowań', data: opak },
          { name: 'Receptury', data: rec }, { name: 'BOM wyroby', data: bom },
          { name: 'Zamówienia sprzedaży', data: zl }, { name: 'Zamówienia zakupu', data: zak },
          { name: 'FIFO - powiązania', data: kal }, { name: 'Magazyn WG', data: fgRows }, { name: 'Dokumenty WZ', data: wzRows },
          { name: 'Kartoteka klientów', data: kli },
        ])
        filename = fname('PELNA_KOPIA')
      } else if (moduleId === 'magazynwg') {
        const { fgRows, wzRows } = await fetchMagazynWG()
        wb = buildWorkbook([{ name: 'Magazyn WG', data: fgRows }, { name: 'Dokumenty WZ', data: wzRows }])
        filename = fname('Magazyn_WG')
      } else if (moduleId === 'dostawcy') {
        const [dost, przyp] = await Promise.all([fetchDostawcy(), fetchPrzypisaniaDostawcow()])
        wb = buildWorkbook([{ name: 'Dostawcy', data: dost }, { name: 'Przypisania', data: przyp }])
        filename = fname('Dostawcy')
      } else {
        const fetchers = {
          produkcja: fetchProdukcja, skladniki: fetchSkladniki, partie: fetchPartie, opakowania: fetchOpakowania,
          receptury: fetchReceptury, bom: fetchBom, zlecenia: fetchZlecenia, zakupy: fetchZakupy, kalkulator: fetchKalkulator, klienci: fetchKlienci,
        }
        const names = {
          produkcja: 'Produkcja', skladniki: 'Składniki', partie: 'Partie składników', opakowania: 'Magazyn opakowań',
          receptury: 'Receptury', bom: 'BOM wyroby', zlecenia: 'Zamówienia sprzedaży', zakupy: 'Zamówienia zakupu', kalkulator: 'FIFO powiązania', klienci: 'Kartoteka klientów',
        }
        const data = await fetchers[moduleId]()
        wb = buildWorkbook([{ name: names[moduleId], data }])
        filename = fname(names[moduleId].replace(/ /g, '_'))
      }
      XLSX.writeFile(wb, filename)
      setLastExport(p => ({ ...p, [moduleId]: today() }))
    } catch (e) {
      alert('Błąd eksportu: ' + e.message)
    }
    setLoading(p => ({ ...p, [moduleId]: false }))
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Eksport danych / kopia zapasowa</div><div className="page-sub">Pobierz dane do pliku Excel (.xlsx)</div></div>
      </div>

      {!isSprzedaz && <div className="info-box" style={{ marginBottom: 16 }}>Dane są bezpieczne w Supabase (chmura). Eksport służy jako dodatkowa kopia zapasowa na Twoim dysku oraz do analizy w Excelu.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {modules.map(m => (
          <div key={m.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{m.icon}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 500, fontSize: 14, marginBottom: 3 }}>{m.label}</div><div className="muted">{m.desc}</div></div>
            </div>
            {lastExport[m.id] && <div style={{ fontSize: 11, color: '#085041', background: '#E1F5EE', padding: '3px 8px', borderRadius: 999, display: 'inline-block', alignSelf: 'flex-start' }}>Ostatni eksport: {lastExport[m.id]}</div>}
            <button className={`btn ${m.id === 'pelny' ? 'btn-primary' : ''}`} onClick={() => doExport(m.id)} disabled={loading[m.id]} style={{ alignSelf: 'flex-start' }}>
              {loading[m.id] ? <><span className="spinner" style={{ marginRight: 6 }} />Pobieranie...</> : `Pobierz ${m.label} (.xlsx)`}
            </button>
          </div>
        ))}
      </div>

      {!isSprzedaz && (
        <div className="card" style={{ marginTop: 8, background: '#F1EFE8' }}>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Zalecany harmonogram kopii zapasowych</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><div style={{ fontWeight: 500, color: '#0F6E56', marginBottom: 4 }}>Co tydzień</div><div className="muted">Produkcja + Partie + Magazyn WG + Zakupy — aktywne dane operacyjne</div></div>
            <div><div style={{ fontWeight: 500, color: '#0F6E56', marginBottom: 4 }}>Co miesiąc</div><div className="muted">Pełna kopia zapasowa — wszystkie moduły w jednym pliku</div></div>
            <div><div style={{ fontWeight: 500, color: '#0F6E56', marginBottom: 4 }}>Po każdej zmianie</div><div className="muted">Składniki + Receptury + BOM + Dostawcy + Klienci</div></div>
          </div>
        </div>
      )}
    </div>
  )
}
