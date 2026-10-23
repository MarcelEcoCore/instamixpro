// Struktura nawigacji działowej (dwupoziomowa: dział -> podzakładki)
// Jedno źródło prawdy dla App.jsx (routing) i Layout.jsx (menu).
// wip:true  => zakładka jeszcze nie zbudowana, pokazuje placeholder "w budowie".

export const DEPARTMENTS = [
  { id: 'sprzedaz', label: 'Sprzedaż', tabs: [
    { id: 'zlecenia',          label: 'Zamówienia sprzedaży' },
    { id: 'klienci',           label: 'Klienci' },
  ]},
  { id: 'zakupy', label: 'Zakupy', tabs: [
    { id: 'dostawcy',          label: 'Dostawcy' },
    { id: 'zamowienia_zakupu', label: 'Zamówienia zakupu',   wip: true },
    { id: 'magazyn',           label: 'Magazyn surowców' },
    { id: 'magazyn_opakowan',  label: 'Magazyn opakowań' },
    { id: 'skladniki',         label: 'Składniki (słownik)' },
  ]},
  { id: 'jakosc', label: 'Jakość', tabs: [
    { id: 'receptury',         label: 'Receptury' },
    { id: 'partie',            label: 'Przyjęcie dostawy' },
    { id: 'bom',               label: 'BOM',                 wip: true },
  ]},
  { id: 'produkcja', label: 'Produkcja', tabs: [
    { id: 'kalkulator',        label: 'Planowanie zleceń' },
    { id: 'produkcja',         label: 'Produkcja' },
    { id: 'pakowanie',         label: 'Pakowanie',           wip: true },
    { id: 'magazynwg',         label: 'Magazyn WG' },
    { id: 'inwentura',         label: 'Inwentura',           wip: true },
  ]},
  { id: 'pulpit', label: 'Pulpit', tabs: [
    { id: 'dashboard',         label: 'Dashboard' },
    { id: 'eksport',           label: 'Eksport / kopia' },
  ]},
]

// Wszystkie zakładki spłaszczone (pomocniczo)
export const ALL_TABS = DEPARTMENTS.flatMap(d => d.tabs.map(t => ({ ...t, dept: d.id, deptLabel: d.label })))

// Dział zawierający daną zakładkę
export function deptOfTab(tabId) {
  return DEPARTMENTS.find(d => d.tabs.some(t => t.id === tabId)) || DEPARTMENTS[0]
}

// Pierwsza niepusta zakładka działu
export function firstTabOf(deptId) {
  const d = DEPARTMENTS.find(x => x.id === deptId)
  return d ? d.tabs[0].id : DEPARTMENTS[0].tabs[0].id
}
