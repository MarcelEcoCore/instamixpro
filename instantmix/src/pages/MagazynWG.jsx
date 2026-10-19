import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const CORR_LABELS = {
  korekta_inwentury: 'Korekta inwentury',
  ubytek_uszkodzenie: 'Ubytek / uszkodzenie',
  utylizacja: 'Utylizacja',
  zwrot: 'Zwrot do produkcji',
  inne: 'Inne',
}

export default function MagazynWG() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = ['admin', 'technolog'].includes(profile?.role)

  const [products, setProducts] = useState([])
  const [goods, setGoods] = useState([])
  const [wzDocs, setWzDocs] = useState([])
  const [corrections, setCorrections] = useState([])
  const [prodBatches, setProdBatches] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [batchValues, setBatchValues] = useState({})
  const [luzBatchIds, setLuzBatchIds] = useState(new Set())
  const [expandedProduct, setExpandedProduct] = useState(null)
  const [expandedGood, setExpandedGood] = useState(null)
  const [search, setSearch] = useState('')
  const [filterView, setFilterView] = useState('aktywne')
  const [acceptModal, setAcceptModal] = useState(false)
  const [acceptForm, setAcceptForm] = useState({ production_batch_id: '', order_id: '', received_date: new Date().toISOString().slice(0, 10), quantity_kg: '', bag_count: '1', location: '', notes: '' })
  const [selectedProdBatch, setSelectedProdBatch] = useState(null)
  const [editModal, setEditModal] = useState(false)
  const [editGood, setEditGood] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [wzModal, setWzModal] = useState(false)
  const [wzGood, setWzGood] = useState(null)
  const [wzForm, setWzForm] = useState({ issue_date: new Date().toISOString().slice(0, 10), quantity_kg: '', recipient: '', carrier: '', notes: '', unit_type: 'worek', pallets: '', unit_count: '', unit_weight_kg: '' })
  const [wzEditModal, setWzEditModal] = useState(false)
  const [wzEditDoc, setWzEditDoc] = useState(null)
  const [wzEditForm, setWzEditForm] = useState({})
  const [savingWzEdit, setSavingWzEdit] = useState(false)
  const [wzDeleteConfirm, setWzDeleteConfirm] = useState(null)
  const [corrModal, setCorrModal] = useState(false)
  const [corrGood, setCorrGood] = useState(null)
  const [corrForm, setCorrForm] = useState({ correction_type: 'korekta_inwentury', delta_kg: '', reason: '', event_date: new Date().toISOString().slice(0, 10) })
  const [corrEditModal, setCorrEditModal] = useState(false)
  const [corrEditItem, setCorrEditItem] = useState(null)
  const [corrEditForm, setCorrEditForm] = useState({ correction_type: 'korekta_inwentury', delta_kg: '', reason: '', event_date: '' })
  const [savingCorrEdit, setSavingCorrEdit] = useState(false)
  const [corrDeleteConfirm, setCorrDeleteConfirm] = useState(null)
  const [inwenturaModal, setInwenturaModal] = useState(false)
  const [inwenturaRows, setInwenturaRows] = useState([])
  const [inwenturaDate, setInwenturaDate] = useState(new Date().toISOString().slice(0, 10))
  const [savingInwentura, setSavingInwentura] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [printWzData, setPrintWzData] = useState(null)
  const [bilansDat1, setBilansDat1] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [bilansDat2, setBilansDat2] = useState(new Date().toISOString().slice(0, 10))
  const [bilansMode, setBilansMode] = useState('miesiac')
  const [showBilans, setShowBilans] = useState(false)
  const [bilansData, setBilansData] = useState([])
  const [bilansLoading, setBilansLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: g }, { data: wz }, { data: pb }, { data: o }, { data: fc }] = await Promise.all([
      supabase.from('v_finished_goods').select('*').order('received_date', { ascending: false }),
      supabase.from('wz_documents').select('*').order('created_at', { ascending: false }),
      supabase.from('v_production').select('id,lot_number,recipe_code,recipe_name,quantity_kg,production_date,client').order('production_date', { ascending: false }),
      supabase.from('orders').select('id,order_number,client,quantity_kg,recipe_id,recipes(name,code)').eq('status', 'w_realizacji').order('ship_date'),
      supabase.from('fg_corrections').select('*').order('created_at', { ascending: false }),
    ])
    const batchIds = (g || []).map(x => x.production_batch_id).filter(Boolean)
    let bvMap = {}
    if (batchIds.length > 0) {
      const { data: pbi } = await supabase.from('production_batch_items').select('production_batch_id, quantity_used_kg, ingredient_batches(unit_price_pln)').in('production_batch_id', batchIds)
      for (const item of (pbi || [])) {
        const price = parseFloat(item.ingredient_batches?.unit_price_pln || 0)
        const qty = parseFloat(item.quantity_used_kg || 0)
        if (!bvMap[item.production_batch_id]) bvMap[item.production_batch_id] = 0
        bvMap[item.production_batch_id] += price * qty
      }
    }
    setBatchValues(bvMap)
    // partie, które mają wiersz luzu — ich spakowane wiersze to przepakowanie (nie liczymy ponownie)
    const luzBatches = new Set((g || []).filter(x => x.form !== 'spakowane').map(x => x.production_batch_id))
    setLuzBatchIds(luzBatches)
    const isTransform = (item) => item.form === 'spakowane' && luzBatches.has(item.production_batch_id)
    const acceptedBatchIds = new Set((g || []).map(x => x.production_batch_id))
    setGoods(g || [])
    setWzDocs(wz || [])
    setCorrections(fc || [])
    setProdBatches((pb || []).filter(p => !acceptedBatchIds.has(p.id)))
    setOrders(o || [])
    const productMap = {}
    for (const item of (g || [])) {
      const key = item.recipe_code + '||' + item.recipe_name
      if (!productMap[key]) productMap[key] = { recipe_code: item.recipe_code, recipe_name: item.recipe_name, recipe_version: item.recipe_version, original_kg: 0, issued_kg: 0, corrections_kg: 0, available_kg: 0, batchSet: new Set(), batch_count: 0 }
      productMap[key].original_kg += isTransform(item) ? 0 : parseFloat(item.original_kg || 0)
      productMap[key].issued_kg += parseFloat(item.issued_kg || 0)
      productMap[key].corrections_kg += parseFloat(item.corrections_kg || 0)
      productMap[key].available_kg += parseFloat(item.available_kg || 0)
      if (item.production_batch_id) productMap[key].batchSet.add(item.production_batch_id)
    }
    const productArr = Object.values(productMap)
    productArr.forEach(p => { p.batch_count = p.batchSet.size })
    setProducts(productArr)
    setLoading(false)
  }

  function goodsForProduct(recipe_code) { return goods.filter(g => g.recipe_code === recipe_code) }

  const filteredProducts = products.filter(p => {
    const q = search.toLowerCase()
    const matchQ = !q || p.recipe_name.toLowerCase().includes(q) || p.recipe_code.toLowerCase().includes(q)
    const matchView = filterView === 'wszystkie' ? true : filterView === 'aktywne' ? p.available_kg > 0 : filterView === 'wydane' ? p.available_kg <= 0 : true
    return matchQ && matchView
  })

  const stats = {
    products: products.length,
    available: products.filter(p => parseFloat(p.available_kg) > 0).length,
    totalKg: goods.reduce((s, g) => s + (isTransformRow(g) ? 0 : parseFloat(g.original_kg || 0)), 0).toFixed(1),
    availableKg: goods.reduce((s, g) => s + parseFloat(g.available_kg || 0), 0).toFixed(1),
  }

  const af = (k, v) => setAcceptForm(p => ({ ...p, [k]: v }))

  function handleBatchSelect(batchId) {
    af('production_batch_id', batchId)
    const pb = prodBatches.find(p => p.id === batchId)
    setSelectedProdBatch(pb || null)
    if (pb) af('quantity_kg', pb.quantity_kg)
  }

  async function saveAccept() {
    if (!acceptForm.production_batch_id) { setError('Wybierz partię produkcyjną'); return }
    if (!acceptForm.quantity_kg) { setError('Podaj ilość'); return }
    if (selectedProdBatch?.production_date && acceptForm.received_date < selectedProdBatch.production_date) { setError('Data przyjęcia nie może być wcześniejsza niż data produkcji'); return }
    setSaving(true); setError('')
    const qty = parseFloat(acceptForm.quantity_kg)
    const n = Math.max(1, parseInt(acceptForm.bag_count) || 1)
    const base = Math.floor((qty / n) * 1000) / 1000
    const rows = []
    let acc = 0
    for (let i = 0; i < n; i++) {
      const w = i === n - 1 ? parseFloat((qty - acc).toFixed(3)) : base
      acc = parseFloat((acc + base).toFixed(3))
      rows.push({ production_batch_id: acceptForm.production_batch_id, order_id: acceptForm.order_id || null, received_date: acceptForm.received_date, quantity_kg: w, location: acceptForm.location || null, notes: acceptForm.notes || null, form: 'luz', unit_type: 'big_bag', unit_count: 1, unit_weight_kg: w, created_by: profile?.id })
    }
    const { error: err } = await supabase.from('finished_goods').insert(rows)
    if (err) { setError(err.message); setSaving(false); return }
    if (acceptForm.order_id) await supabase.from('orders').update({ status: 'w_realizacji', updated_at: new Date().toISOString() }).eq('id', acceptForm.order_id)
    setSaving(false); setAcceptModal(false)
    setAcceptForm({ production_batch_id: '', order_id: '', received_date: new Date().toISOString().slice(0, 10), quantity_kg: '', bag_count: '1', location: '', notes: '' })
    setSelectedProdBatch(null); load()
  }

  function openEdit(good) { setEditGood(good); setEditForm({ received_date: good.received_date, quantity_kg: good.original_kg, location: good.location || '', notes: good.notes || '', form: good.form || 'luz', unit_type: good.unit_type || 'big_bag', unit_weight_kg: good.unit_weight_kg ?? '', unit_count: good.unit_count ?? '', pallets: good.pallets ?? '', bags_per_pallet: good.bags_per_pallet ?? '' }); setError(''); setEditModal(true) }

  async function saveEdit() {
    const isSpak = editForm.form === 'spakowane'
    // dla spakowanego ilość wynika z: palety × jednostek na palecie × waga jednostki
    const computedPacked = (parseInt(editForm.pallets)||0) * (parseInt(editForm.bags_per_pallet)||0) * (parseFloat(editForm.unit_weight_kg)||0)
    const newQty = (isSpak && computedPacked > 0) ? parseFloat(computedPacked.toFixed(3)) : parseFloat(editForm.quantity_kg)
    const oldQty = parseFloat(editGood.original_kg || 0)

    if (!editForm.received_date) { setError('Podaj datę przyjęcia'); return }
    if (!newQty || newQty <= 0) { setError(isSpak ? 'Podaj pakowanie (palety × jednostki × waga)' : 'Podaj ilość (kg)'); return }
    setSavingEdit(true); setError('')

    // SPAKOWANY: zmiana ilości → przelicz zużycie luzu (packing_consumed)
    if (isSpak && editGood.packing_operation_id && Math.abs(newQty - oldQty) > 0.0005) {
      const opId = editGood.packing_operation_id
      const { data: oldCons } = await supabase.from('packing_consumed').select('quantity_kg').eq('packing_operation_id', opId)
      const oldConsumedTotal = (oldCons||[]).reduce((s,r)=> s + parseFloat(r.quantity_kg||0), 0)
      const { data: vfg } = await supabase.from('v_finished_goods').select('*').order('received_date', { ascending: true })
      const luzAvailNow = (vfg||[]).filter(g => g.recipe_id === editGood.recipe_id && (g.form==='luz' || !g.form)).reduce((s,g)=> s + parseFloat(g.available_kg||0), 0)
      const maxPossible = luzAvailNow + oldConsumedTotal   // po zwolnieniu starego zużycia
      if (newQty > maxPossible + 0.0005) {
        setSavingEdit(false)
        setError(`Za mało luzu, by spakować ${newQty.toLocaleString('pl-PL')} kg. Maksymalnie: ${maxPossible.toFixed(3)} kg.`)
        return
      }
      const { error: delErr } = await supabase.from('packing_consumed').delete().eq('packing_operation_id', opId)
      if (delErr) { setSavingEdit(false); setError(delErr.message); return }
      const { data: vfg2 } = await supabase.from('v_finished_goods').select('*').order('received_date', { ascending: true })
      const luzFresh = (vfg2||[]).filter(g => g.recipe_id === editGood.recipe_id && (g.form==='luz' || !g.form) && parseFloat(g.available_kg) > 0.0005)
      let remaining = newQty
      const consumed = []
      for (const g of luzFresh) {
        if (remaining <= 0.0005) break
        const take = Math.min(remaining, parseFloat(g.available_kg))
        if (take > 0.0005) { consumed.push({ packing_operation_id: opId, source_finished_good_id: g.id, quantity_kg: parseFloat(take.toFixed(3)) }); remaining = parseFloat((remaining - take).toFixed(3)) }
      }
      if (consumed.length) {
        const { error: insErr } = await supabase.from('packing_consumed').insert(consumed)
        if (insErr) { setSavingEdit(false); setError(insErr.message); return }
      }
      await supabase.from('packing_operations').update({ total_packed_kg: newQty }).eq('id', opId)
    }

    const { error: err } = await supabase.from('finished_goods').update({
      received_date: editForm.received_date,
      quantity_kg: newQty,
      location: editForm.location || null,
      notes: editForm.notes || null,
      form: editForm.form || 'luz',
      unit_type: editForm.unit_type || 'big_bag',
      unit_weight_kg: editForm.unit_weight_kg === '' ? null : parseFloat(editForm.unit_weight_kg),
      unit_count: isSpak
        ? (((parseInt(editForm.pallets)||0) * (parseInt(editForm.bags_per_pallet)||0)) || null)
        : 1,
      pallets: editForm.pallets === '' ? null : parseInt(editForm.pallets),
      bags_per_pallet: editForm.bags_per_pallet === '' ? null : parseInt(editForm.bags_per_pallet),
      updated_at: new Date().toISOString()
    }).eq('id', editGood.id)
    setSavingEdit(false)
    if (err) { setError(err.message); return }
    setEditModal(false); load()
  }

  function openCorr(good) { setCorrGood(good); setCorrForm({ correction_type: 'korekta_inwentury', delta_kg: '', reason: '', event_date: new Date().toISOString().slice(0, 10) }); setError(''); setCorrModal(true) }

  async function saveCorr() {
    if (!corrForm.reason) { setError('Podaj przyczynę korekty'); return }
    if (corrForm.correction_type !== 'utylizacja' && !corrForm.delta_kg) { setError('Podaj ilość korekty'); return }
    setSaving(true); setError('')
    const delta = corrForm.correction_type === 'utylizacja' ? -parseFloat(corrGood.available_kg) : parseFloat(corrForm.delta_kg)
    const { error: err } = await supabase.from('fg_corrections').insert({ finished_good_id: corrGood.id, correction_type: corrForm.correction_type, delta_kg: delta, reason: corrForm.reason, event_date: corrForm.event_date, approved_by: profile?.id })
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false); setCorrModal(false); load()
  }

  function openCorrEdit(c) {
    setCorrEditItem(c)
    setCorrEditForm({ correction_type: c.correction_type, delta_kg: c.delta_kg, reason: c.reason || '', event_date: c.event_date })
    setError(''); setCorrEditModal(true)
  }
  async function saveCorrEdit() {
    if (!corrEditForm.reason) { setError('Podaj przyczynę korekty'); return }
    if (corrEditForm.delta_kg === '' || isNaN(parseFloat(corrEditForm.delta_kg))) { setError('Podaj ilość korekty'); return }
    setSavingCorrEdit(true); setError('')
    const { error: err } = await supabase.from('fg_corrections').update({
      correction_type: corrEditForm.correction_type,
      delta_kg: parseFloat(corrEditForm.delta_kg),
      reason: corrEditForm.reason,
      event_date: corrEditForm.event_date
    }).eq('id', corrEditItem.id)
    setSavingCorrEdit(false)
    if (err) { setError(err.message); return }
    setCorrEditModal(false); load()
  }
  async function deleteCorr(c) {
    await supabase.from('fg_corrections').delete().eq('id', c.id)
    setCorrDeleteConfirm(null); load()
  }

  function openInwentura() {
    const rows = goods.filter(g => parseFloat(g.available_kg) > 0).map(g => ({ id: g.id, lot_number: g.lot_number, recipe_name: g.recipe_name, recipe_code: g.recipe_code, available_kg: parseFloat(g.available_kg), inwentura_kg: parseFloat(g.available_kg).toFixed(3) }))
    setInwenturaRows(rows); setInwenturaDate(new Date().toISOString().slice(0, 10)); setError(''); setInwenturaModal(true)
  }

  async function saveInwentura() {
    setSavingInwentura(true); setError('')
    const toSave = inwenturaRows.filter(r => Math.abs(parseFloat(r.inwentura_kg) - r.available_kg) > 0.001)
    for (const r of toSave) {
      const delta = parseFloat(r.inwentura_kg) - r.available_kg
      await supabase.from('fg_corrections').insert({ finished_good_id: r.id, correction_type: 'korekta_inwentury', delta_kg: parseFloat(delta.toFixed(3)), reason: `Inwentura ${inwenturaDate}`, event_date: inwenturaDate, approved_by: profile?.id })
    }
    setSavingInwentura(false); setInwenturaModal(false); load()
  }

  async function generateWzNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('wz_documents').select('wz_number').ilike('wz_number', `WZ-${year}-%`).order('wz_number', { ascending: false }).limit(1)
    if (data && data.length > 0) { const last = parseInt(data[0].wz_number.split('-')[2]) || 0; return `WZ-${year}-${String(last + 1).padStart(4, '0')}` }
    return `WZ-${year}-0001`
  }

  function openWz(good) {
    const W = parseFloat(good.unit_weight_kg || 0)
    const avail = parseFloat(good.available_kg || 0)
    let pack
    if (good.form === 'spakowane' && W > 0) {
      const units = Math.round(avail / W)
      const B = good.bags_per_pallet ? parseInt(good.bags_per_pallet) : 0
      const pal = B > 0 ? Math.ceil(units / B) : ''
      pack = { unit_type: good.unit_type || 'worek', pallets: pal === '' ? '' : String(pal), unit_count: String(units), unit_weight_kg: String(W) }
    } else {
      pack = { unit_type: 'big_bag', pallets: '', unit_count: W > 0 ? String(Math.round(avail / W)) : '1', unit_weight_kg: W > 0 ? String(W) : '' }
    }
    setWzGood(good)
    setWzForm({ issue_date: new Date().toISOString().slice(0, 10), quantity_kg: avail.toFixed(3), recipient: good.client || '', carrier: '', notes: '', ...pack })
    setError(''); setWzModal(true)
  }
  const wf = (k, v) => setWzForm(p => ({ ...p, [k]: v }))
  // zmiana liczby/wagi opakowań przelicza wagę do wydania
  const wfUnits = (k, v) => setWzForm(p => {
    const next = { ...p, [k]: v }
    const u = parseFloat(next.unit_count) || 0
    const w = parseFloat(next.unit_weight_kg) || 0
    if (u > 0 && w > 0) next.quantity_kg = (u * w).toFixed(3)
    return next
  })

  // opis opakowania na liście WZ
  function wzPackText(wz) {
    const parts = []
    if (wz.pallets) parts.push(`${wz.pallets} pal`)
    if (wz.unit_count) { const u = wz.unit_type === 'worek' ? 'wor.' : (wz.unit_type === 'big_bag' ? 'BB' : 'szt.'); parts.push(`${wz.unit_count} ${u}`) }
    return parts.join(' · ')
  }

  async function saveWz() {
    if (!wzForm.quantity_kg || parseFloat(wzForm.quantity_kg) <= 0) { setError('Podaj ilość do wydania'); return }
    if (parseFloat(wzForm.quantity_kg) > parseFloat(wzGood.available_kg)) { setError(`Maksymalna dostępna ilość: ${wzGood.available_kg} kg`); return }
    setSaving(true); setError('')
    const wzNumber = await generateWzNumber()
    const { error: err } = await supabase.from('wz_documents').insert({ wz_number: wzNumber, finished_good_id: wzGood.id, order_id: wzGood.order_id || null, issue_date: wzForm.issue_date, quantity_kg: parseFloat(wzForm.quantity_kg), recipient: wzForm.recipient || null, carrier: wzForm.carrier || null, notes: wzForm.notes || null, unit_type: wzForm.unit_type || null, pallets: wzForm.pallets === '' ? null : parseInt(wzForm.pallets), unit_count: wzForm.unit_count === '' ? null : parseInt(wzForm.unit_count), unit_weight_kg: wzForm.unit_weight_kg === '' ? null : parseFloat(wzForm.unit_weight_kg), issued_by: profile?.id })
    if (err) { setError(err.message); setSaving(false); return }
    if (wzGood.order_id) {
      const { data: og } = await supabase.from('v_finished_goods').select('available_kg').eq('order_id', wzGood.order_id)
      const totalAvail = (og || []).reduce((s, r) => s + parseFloat(r.available_kg || 0), 0)
      if (totalAvail <= 0.001) await supabase.from('orders').update({ status: 'wyslane', updated_at: new Date().toISOString() }).eq('id', wzGood.order_id)
    }
    setSaving(false); setWzModal(false)
    setPrintWzData({ wzNumber, good: wzGood, form: { ...wzForm } }); load()
  }

  function openWzEdit(wz) {
    setWzEditDoc(wz)
    setWzEditForm({ issue_date: wz.issue_date, quantity_kg: wz.quantity_kg, recipient: wz.recipient||'', carrier: wz.carrier||'', notes: wz.notes||'', unit_type: wz.unit_type||'worek', pallets: wz.pallets??'', unit_count: wz.unit_count??'', unit_weight_kg: wz.unit_weight_kg??'' })
    setError(''); setWzEditModal(true)
  }

  async function saveWzEdit() {
    if (!wzEditForm.quantity_kg || parseFloat(wzEditForm.quantity_kg) <= 0) { setError('Podaj ilość'); return }
    setSavingWzEdit(true); setError('')
    const { error: err } = await supabase.from('wz_documents').update({ issue_date: wzEditForm.issue_date, quantity_kg: parseFloat(wzEditForm.quantity_kg), recipient: wzEditForm.recipient || null, carrier: wzEditForm.carrier || null, notes: wzEditForm.notes || null, unit_type: wzEditForm.unit_type || null, pallets: wzEditForm.pallets === '' ? null : parseInt(wzEditForm.pallets), unit_count: wzEditForm.unit_count === '' ? null : parseInt(wzEditForm.unit_count), unit_weight_kg: wzEditForm.unit_weight_kg === '' ? null : parseFloat(wzEditForm.unit_weight_kg) }).eq('id', wzEditDoc.id)
    setSavingWzEdit(false)
    if (err) { setError(err.message); return }
    setWzEditModal(false); load()
  }

  async function deleteWz(wz) {
    await supabase.from('wz_documents').delete().eq('id', wz.id)
    setWzDeleteConfirm(null); load()
  }

  function printWZ(wzNumber, good, form) {
    const qty = parseFloat(form.quantity_kg).toFixed(3)
    const formaTxt = form.unit_type === 'worek' ? 'Worek' : form.unit_type === 'big_bag' ? 'Big bag' : '—'
    const palTxt = (form.pallets !== '' && form.pallets != null) ? form.pallets : '—'
    const unitsTxt = (form.unit_count !== '' && form.unit_count != null) ? form.unit_count : '—'
    const uwTxt = (form.unit_weight_kg !== '' && form.unit_weight_kg != null && parseFloat(form.unit_weight_kg) > 0) ? parseFloat(form.unit_weight_kg).toFixed(3) + ' kg' : '—'
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>WZ ${wzNumber}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;padding:16px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:14px}.company{font-size:16px;font-weight:bold;color:#0F6E56}.wz-number{font-size:18px;font-weight:bold;color:#0F6E56;margin-top:4px}.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}.info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}.info-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}.info-value{font-size:13px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-bottom:14px}th{background:#0F6E56;color:#fff;padding:6px;font-size:9px;text-align:left;border:1px solid #085041}td{padding:6px;border:1px solid #D3D1C7;font-size:11px}.total td{background:#E1F5EE;font-weight:bold}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}.sig-line{border-bottom:1px solid #333;margin-top:28px;margin-bottom:4px}.sig-label{font-size:9px;color:#888;text-transform:uppercase}@media print{@page{margin:10mm;size:A4}}</style></head><body><div class="header"><div><div class="company">InstantMix Pro</div><div style="font-size:13px;font-weight:bold;margin-top:3px">Wydanie Zewnętrzne (WZ)</div><div class="wz-number">${wzNumber}</div></div><div style="text-align:right;font-size:10px;color:#555">Data wydania: <strong>${form.issue_date}</strong><br>Wygenerowano: ${new Date().toLocaleDateString('pl-PL')}<br>Wystawił: <strong>${profile?.full_name||'—'}</strong></div></div><div class="info-grid"><div class="info-box"><div class="info-label">Odbiorca</div><div class="info-value">${form.recipient||'—'}</div></div><div class="info-box"><div class="info-label">Przewoźnik</div><div class="info-value">${form.carrier||'—'}</div></div><div class="info-box"><div class="info-label">Nr zlecenia</div><div class="info-value">${good.order_number||'—'}</div></div><div class="info-box"><div class="info-label">Nr partii produkcyjnej</div><div class="info-value">${good.lot_number}</div></div><div class="info-box"><div class="info-label">Receptura</div><div class="info-value">${good.recipe_code} — ${good.recipe_name}</div></div><div class="info-box"><div class="info-label">Lokalizacja</div><div class="info-value">${good.location||'—'}</div></div></div><table><thead><tr><th>Lp.</th><th>Kod</th><th>Nazwa produktu</th><th>Forma</th><th style="text-align:right">Palety</th><th style="text-align:right">Opakowań</th><th style="text-align:right">Ilość (kg)</th><th>Nr partii</th></tr></thead><tbody><tr><td>1</td><td>${good.recipe_code}</td><td>${good.recipe_name} (${good.recipe_version})</td><td>${formaTxt}${uwTxt!=='—'?' · '+uwTxt:''}</td><td style="text-align:right">${palTxt}</td><td style="text-align:right">${unitsTxt}</td><td style="text-align:right;font-weight:bold">${qty}</td><td>${good.lot_number}</td></tr><tr class="total"><td colspan="6" style="text-align:right">RAZEM:</td><td style="text-align:right">${qty} kg</td><td></td></tr></tbody></table>${form.notes?`<div style="font-size:10px;color:#555;margin-bottom:10px"><strong>Uwagi:</strong> ${form.notes}</div>`:''}<div class="sig-grid"><div><div class="sig-label">Wydał (magazyn)</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Odebrał</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div><script>window.onload=function(){window.print()}</script></body></html>`
    const win = window.open('', '_blank'); win.document.write(html); win.document.close()
  }

  function setMiesiac() { const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); setBilansDat1(`${y}-${String(m+1).padStart(2,'0')}-01`); setBilansDat2(`${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`); setBilansMode('miesiac') }
  function setKwartal() { const now = new Date(); const y = now.getFullYear(); const q = Math.floor(now.getMonth()/3); const fm=q*3+1; const lm=q*3+3; setBilansDat1(`${y}-${String(fm).padStart(2,'0')}-01`); setBilansDat2(`${y}-${String(lm).padStart(2,'0')}-${String(new Date(y,lm,0).getDate()).padStart(2,'0')}`); setBilansMode('kwartal') }
  function setRok() { const y=new Date().getFullYear(); setBilansDat1(`${y}-01-01`); setBilansDat2(`${y}-12-31`); setBilansMode('rok') }

  async function obliczBilans() {
    setBilansLoading(true); setShowBilans(true)
    const d1=bilansDat1, d2=bilansDat2
    const { data: allGoods } = await supabase.from('finished_goods').select('id,production_batch_id,quantity_kg,form')
    const luzBatches = new Set((allGoods||[]).filter(x => x.form !== 'spakowane').map(x => x.production_batch_id))
    const allBatchIds = (allGoods||[]).map(x=>x.production_batch_id).filter(Boolean)
    const bvLocal = {}
    if (allBatchIds.length > 0) {
      const { data: pbi } = await supabase.from('production_batch_items').select('production_batch_id,quantity_used_kg,ingredient_batches(unit_price_pln)').in('production_batch_id', allBatchIds)
      for (const item of (pbi||[])) {
        const price = parseFloat(item.ingredient_batches?.unit_price_pln||0)
        const qty = parseFloat(item.quantity_used_kg||0)
        if (!bvLocal[item.production_batch_id]) bvLocal[item.production_batch_id] = 0
        bvLocal[item.production_batch_id] += price * qty
      }
    }
    const fgValueMap = {}
    for (const fg of (allGoods||[])) { fgValueMap[fg.id] = bvLocal[fg.production_batch_id] || 0 }
    const [{ data: przyjecia }, { data: przyjBefore }, { data: wzPeriod }, { data: wzBefore }, { data: corrPeriod }, { data: corrBefore }] = await Promise.all([
      supabase.from('finished_goods').select('id,quantity_kg,received_date,form,production_batch_id,production_batches(recipe_id,recipes(code,name))').gte('received_date',d1).lte('received_date',d2),
      supabase.from('finished_goods').select('id,quantity_kg,received_date,form,production_batch_id,production_batches(recipe_id,recipes(code,name))').lt('received_date',d1),
      supabase.from('wz_documents').select('quantity_kg,issue_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').gte('issue_date',d1).lte('issue_date',d2),
      supabase.from('wz_documents').select('quantity_kg,issue_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').lt('issue_date',d1),
      supabase.from('fg_corrections').select('delta_kg,event_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').gte('event_date',d1).lte('event_date',d2),
      supabase.from('fg_corrections').select('delta_kg,event_date,finished_good_id,finished_goods(production_batch_id,production_batches(recipe_id,recipes(code,name)))').lt('event_date',d1),
    ])
    function rk(item) { const r=item?.production_batches?.recipes||item?.finished_goods?.production_batches?.recipes; return r?r.code+'||'+r.name:null }
    function rn(item) { const r=item?.production_batches?.recipes||item?.finished_goods?.production_batches?.recipes; return r?r.name:'?' }
    function rc(item) { const r=item?.production_batches?.recipes||item?.finished_goods?.production_batches?.recipes; return r?r.code:'?' }
    const keys=new Set(), boMap={}, przychMap={}, rozchMap={}, korMap={}, nameMap={}, codeMap={}
    const boValMap={}, przychValMap={}, rozchValMap={}, wzBeforeValMap={}, corrBeforeValMap={}
    for (const w of (wzBefore||[])) {
      const k=rk(w); if(!k) continue; keys.add(k)
      boMap[k]=(boMap[k]||0)-parseFloat(w.quantity_kg)
      const fgId=w.finished_good_id, fgVal=fgValueMap[fgId]||0, fgOrigKg=(allGoods||[]).find(x=>x.id===fgId)?.quantity_kg||0
      wzBeforeValMap[k]=(wzBeforeValMap[k]||0)+(fgOrigKg>0?Math.round((parseFloat(w.quantity_kg)/parseFloat(fgOrigKg))*fgVal*100)/100:0)
      nameMap[k]=rn(w); codeMap[k]=rc(w)
    }
    for (const c of (corrBefore||[])) {
      const k=rk(c); if(!k) continue; keys.add(k)
      boMap[k]=(boMap[k]||0)+parseFloat(c.delta_kg)
      const fgId=c.finished_good_id, fgVal=fgValueMap[fgId]||0, fgOrigKg=(allGoods||[]).find(x=>x.id===fgId)?.quantity_kg||0
      corrBeforeValMap[k]=(corrBeforeValMap[k]||0)+(fgOrigKg>0?Math.round((parseFloat(c.delta_kg)/parseFloat(fgOrigKg))*fgVal*100)/100:0)
      nameMap[k]=rn(c); codeMap[k]=rc(c)
    }
    for (const p of (przyjBefore||[])) {
      if (p.form === 'spakowane' && luzBatches.has(p.production_batch_id)) continue   // przepakowanie luzu — nie przychód
      const k=rk(p); if(!k) continue; keys.add(k)
      boMap[k]=(boMap[k]||0)+parseFloat(p.quantity_kg)
      boValMap[k]=(boValMap[k]||0)+(fgValueMap[p.id]||0)
      nameMap[k]=rn(p); codeMap[k]=rc(p)
    }
    for (const k of Object.keys(boValMap)) { boValMap[k] = Math.max(0, (boValMap[k]||0) - (wzBeforeValMap[k]||0) + (corrBeforeValMap[k]||0)) }
    for (const p of (przyjecia||[])) { if (p.form === 'spakowane' && luzBatches.has(p.production_batch_id)) continue; const k=rk(p); if(!k) continue; keys.add(k); przychMap[k]=(przychMap[k]||0)+parseFloat(p.quantity_kg); przychValMap[k]=(przychValMap[k]||0)+(fgValueMap[p.id]||0); nameMap[k]=rn(p); codeMap[k]=rc(p) }
    for (const w of (wzPeriod||[])) {
      const k=rk(w); if(!k) continue; keys.add(k)
      rozchMap[k]=(rozchMap[k]||0)+parseFloat(w.quantity_kg)
      const fgId=w.finished_good_id, fgVal=fgValueMap[fgId]||0, fgOrigKg=(allGoods||[]).find(x=>x.id===fgId)?.quantity_kg||0
      rozchValMap[k]=(rozchValMap[k]||0)+(fgOrigKg>0?Math.round((parseFloat(w.quantity_kg)/parseFloat(fgOrigKg))*fgVal*100)/100:0)
      nameMap[k]=rn(w); codeMap[k]=rc(w)
    }
    const korValMap={}
    for (const c of (corrPeriod||[])) {
      const k=rk(c); if(!k) continue; keys.add(k)
      korMap[k]=(korMap[k]||0)+parseFloat(c.delta_kg)
      const fgId=c.finished_good_id, fgVal=fgValueMap[fgId]||0, fgOrigKg=(allGoods||[]).find(x=>x.id===fgId)?.quantity_kg||0
      korValMap[k]=(korValMap[k]||0)+(fgOrigKg>0?Math.round((parseFloat(c.delta_kg)/parseFloat(fgOrigKg))*fgVal*100)/100:0)
      nameMap[k]=rn(c); codeMap[k]=rc(c)
    }
    const bilans=[...keys].map(k=>{
      const bo=parseFloat(Math.max(0,boMap[k]||0).toFixed(3)), przych=parseFloat((przychMap[k]||0).toFixed(3))
      const kor=parseFloat((korMap[k]||0).toFixed(3)), rozch=parseFloat((rozchMap[k]||0).toFixed(3))
      const bz=parseFloat(Math.max(0,bo+przych+kor-rozch).toFixed(3))
      const boVal=parseFloat((boValMap[k]||0).toFixed(2)), przychVal=parseFloat((przychValMap[k]||0).toFixed(2))
      const rozchVal=parseFloat((rozchValMap[k]||0).toFixed(2)), korVal=parseFloat((korValMap[k]||0).toFixed(2))
      const bzVal=parseFloat(Math.max(0,boVal+przychVal+korVal-rozchVal).toFixed(2))
      return {key:k,code:codeMap[k],name:nameMap[k],bo,przych,kor,rozch,bz,boVal,przychVal,korVal,rozchVal,bzVal}
    }).filter(r=>r.bo>0||r.przych>0||r.kor!==0||r.rozch>0||r.bz>0||r.boVal>0).sort((a,b)=>a.code.localeCompare(b.code))
    setBilansData(bilans); setBilansLoading(false)
  }

  function printBilans() {
    const d1str=new Date(bilansDat1).toLocaleDateString('pl-PL'), d2str=new Date(bilansDat2).toLocaleDateString('pl-PL')
    const fmt2=(v)=>v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})
    const rowsHtml=bilansData.map((r,i)=>`<tr><td>${i+1}</td><td style="font-family:monospace;font-size:8px">${r.code}</td><td>${r.name}</td><td style="text-align:right">${r.bo.toFixed(3)}</td><td style="text-align:right;color:#0C447C">${r.boVal>0?fmt2(r.boVal):'—'}</td><td style="text-align:right;color:#085041">${r.przych.toFixed(3)}</td><td style="text-align:right;color:#085041">${r.przychVal>0?fmt2(r.przychVal):'—'}</td><td style="text-align:right;color:${r.kor<0?'#A32D2D':'#633806'}">${r.kor!==0?(r.kor>0?'+':'')+r.kor.toFixed(3):'—'}</td><td style="text-align:right;color:${r.kor<0?'#A32D2D':'#E65100'}">${r.kor!==0?fmt2(r.korVal):'—'}</td><td style="text-align:right;color:#7B3F00">${r.rozch.toFixed(3)}</td><td style="text-align:right;color:#7B3F00">${r.rozchVal>0?fmt2(r.rozchVal):'—'}</td><td style="text-align:right;font-weight:bold;color:#3C3489">${r.bz.toFixed(3)}</td><td style="text-align:right;font-weight:bold;color:#3C3489">${r.bz>0?fmt2(r.bzVal):'—'}</td></tr>`).join('')
    const sumaHtml=`<tr class="total"><td colspan="3" style="text-align:right">SUMA:</td><td style="text-align:right">${bilansData.reduce((s,r)=>s+r.bo,0).toFixed(3)}</td><td style="text-align:right">${fmt2(bilansData.reduce((s,r)=>s+r.boVal,0))}</td><td style="text-align:right;color:#085041">${bilansData.reduce((s,r)=>s+r.przych,0).toFixed(3)}</td><td style="text-align:right;color:#085041">${fmt2(bilansData.reduce((s,r)=>s+r.przychVal,0))}</td><td style="text-align:right">${bilansData.reduce((s,r)=>s+r.kor,0).toFixed(3)}</td><td style="text-align:right">${fmt2(bilansData.reduce((s,r)=>s+r.korVal,0))}</td><td style="text-align:right;color:#7B3F00">${bilansData.reduce((s,r)=>s+r.rozch,0).toFixed(3)}</td><td style="text-align:right;color:#7B3F00">${fmt2(bilansData.reduce((s,r)=>s+r.rozchVal,0))}</td><td style="text-align:right;font-weight:bold">${bilansData.reduce((s,r)=>s+r.bz,0).toFixed(3)}</td><td style="text-align:right;font-weight:bold">${fmt2(bilansData.reduce((s,r)=>s+r.bzVal,0))}</td></tr>`
    const emptyRow=bilansData.length===0?`<tr><td colspan="13" style="text-align:center;padding:16px;color:#888;font-style:italic">Brak ruchów magazynowych w wybranym okresie</td></tr>`:''
    const html=`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Bilans Magazyn Instant</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9px;padding:14px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:8px;margin-bottom:10px}.company{font-size:15px;font-weight:bold;color:#0F6E56}table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#0F6E56;color:#fff;padding:4px 5px;border:1px solid #085041;font-size:7px;text-align:left}td{padding:3px 5px;border:1px solid #D3D1C7;font-size:8px}tr:nth-child(even) td{background:#FAFAF8}.total td{background:#E1F5EE!important;font-weight:bold}.sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px}.sig-line{border-bottom:1.5px solid #333;margin-top:24px;margin-bottom:4px}.sig-label{font-size:8px;color:#888;text-transform:uppercase}@media print{@page{margin:8mm;size:A4 landscape}}</style></head><body><div class="header"><div><div class="company">InstantMix Pro</div><div style="font-size:12px;font-weight:bold;margin-top:3px">Bilans Magazynu Instant — Wyroby Gotowe</div><div style="font-size:13px;font-weight:bold;color:#0F6E56;margin-top:2px">Okres: ${d1str} — ${d2str}</div></div><div style="text-align:right;font-size:9px;color:#555">Wygenerowano: ${new Date().toLocaleDateString('pl-PL')}<br>Wydrukował: ${profile?.full_name||'—'}</div></div><table><thead><tr><th style="width:18px">Lp.</th><th style="width:55px">Kod</th><th>Nazwa produktu</th><th style="width:48px;text-align:right">BO (kg)</th><th style="width:58px;text-align:right">Wart. BO (zł)</th><th style="width:55px;text-align:right">Przychód (kg)</th><th style="width:60px;text-align:right">Wart. przych. (zł)</th><th style="width:48px;text-align:right">Korekty (kg)</th><th style="width:56px;text-align:right">Wart. kor. (zł)</th><th style="width:50px;text-align:right">Rozchód (kg)</th><th style="width:60px;text-align:right">Wart. rozch. (zł)</th><th style="width:48px;text-align:right">BZ (kg)</th><th style="width:60px;text-align:right">Wart. BZ (zł)</th></tr></thead><tbody>${bilansData.length===0?emptyRow:rowsHtml+sumaHtml}</tbody></table><div class="sig-grid"><div><div class="sig-label">Sporządził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Weryfikował</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div><div><div class="sig-label">Zatwierdził</div><div class="sig-line"></div><div class="sig-label">Imię, nazwisko i podpis</div></div></div><script>window.onload=function(){window.print()}</script></body></html>`
    const win=window.open('','_blank'); win.document.write(html); win.document.close()
  }

  const corrForGood = (goodId) => corrections.filter(c => c.finished_good_id === goodId)
  const wzForGood = (goodId) => wzDocs.filter(w => w.finished_good_id === goodId)
  const fmt3 = v => parseFloat(v || 0).toFixed(3)

  // opis formy towaru: luz = big bag, spakowane = worki/BB o danej wadze
  // spakowany wiersz będący przepakowaniem luzu tej samej partii (nie liczy się jako przyjęcie)
  function isTransformRow(g) { return g?.form === 'spakowane' && luzBatchIds.has(g.production_batch_id) }

  // liczba big bagów luzu = dostępne / waga 1 BB
  function bbCount(g) {
    const w = parseFloat(g?.unit_weight_kg || 0)
    const avail = parseFloat(g?.available_kg ?? g?.original_kg ?? 0)
    return w > 0 ? Math.round(avail / w) : 1
  }
  function hasBreakdown(g) {
    if (g?.form === 'spakowane') return parseInt(g.pallets) > 0
    return bbCount(g) > 1
  }

  function formLabel(g) {
    const w = parseFloat(g?.unit_weight_kg || 0)
    const avail = parseFloat(g?.available_kg ?? g?.original_kg ?? 0)
    if (g?.form === 'spakowane') {
      const cnt = w > 0 ? Math.round(avail / w) : (g.unit_count || 0)
      const B = g.bags_per_pallet ? parseInt(g.bags_per_pallet) : 0
      const pal = B > 0 ? Math.ceil(cnt / B) : (g.pallets || 0)
      const unit = g.unit_type === 'worek' ? 'wor.' : 'BB'
      const palStr = pal ? `${pal} pal · ` : ''
      return { text: `${palStr}${cnt} × ${w.toLocaleString('pl-PL')} kg ${unit}`, cls: 'b-purple' }
    }
    // luz (big bag) — liczba BB i pozostała waga
    const n = bbCount(g)
    return { text: `${n} BB · ${avail.toLocaleString('pl-PL')} kg`, cls: 'b-info' }
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Magazyn Instant</div><div className="page-sub">Wyroby gotowe — przyjęcia, inwentury, wydania WZ</div></div>
        <div className="flex" style={{ gap: 8 }}>
          <input className="search" placeholder="Szukaj produktu..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          {canEdit && <button className="btn btn-sm" onClick={openInwentura}>📋 Inwentura</button>}
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => { setAcceptForm({ production_batch_id: '', order_id: '', received_date: new Date().toISOString().slice(0,10), quantity_kg: '', location: '', notes: '' }); setSelectedProdBatch(null); setError(''); setAcceptModal(true) }}>+ Przyjęcie</button>}
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Produktów na stanie</div><div className="stat-val">{stats.products}</div></div>
        <div className="stat-card"><div className="stat-label">Z dostępnym stanem</div><div className="stat-val" style={{ color: '#085041' }}>{stats.available}</div></div>
        <div className="stat-card"><div className="stat-label">Łącznie przyjęto (kg)</div><div className="stat-val">{parseFloat(stats.totalKg).toLocaleString('pl-PL')}</div></div>
        <div className="stat-card"><div className="stat-label">Dostępne (kg)</div><div className="stat-val" style={{ color: '#085041' }}>{parseFloat(stats.availableKg).toLocaleString('pl-PL')}</div></div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>Bilans magazynowy</span>
          <div className="flex" style={{ gap: 6 }}>
            <button className={`btn btn-sm ${bilansMode==='miesiac'?'btn-primary':''}`} onClick={setMiesiac}>Bieżący miesiąc</button>
            <button className={`btn btn-sm ${bilansMode==='kwartal'?'btn-primary':''}`} onClick={setKwartal}>Bieżący kwartał</button>
            <button className={`btn btn-sm ${bilansMode==='rok'?'btn-primary':''}`} onClick={setRok}>Bieżący rok</button>
            <button className={`btn btn-sm ${bilansMode==='custom'?'btn-primary':''}`} onClick={() => setBilansMode('custom')}>Własny zakres</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto 1fr', gap: 10, alignItems: 'end' }}>
          <div><label>Od</label><input type="date" value={bilansDat1} onChange={e => { setBilansDat1(e.target.value); setBilansMode('custom') }} /></div>
          <div style={{ paddingTop: 20, color: '#888' }}>→</div>
          <div><label>Do</label><input type="date" value={bilansDat2} onChange={e => { setBilansDat2(e.target.value); setBilansMode('custom') }} /></div>
          <button className="btn btn-primary btn-sm" onClick={obliczBilans} style={{ alignSelf: 'flex-end' }}>Oblicz bilans</button>
          {showBilans && !bilansLoading && <button className="btn btn-sm" onClick={printBilans} style={{ alignSelf: 'flex-end' }}>Drukuj bilans</button>}
        </div>
        {showBilans && (
          <div style={{ marginTop: 12 }}>
            {bilansLoading ? (
              <div style={{ textAlign: 'center', padding: 16 }}><span className="spinner" /> Obliczam bilans...</div>
            ) : bilansData.length === 0 ? (
              <div>
                <div className="muted" style={{ padding: '8px 0 12px' }}>Brak ruchów magazynowych w wybranym okresie.</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:24, marginTop:8 }}>
                  {['Sporządził','Weryfikował','Zatwierdził'].map(l => (
                    <div key={l}>
                      <div style={{ fontSize:11, color:'#888', textTransform:'uppercase', marginBottom:20 }}>{l}</div>
                      <div style={{ borderBottom:'1px solid #333', marginBottom:4 }}></div>
                      <div style={{ fontSize:10, color:'#888' }}>Imię, nazwisko i podpis</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 800 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff' }}><tr>
                    <th>Kod</th><th>Nazwa produktu</th>
                    <th style={{ textAlign:'right', background:'#E6F1FB', color:'#0C447C' }}>BO (kg)</th>
                    <th style={{ textAlign:'right', background:'#E6F1FB', color:'#0C447C' }}>Wart. BO (zł)</th>
                    <th style={{ textAlign:'right', background:'#E1F5EE', color:'#085041' }}>Przychód (kg)</th>
                    <th style={{ textAlign:'right', background:'#E1F5EE', color:'#085041' }}>Wart. przychodu (zł)</th>
                    <th style={{ textAlign:'right', background:'#FFF8E1', color:'#E65100' }}>Korekty (kg)</th>
                    <th style={{ textAlign:'right', background:'#FFF8E1', color:'#E65100', fontSize:10 }}>Wart. kor. (zł)</th>
                    <th style={{ textAlign:'right', background:'#FAEEDA', color:'#7B3F00' }}>Rozchód (kg)</th>
                    <th style={{ textAlign:'right', background:'#FAEEDA', color:'#7B3F00', fontSize:10 }}>Wart. rozch. (zł)</th>
                    <th style={{ textAlign:'right', background:'#EEEDFE', color:'#3C3489' }}>BZ (kg)</th>
                    <th style={{ textAlign:'right', background:'#EEEDFE', color:'#3C3489' }}>Wart. BZ (zł)</th>
                  </tr></thead>
                  <tbody>
                    {bilansData.map(r => (
                      <tr key={r.key}>
                        <td><span className="lot">{r.code}</span></td>
                        <td style={{ fontWeight:500 }}>{r.name}</td>
                        <td style={{ textAlign:'right', color:'#0C447C' }}>{r.bo.toFixed(3)}</td>
                        <td style={{ textAlign:'right', color:'#0C447C', fontSize:11 }}>{r.boVal>0?r.boVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
                        <td style={{ textAlign:'right', color:'#085041', fontWeight:500 }}>{r.przych.toFixed(3)}</td>
                        <td style={{ textAlign:'right', color:'#085041', fontSize:11, fontWeight:500 }}>{r.przychVal>0?r.przychVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
                        <td style={{ textAlign:'right', color:r.kor<0?'#A32D2D':r.kor>0?'#085041':'#888' }}>{r.kor!==0?(r.kor>0?'+':'')+r.kor.toFixed(3):'—'}</td>
                        <td style={{ textAlign:'right', color:r.korVal<0?'#A32D2D':'#E65100', fontSize:11 }}>{r.kor!==0?r.korVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
                        <td style={{ textAlign:'right', color:'#7B3F00', fontWeight:500 }}>{r.rozch.toFixed(3)}</td>
                        <td style={{ textAlign:'right', color:'#7B3F00', fontSize:11 }}>{r.rozchVal>0?r.rozchVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
                        <td style={{ textAlign:'right', color:'#3C3489', fontWeight:700 }}>{r.bz.toFixed(3)}</td>
                        <td style={{ textAlign:'right', color:'#3C3489', fontSize:11, fontWeight:700 }}>{r.bz>0?r.bzVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
                      </tr>
                    ))}
                    <tr style={{ background:'#F1EFE8' }}>
                      <td colSpan={2} style={{ fontWeight:500, textAlign:'right' }}>SUMA</td>
                      <td style={{ textAlign:'right', fontWeight:700 }}>{bilansData.reduce((s,r)=>s+r.bo,0).toFixed(3)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#0C447C' }}>{bilansData.reduce((s,r)=>s+r.boVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#085041' }}>{bilansData.reduce((s,r)=>s+r.przych,0).toFixed(3)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#085041' }}>{bilansData.reduce((s,r)=>s+r.przychVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#E65100' }}>{bilansData.reduce((s,r)=>s+r.kor,0).toFixed(3)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#E65100', fontSize:11 }}>{bilansData.reduce((s,r)=>s+r.korVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#7B3F00' }}>{bilansData.reduce((s,r)=>s+r.rozch,0).toFixed(3)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#7B3F00', fontSize:11 }}>{bilansData.reduce((s,r)=>s+r.rozchVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489' }}>{bilansData.reduce((s,r)=>s+r.bz,0).toFixed(3)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489' }}>{bilansData.reduce((s,r)=>s+r.bzVal,0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      {printWzData && (
        <div className="info-box" style={{ marginBottom:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>✓ Dokument <b>{printWzData.wzNumber}</b> wystawiony pomyślnie.</span>
          <div className="flex" style={{ gap:8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => printWZ(printWzData.wzNumber, printWzData.good, printWzData.form)}>Drukuj WZ</button>
            <button className="btn btn-sm" onClick={() => setPrintWzData(null)}>✕</button>
          </div>
        </div>
      )}
      <div className="flex" style={{ marginBottom:10, gap:6 }}>
        {[['aktywne','Dostępne'],['wydane','Wydane'],['wszystkie','Wszystkie']].map(([val,label]) => (
          <button key={val} className="btn btn-sm" onClick={() => setFilterView(val)}
            style={{ background:filterView===val?'#1D9E75':undefined, color:filterView===val?'#fff':undefined, borderColor:filterView===val?'#1D9E75':undefined }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 320px)' }}>
        <table style={{ width:'100%' }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th style={{ width:32 }}></th>
            <th>Kod</th><th>Nazwa produktu</th>
            <th style={{ textAlign:'right' }}>Przyjęto (kg)</th>
            <th style={{ textAlign:'right' }}>Korekty (kg)</th>
            <th style={{ textAlign:'right' }}>Wydano (kg)</th>
            <th style={{ textAlign:'right' }}>Dostępne (kg)</th>
            <th style={{ textAlign:'right' }}>Wart. surowców</th>
            <th style={{ textAlign:'center' }}>Partii</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filteredProducts.map(p => {
              const isExpanded = expandedProduct === p.recipe_code
              const available = parseFloat(p.available_kg)
              const partieList = goodsForProduct(p.recipe_code)
              return (
                <React.Fragment key={p.recipe_code}>
                  <tr style={{ background:available<=0?'#F9F8F5':undefined }}>
                    <td style={{ textAlign:'center' }}>
                      <button onClick={() => setExpandedProduct(isExpanded?null:p.recipe_code)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                        {isExpanded?'▲':'▼'}
                      </button>
                    </td>
                    <td><span className="lot">{p.recipe_code}</span></td>
                    <td style={{ fontWeight:500 }}>{p.recipe_name} <span className="badge b-info" style={{ fontSize:10 }}>{p.recipe_version}</span></td>
                    <td style={{ textAlign:'right', color:'#085041', fontWeight:500 }}>{fmt3(p.original_kg)}</td>
                    <td style={{ textAlign:'right', color:parseFloat(p.corrections_kg)<0?'#A32D2D':parseFloat(p.corrections_kg)>0?'#085041':'#888' }}>
                      {parseFloat(p.corrections_kg)!==0?(parseFloat(p.corrections_kg)>0?'+':'')+fmt3(p.corrections_kg):'—'}
                    </td>
                    <td style={{ textAlign:'right', color:'#633806' }}>{fmt3(p.issued_kg)}</td>
                    <td style={{ textAlign:'right' }}>
                      <span style={{ fontWeight:700, fontSize:14, color:available<=0?'#888':'#0F6E56' }}>{fmt3(available)}</span>
                      {available<=0 && <span className="badge b-gray" style={{ marginLeft:6, fontSize:10 }}>Wydano</span>}
                    </td>
                    <td style={{ textAlign:'right', fontSize:12, color:'#3C3489' }}>
                      {(() => { const v=goodsForProduct(p.recipe_code).reduce((s,g)=>{ const total=batchValues[g.production_batch_id]||0; const origKg=parseFloat(g.original_kg||0); const availKg=parseFloat(g.available_kg||0); if(total<=0||origKg<=0) return s; return s+Math.round((availKg/origKg)*total*100)/100 },0); return v>0?v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł':'—' })()}
                    </td>
                    <td style={{ textAlign:'center', color:'#5F5E5A' }}>{p.batch_count}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} style={{ padding:0, background:'#F9F8F5' }}>
                        <div style={{ padding:'8px 16px 12px 40px' }}>
                          <div style={{ fontSize:12, fontWeight:500, color:'#0F6E56', marginBottom:8 }}>Partie — {p.recipe_name}</div>
                          <div className="muted" style={{ fontSize:10, marginBottom:6 }}>
                            Spakowanie luzu w worki/BB pokazuje się jako „w tym spakowano" w kolumnie Wydano, a spakowany towar jako osobna pozycja („z pakow.") — nie jest liczony ponownie do „Przyjęto".
                          </div>
                          <table style={{ width:'auto', minWidth:700 }}>
                            <thead><tr>
                              <th style={{ width:32 }}></th>
                              <th>Nr partii</th><th>Data przyjęcia</th>
                              <th style={{ textAlign:'right' }}>Przyjęto (kg)</th>
                              <th style={{ textAlign:'right' }}>Korekty (kg)</th>
                              <th style={{ textAlign:'right' }}>Wydano (kg)</th>
                              <th style={{ textAlign:'right' }}>Dostępne (kg)</th>
                              <th style={{ textAlign:'right' }}>Wart. surowców</th>
                              <th>Lokalizacja</th><th>Zlecenie</th><th></th>
                            </tr></thead>
                            <tbody>
                              {partieList.map(g => {
                                const avail=parseFloat(g.available_kg)
                                const gCorrs=corrForGood(g.id)
                                const gWz=wzForGood(g.id)
                                const gExpanded=expandedGood===g.id
                                return (
                                  <React.Fragment key={g.id}>
                                    <tr style={{ background:avail<=0?'#F1EFE8':'#fff' }}>
                                      <td style={{ textAlign:'center' }}>
                                        {(gCorrs.length>0||gWz.length>0||hasBreakdown(g)) && (
                                          <button onClick={() => setExpandedGood(gExpanded?null:g.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'#5F5E5A', padding:'1px 3px' }}>
                                            {gExpanded?'▲':'▼'}
                                          </button>
                                        )}
                                      </td>
                                      <td>
                                        <span className="lot" style={{ fontSize:11 }}>{g.lot_number}</span>
                                        <div style={{ marginTop:2 }}><span className={`badge ${formLabel(g).cls}`} style={{ fontSize:9 }}>{formLabel(g).text}</span></div>
                                      </td>
                                      <td className="muted" style={{ fontSize:11 }}>{g.received_date}</td>
                                      <td style={{ textAlign:'right', color:'#085041', fontWeight:500, fontSize:12 }}>
                                        {isTransformRow(g)
                                          ? <span className="muted" style={{ fontWeight:400 }} title="Towar spakowany z luzu — nie liczony ponownie do Przyjęto">— <span style={{ fontSize:9 }}>(z pakow.)</span></span>
                                          : fmt3(g.original_kg)}
                                      </td>
                                      <td style={{ textAlign:'right', fontSize:11, color:parseFloat(g.corrections_kg)<0?'#A32D2D':parseFloat(g.corrections_kg)>0?'#085041':'#888' }}>
                                        {parseFloat(g.corrections_kg)!==0?(parseFloat(g.corrections_kg)>0?'+':'')+fmt3(g.corrections_kg):'—'}
                                      </td>
                                      <td style={{ textAlign:'right', color:'#633806', fontSize:12 }}>
                                        {(() => {
                                          const issued = parseFloat(g.issued_kg||0)
                                          const packedOut = parseFloat(g.packed_out_kg||0)
                                          const totalOut = issued + packedOut
                                          if (totalOut <= 0.0005) return '—'
                                          return (<>
                                            {fmt3(totalOut)}
                                            {packedOut > 0.0005 && <div style={{ fontSize:9, color:'#3C3489' }}>w tym spakowano {fmt3(packedOut)}</div>}
                                          </>)
                                        })()}
                                      </td>
                                      <td style={{ textAlign:'right' }}>
                                        <span style={{ fontWeight:700, color:avail<=0?'#888':'#0F6E56', fontSize:12 }}>{fmt3(avail)}</span>
                                      </td>
                                      <td style={{ textAlign:'right', fontSize:11, color:'#3C3489' }}>
                                        {(() => { const total=batchValues[g.production_batch_id]||0; const origKg=parseFloat(g.original_kg||0); const availKg=parseFloat(g.available_kg||0); if(total<=0||origKg<=0) return '—'; const v=Math.round((availKg/origKg)*total*100)/100; return v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' })()}
                                      </td>
                                      <td className="muted" style={{ fontSize:11 }}>{g.location||'—'}</td>
                                      <td style={{ fontSize:11 }}>{g.order_number?<span className="lot" style={{ fontSize:10 }}>{g.order_number}</span>:<span className="muted">—</span>}</td>
                                      <td>
                                        <div className="flex" style={{ gap:3 }}>
                                          {canEdit && avail>0 && <button className="btn btn-sm btn-primary" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => openWz(g)}>WZ</button>}
                                          {canEdit && avail>0 && <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px', background:'#FFF3E0', color:'#E65100', border:'0.5px solid #FFCC80' }} onClick={() => openCorr(g)}>Korekta</button>}
                                          {isAdmin && <button className="btn btn-sm" style={{ fontSize:10, padding:'2px 7px' }} onClick={() => openEdit(g)}>Edytuj</button>}
                                        </div>
                                      </td>
                                    </tr>
                                    {gExpanded && (
                                      <tr>
                                        <td colSpan={11} style={{ padding:'6px 8px 8px 48px', background:'#F1EFE8' }}>
                                          {hasBreakdown(g) && (() => {
                                            const fmtZl = v => v>0 ? v.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'
                                            const avail = parseFloat(g.available_kg||0)
                                            const W = parseFloat(g.unit_weight_kg)||0
                                            const totalVal = (() => { const total=batchValues[g.production_batch_id]||0; const origKg=parseFloat(g.original_kg||0); if(total<=0||origKg<=0) return 0; return Math.round((avail/origKg)*total*100)/100 })()
                                            const valPerKg = avail>0 ? totalVal/avail : 0
                                            if (g.form === 'spakowane') {
                                              const B = g.bags_per_pallet ? parseInt(g.bags_per_pallet) : (g.pallets ? Math.round((parseInt(g.unit_count)||0)/parseInt(g.pallets)) : 0)
                                              const totalUnits = W>0 ? Math.round(avail/W) : (parseInt(g.unit_count)||0)
                                              const fullP = B>0 ? Math.floor(totalUnits/B) : 0
                                              const rem = B>0 ? (totalUnits - fullP*B) : 0
                                              const palCount = fullP + (rem>0?1:0)
                                              const sing = g.unit_type==='worek' ? 'worek' : 'big bag'
                                              const plur = g.unit_type==='worek' ? 'worki' : 'big bagi'
                                              const uname = n => n===1 ? sing : plur
                                              const palRows = []
                                              for (let i=0;i<fullP;i++) palRows.push(B)
                                              if (rem>0) palRows.push(rem)
                                              return (
                                                <div style={{ marginBottom:8 }}>
                                                  <div style={{ fontSize:11, fontWeight:500, marginBottom:4, color:'#3C3489' }}>Rozbicie na palety (pozostało)</div>
                                                  <table style={{ width:'auto', minWidth:460 }}>
                                                    <thead><tr><th>Paleta</th><th style={{ textAlign:'right' }}>Jednostki</th><th style={{ textAlign:'right' }}>Waga (kg)</th><th style={{ textAlign:'right' }}>Wart. surowców</th></tr></thead>
                                                    <tbody>
                                                      <tr style={{ fontWeight:600, background:'#EEEDFE' }}>
                                                        <td>Razem: {palCount} pal</td>
                                                        <td style={{ textAlign:'right' }}>{totalUnits} {uname(totalUnits)}</td>
                                                        <td style={{ textAlign:'right' }}>{fmt3(avail)}</td>
                                                        <td style={{ textAlign:'right' }}>{fmtZl(totalVal)}</td>
                                                      </tr>
                                                      {palRows.map((u,i) => (
                                                        <tr key={i}>
                                                          <td className="muted">Paleta {i+1}{u<B?' (częściowa)':''}</td>
                                                          <td style={{ textAlign:'right' }}>{u} {uname(u)}</td>
                                                          <td style={{ textAlign:'right' }}>{fmt3(u*W)}</td>
                                                          <td style={{ textAlign:'right', color:'#3C3489' }}>{fmtZl(valPerKg*u*W)}</td>
                                                        </tr>
                                                      ))}
                                                      {palCount===0 && <tr><td colSpan={4} className="muted" style={{ fontSize:11 }}>Wydano w całości</td></tr>}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              )
                                            }
                                            // luz — rozbicie na big bagi
                                            const nBB = W>0 ? Math.round(avail/W) : 1
                                            return (
                                              <div style={{ marginBottom:8 }}>
                                                <div style={{ fontSize:11, fontWeight:500, marginBottom:4, color:'#3C3489' }}>Rozbicie na big bagi (pozostało)</div>
                                                <table style={{ width:'auto', minWidth:380 }}>
                                                  <thead><tr><th>Big bag</th><th style={{ textAlign:'right' }}>Waga (kg)</th><th style={{ textAlign:'right' }}>Wart. surowców</th></tr></thead>
                                                  <tbody>
                                                    <tr style={{ fontWeight:600, background:'#EEEDFE' }}>
                                                      <td>Razem: {nBB} BB</td>
                                                      <td style={{ textAlign:'right' }}>{fmt3(avail)}</td>
                                                      <td style={{ textAlign:'right' }}>{fmtZl(totalVal)}</td>
                                                    </tr>
                                                    {Array.from({ length:nBB }).map((_,i) => (
                                                      <tr key={i}>
                                                        <td className="muted">Big bag {i+1}</td>
                                                        <td style={{ textAlign:'right' }}>{fmt3(W)}</td>
                                                        <td style={{ textAlign:'right', color:'#3C3489' }}>{fmtZl(valPerKg*W)}</td>
                                                      </tr>
                                                    ))}
                                                    {nBB===0 && <tr><td colSpan={3} className="muted" style={{ fontSize:11 }}>Wydano w całości</td></tr>}
                                                  </tbody>
                                                </table>
                                              </div>
                                            )
                                          })()}
                                          {gCorrs.length>0 && (
                                            <div style={{ marginBottom:8 }}>
                                              <div style={{ fontSize:11, fontWeight:500, marginBottom:4, color:'#E65100' }}>Historia korekt</div>
                                              {gCorrs.map(c => (
                                                <div key={c.id} style={{ fontSize:11, color:'#5F5E5A', padding:'3px 0', borderBottom:'0.5px solid #D3D1C7', display:'flex', gap:12, alignItems:'center' }}>
                                                  <span><b>{CORR_LABELS[c.correction_type]||c.correction_type}</b>: {c.reason}</span>
                                                  <span className={`badge ${parseFloat(c.delta_kg)<0?'b-err':'b-ok'}`} style={{ fontSize:10 }}>{parseFloat(c.delta_kg)>0?'+':''}{parseFloat(c.delta_kg).toFixed(3)} kg</span>
                                                  <span className="muted">{c.event_date}</span>
                                                  {isAdmin && (
                                                    <span style={{ marginLeft:'auto', display:'flex', gap:4 }}>
                                                      <button className="btn btn-sm" style={{ fontSize:10, padding:'1px 6px' }} onClick={() => openCorrEdit(c)}>Edytuj</button>
                                                      <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'1px 6px' }} onClick={() => setCorrDeleteConfirm(c)}>Usuń</button>
                                                    </span>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {gWz.length>0 && (
                                            <div>
                                              <div style={{ fontSize:11, fontWeight:500, marginBottom:4, color:'#0C447C' }}>Dokumenty WZ</div>
                                              {gWz.map(wz => (
                                                <div key={wz.id} style={{ fontSize:11, color:'#5F5E5A', padding:'4px 0', borderBottom:'0.5px solid #D3D1C7', display:'flex', gap:10, alignItems:'center' }}>
                                                  <span className="lot" style={{ fontSize:10 }}>{wz.wz_number}</span>
                                                  <span>{wz.recipient||'—'}</span>
                                                  {wzPackText(wz) && <span className="badge b-purple" style={{ fontSize:9 }}>{wzPackText(wz)}</span>}
                                                  <span style={{ fontWeight:500 }}>{parseFloat(wz.quantity_kg).toFixed(3)} kg</span>
                                                  <span className="muted">{wz.issue_date}</span>
                                                  <span style={{ flex:1 }} />
                                                  {isAdmin && <button className="btn btn-sm" style={{ fontSize:10, padding:'1px 6px' }} onClick={() => openWzEdit(wz)}>Edytuj</button>}
                                                  {isAdmin && <button className="btn btn-sm btn-danger" style={{ fontSize:10, padding:'1px 6px' }} onClick={() => setWzDeleteConfirm(wz)}>Usuń</button>}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {!loading && filteredProducts.length===0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak towarów na magazynie</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${acceptModal?'open':''}`} onClick={e => e.target===e.currentTarget && setAcceptModal(false)}>
        <div className="modal">
          <div className="modal-title">Przyjęcie towaru na Magazyn Instant</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:10 }}>
            <label>Partia produkcyjna *</label>
            <select value={acceptForm.production_batch_id} onChange={e => handleBatchSelect(e.target.value)}>
              <option value="">— wybierz partię —</option>
              {prodBatches.map(pb => <option key={pb.id} value={pb.id}>{pb.lot_number} — {pb.recipe_name} ({pb.quantity_kg} kg) · {pb.production_date}</option>)}
            </select>
            {selectedProdBatch && <div className="muted" style={{ fontSize:12, marginTop:4 }}>Data produkcji: <b>{selectedProdBatch.production_date}</b></div>}
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Powiąż ze zleceniem (opcjonalne)</label>
            <select value={acceptForm.order_id} onChange={e => af('order_id', e.target.value)}>
              <option value="">— brak powiązania —</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.order_number} — {o.client} ({o.recipes?.name}, {o.quantity_kg} kg)</option>)}
            </select>
          </div>
          <div className="fr">
            <div><label>Data przyjęcia</label><input type="date" value={acceptForm.received_date} min={selectedProdBatch?.production_date||undefined} onChange={e => af('received_date', e.target.value)} /></div>
            <div><label>Ilość łącznie (kg) *</label><input type="number" step="0.001" value={acceptForm.quantity_kg} onChange={e => af('quantity_kg', e.target.value)} /></div>
            <div><label>Liczba big bagów</label><input type="number" min="1" step="1" value={acceptForm.bag_count} onChange={e => af('bag_count', e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Lokalizacja magazynowa</label><input value={acceptForm.location} onChange={e => af('location', e.target.value)} placeholder="np. Regał A-3" /></div>
            <div><label>Uwagi</label><input value={acceptForm.notes} onChange={e => af('notes', e.target.value)} placeholder="opcjonalne" /></div>
          </div>
          <div className="muted" style={{ fontSize:11, marginBottom:8, padding:'6px 10px', background:'#E6F1FB', borderRadius:6, color:'#0C447C' }}>
            {(() => {
              const q = parseFloat(acceptForm.quantity_kg) || 0
              const n = Math.max(1, parseInt(acceptForm.bag_count) || 1)
              if (n <= 1) return <>Towar przyjmowany jako <b>1 big bag (luz)</b> o podanej wadze. Podział na worki nastąpi w pakowaniu.</>
              const per = q > 0 ? (q / n) : 0
              return <>Powstanie <b>{n} osobnych big bagów (luz)</b>{q > 0 ? <> po ~<b>{per.toLocaleString('pl-PL',{maximumFractionDigits:3})} kg</b></> : ''}. Wagi pojedynczych BB możesz potem skorygować w „Edytuj".</>
            })()}
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setAcceptModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveAccept} disabled={saving}>{saving?'Zapisywanie...':'Przyjmij na magazyn'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${editModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Edycja przyjęcia — {editGood?.lot_number}</div>
          <div className="info-box" style={{ marginBottom:10 }}>Edycja dostępna tylko dla Admina.</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data przyjęcia</label><input type="date" value={editForm.received_date||''} onChange={e => setEditForm(p=>({...p,received_date:e.target.value}))} /></div>
            <div><label>Ilość (kg)</label><input type="number" step="0.001" value={editForm.quantity_kg||''} onChange={e => setEditForm(p=>({...p,quantity_kg:e.target.value}))} /></div>
          </div>
          <div className="fr">
            <div><label>Lokalizacja</label><input value={editForm.location||''} onChange={e => setEditForm(p=>({...p,location:e.target.value}))} /></div>
            <div><label>Uwagi</label><input value={editForm.notes||''} onChange={e => setEditForm(p=>({...p,notes:e.target.value}))} /></div>
          </div>
          <div style={{ background:'#F7F6F1', border:'0.5px solid #E3E1D8', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#085041', marginBottom:8 }}>Forma towaru na magazynie</div>
            <div className="fr" style={{ marginBottom:8 }}>
              <div><label>Forma</label>
                <select value={editForm.form||'luz'} onChange={e => setEditForm(p=>({...p, form:e.target.value, unit_type: e.target.value==='luz' ? 'big_bag' : (p.unit_type==='big_bag'?'worek':p.unit_type) }))}>
                  <option value="luz">Luz (big bag)</option>
                  <option value="spakowane">Spakowane</option>
                </select>
              </div>
              <div><label>Rodzaj jednostki</label>
                <select value={editForm.unit_type||'big_bag'} onChange={e => setEditForm(p=>({...p,unit_type:e.target.value}))}>
                  <option value="big_bag">Big bag</option>
                  <option value="worek">Worek</option>
                </select>
              </div>
            </div>
            <div className="fr" style={{ marginBottom:0 }}>
              <div><label>Palety</label><input type="number" min="0" step="1" value={editForm.pallets??''} onChange={e => setEditForm(p=>({...p,pallets:e.target.value}))} placeholder="np. 1" /></div>
              <div><label>Jednostek na palecie</label><input type="number" min="0" step="1" value={editForm.bags_per_pallet??''} onChange={e => setEditForm(p=>({...p,bags_per_pallet:e.target.value}))} placeholder="np. 40" /></div>
              <div><label>Waga 1 jednostki (kg)</label><input type="number" min="0" step="0.001" value={editForm.unit_weight_kg??''} onChange={e => setEditForm(p=>({...p,unit_weight_kg:e.target.value}))} placeholder="np. 20" /></div>
            </div>
            <div className="muted" style={{ fontSize:11, marginTop:6 }}>
              {(() => {
                const u = (parseInt(editForm.pallets)||0) * (parseInt(editForm.bags_per_pallet)||0)
                const w = parseFloat(editForm.unit_weight_kg)||0
                return <>Liczba jednostek (razem): <b>{u || '—'}</b>{u>0 && w>0 ? <> · łącznie <b>{(u*w).toLocaleString('pl-PL')} kg</b></> : ''}</>
              })()}
            </div>
            <div className="muted" style={{ fontSize:11, marginTop:6 }}>
              {editForm.form === 'spakowane'
                ? 'Dla spakowanego ilość (kg) wynika z: palety × jednostek na palecie × waga. Zmiana przeliczy zużycie luzu (np. domknie big bag do 0).'
                : 'Np. „1 big bag 700 kg" lub „15 worków × 20 kg". Dla luzu to pole opisowe — nie zmienia ilości (kg).'}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>{savingEdit?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${corrModal?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Korekta stanu — {corrGood?.lot_number}</div>
          {corrGood && <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}><b>{corrGood.recipe_code}</b> — {corrGood.recipe_name}<br />Dostępne: <b>{fmt3(corrGood.available_kg)} kg</b></div>}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ korekty</label>
              <select value={corrForm.correction_type} onChange={e => setCorrForm(p=>({...p,correction_type:e.target.value}))}>
                {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {corrForm.correction_type!=='utylizacja' && (
              <div><label>Korekta ilości (kg) — ujemna = ubytek</label>
                <input type="number" step="0.001" value={corrForm.delta_kg} onChange={e => setCorrForm(p=>({...p,delta_kg:e.target.value}))} placeholder="np. -10 lub +5" />
              </div>
            )}
          </div>
          {corrForm.correction_type==='utylizacja' && <div className="warn-box">Utylizacja pełna — cały dostępny stan zostanie wyzerowany.</div>}
          <div style={{ marginBottom:10 }}><label>Przyczyna *</label><input value={corrForm.reason} onChange={e => setCorrForm(p=>({...p,reason:e.target.value}))} placeholder="np. zniszczenie opakowania" /></div>
          <div><label>Data zdarzenia</label><input type="date" value={corrForm.event_date} onChange={e => setCorrForm(p=>({...p,event_date:e.target.value}))} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrModal(false)}>Anuluj</button>
            <button className="btn btn-danger" onClick={saveCorr} disabled={saving}>{saving?'Zapisywanie...':'Zapisz korektę'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${corrEditModal?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrEditModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Edycja korekty</div>
          {!isAdmin && <div className="info-box" style={{ marginBottom:10 }}>Edycja dostępna tylko dla Admina.</div>}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ korekty</label>
              <select value={corrEditForm.correction_type} onChange={e => setCorrEditForm(p=>({...p,correction_type:e.target.value}))}>
                {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label>Korekta ilości (kg) — ujemna = ubytek</label>
              <input type="number" step="0.001" value={corrEditForm.delta_kg} onChange={e => setCorrEditForm(p=>({...p,delta_kg:e.target.value}))} placeholder="np. -10 lub +5" />
            </div>
          </div>
          <div style={{ marginBottom:10 }}><label>Przyczyna *</label><input value={corrEditForm.reason} onChange={e => setCorrEditForm(p=>({...p,reason:e.target.value}))} placeholder="np. zniszczenie opakowania" /></div>
          <div><label>Data zdarzenia</label><input type="date" value={corrEditForm.event_date} onChange={e => setCorrEditForm(p=>({...p,event_date:e.target.value}))} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrEditModal(false)}>Anuluj</button>
            {isAdmin && <button className="btn btn-primary" onClick={saveCorrEdit} disabled={savingCorrEdit}>{savingCorrEdit?'Zapisywanie...':'Zapisz zmiany'}</button>}
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${corrDeleteConfirm?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrDeleteConfirm(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń korektę</div>
          <div className="warn-box">Czy na pewno usunąć korektę <b>{corrDeleteConfirm ? (CORR_LABELS[corrDeleteConfirm.correction_type]||corrDeleteConfirm.correction_type) : ''}</b> ({corrDeleteConfirm ? (parseFloat(corrDeleteConfirm.delta_kg)>0?'+':'')+parseFloat(corrDeleteConfirm.delta_kg).toFixed(3) : ''} kg)? Stan magazynowy wróci do wartości sprzed korekty.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrDeleteConfirm(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteCorr(corrDeleteConfirm)}>Tak, usuń</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${inwenturaModal?'open':''}`} onClick={e => e.target===e.currentTarget && setInwenturaModal(false)}>
        <div className="modal" style={{ maxWidth:640 }}>
          <div className="modal-title">Inwentura Magazynu Instant</div>
          <div className="info-box" style={{ marginBottom:10 }}>Wpisz rzeczywisty stan każdej partii. Różnice zostaną zapisane jako korekty inwentury.</div>
          {error && <div className="err-box">{error}</div>}
          <div style={{ marginBottom:12 }}><label>Data inwentury</label><input type="date" value={inwenturaDate} onChange={e => setInwenturaDate(e.target.value)} style={{ width:180 }} /></div>
          <div style={{ overflowY:'auto', maxHeight:400, marginBottom:10 }}>
            <table style={{ width:'100%' }}>
              <thead style={{ position:'sticky', top:0, background:'#fff', zIndex:5 }}><tr>
                <th>Receptura</th><th>Nr partii</th>
                <th style={{ textAlign:'right' }}>Stan systemowy (kg)</th>
                <th style={{ textAlign:'right' }}>Stan rzeczywisty (kg)</th>
                <th style={{ textAlign:'right' }}>Różnica</th>
              </tr></thead>
              <tbody>
                {inwenturaRows.map((r, idx) => {
                  const diff = parseFloat(r.inwentura_kg||0) - r.available_kg
                  return (
                    <tr key={r.id} style={{ background:Math.abs(diff)>0.001?'#FAEEDA33':undefined }}>
                      <td style={{ fontSize:12 }}><span className="lot" style={{ fontSize:10 }}>{r.recipe_code}</span> {r.recipe_name}</td>
                      <td><span className="lot" style={{ fontSize:10 }}>{r.lot_number}</span></td>
                      <td style={{ textAlign:'right', fontSize:12 }}>{r.available_kg.toFixed(3)}</td>
                      <td style={{ textAlign:'right' }}>
                        <input type="number" step="0.001" min="0" value={r.inwentura_kg}
                          onChange={e => setInwenturaRows(prev => prev.map((row,i) => i===idx?{...row,inwentura_kg:e.target.value}:row))}
                          style={{ width:100, textAlign:'right', fontSize:12, padding:'3px 6px' }} />
                      </td>
                      <td style={{ textAlign:'right', fontWeight:500, color:Math.abs(diff)>0.001?(diff<0?'#A32D2D':'#085041'):'#888', fontSize:12 }}>
                        {Math.abs(diff)>0.001?(diff>0?'+':'')+diff.toFixed(3):'—'}
                      </td>
                    </tr>
                  )
                })}
                {inwenturaRows.length===0 && <tr><td colSpan={5} style={{ textAlign:'center', padding:16, color:'#888' }}>Brak partii z dostępnym stanem</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setInwenturaModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveInwentura} disabled={savingInwentura}>
              {savingInwentura?'Zapisywanie...':`Zapisz inwenturę (${inwenturaRows.filter(r=>Math.abs(parseFloat(r.inwentura_kg||0)-r.available_kg)>0.001).length} korekt)`}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${wzModal?'open':''}`} onClick={e => e.target===e.currentTarget && setWzModal(false)}>
        <div className="modal">
          <div className="modal-title">Wystawienie dokumentu WZ</div>
          {wzGood && <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}><b>{wzGood.lot_number}</b> — {wzGood.recipe_name}<br />Dostępne: <b>{fmt3(wzGood.available_kg)} kg</b>{wzGood.order_number && <span> · Zlecenie: <b>{wzGood.order_number}</b></span>}</div>}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data wydania</label><input type="date" value={wzForm.issue_date} onChange={e => wf('issue_date', e.target.value)} /></div>
            <div><label>Rodzaj opakowania</label>
              <select value={wzForm.unit_type} onChange={e => wf('unit_type', e.target.value)}>
                <option value="worek">Worek</option><option value="big_bag">Big bag</option>
              </select>
            </div>
          </div>
          <div style={{ background:'#F7F6F1', border:'0.5px solid #E3E1D8', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#085041', marginBottom:8 }}>Opakowanie wydania</div>
            <div className="fr" style={{ marginBottom:0 }}>
              <div><label>Palety</label><input type="number" min="0" step="1" value={wzForm.pallets} onChange={e => wf('pallets', e.target.value)} placeholder="np. 1" /></div>
              <div><label>Liczba opakowań</label><input type="number" min="0" step="1" value={wzForm.unit_count} onChange={e => wfUnits('unit_count', e.target.value)} placeholder="np. 40" /></div>
              <div><label>Waga 1 opakowania (kg)</label><input type="number" min="0" step="0.001" value={wzForm.unit_weight_kg} onChange={e => wfUnits('unit_weight_kg', e.target.value)} placeholder="np. 20" /></div>
            </div>
          </div>
          <div><label>Ilość do wydania (kg) *</label><input type="number" step="0.001" value={wzForm.quantity_kg} onChange={e => wf('quantity_kg', e.target.value)} /></div>
          <div className="fr">
            <div><label>Odbiorca</label><input value={wzForm.recipient} onChange={e => wf('recipient', e.target.value)} placeholder="Nazwa firmy / osoby" /></div>
            <div><label>Przewoźnik / transport</label><input value={wzForm.carrier} onChange={e => wf('carrier', e.target.value)} placeholder="np. DHL, własny transport" /></div>
          </div>
          <div><label>Uwagi</label><input value={wzForm.notes} onChange={e => wf('notes', e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setWzModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveWz} disabled={saving}>{saving?'Zapisywanie...':'Wystaw WZ i drukuj'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${wzEditModal?'open':''}`} onClick={e => e.target===e.currentTarget && setWzEditModal(false)}>
        <div className="modal" style={{ maxWidth:480 }}>
          <div className="modal-title">Edycja WZ — {wzEditDoc?.wz_number}</div>
          <div className="info-box" style={{ marginBottom:10 }}>Edycja dostępna tylko dla Admina.</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Data wydania</label><input type="date" value={wzEditForm.issue_date||''} onChange={e => setWzEditForm(p=>({...p,issue_date:e.target.value}))} /></div>
            <div><label>Rodzaj opakowania</label>
              <select value={wzEditForm.unit_type||'worek'} onChange={e => setWzEditForm(p=>({...p,unit_type:e.target.value}))}>
                <option value="worek">Worek</option><option value="big_bag">Big bag</option>
              </select>
            </div>
          </div>
          <div className="fr">
            <div><label>Palety</label><input type="number" min="0" step="1" value={wzEditForm.pallets??''} onChange={e => setWzEditForm(p=>({...p,pallets:e.target.value}))} placeholder="np. 1" /></div>
            <div><label>Liczba opakowań</label><input type="number" min="0" step="1" value={wzEditForm.unit_count??''} onChange={e => setWzEditForm(p=>{const n={...p,unit_count:e.target.value};const u=parseFloat(n.unit_count)||0,w=parseFloat(n.unit_weight_kg)||0;if(u>0&&w>0)n.quantity_kg=(u*w).toFixed(3);return n})} placeholder="np. 40" /></div>
            <div><label>Waga 1 opak. (kg)</label><input type="number" min="0" step="0.001" value={wzEditForm.unit_weight_kg??''} onChange={e => setWzEditForm(p=>{const n={...p,unit_weight_kg:e.target.value};const u=parseFloat(n.unit_count)||0,w=parseFloat(n.unit_weight_kg)||0;if(u>0&&w>0)n.quantity_kg=(u*w).toFixed(3);return n})} placeholder="np. 20" /></div>
          </div>
          <div><label>Ilość (kg)</label><input type="number" step="0.001" value={wzEditForm.quantity_kg||''} onChange={e => setWzEditForm(p=>({...p,quantity_kg:e.target.value}))} /></div>
          <div className="fr">
            <div><label>Odbiorca</label><input value={wzEditForm.recipient||''} onChange={e => setWzEditForm(p=>({...p,recipient:e.target.value}))} placeholder="Nazwa firmy / osoby" /></div>
            <div><label>Przewoźnik</label><input value={wzEditForm.carrier||''} onChange={e => setWzEditForm(p=>({...p,carrier:e.target.value}))} placeholder="np. DHL" /></div>
          </div>
          <div><label>Uwagi</label><input value={wzEditForm.notes||''} onChange={e => setWzEditForm(p=>({...p,notes:e.target.value}))} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setWzEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveWzEdit} disabled={savingWzEdit}>{savingWzEdit?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${wzDeleteConfirm?'open':''}`} onClick={e => e.target===e.currentTarget && setWzDeleteConfirm(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń dokument WZ</div>
          <div className="warn-box">Czy na pewno chcesz usunąć dokument <b>{wzDeleteConfirm?.wz_number}</b>?<br/>Ilość wydana ({wzDeleteConfirm?.quantity_kg} kg) wróci na stan magazynowy.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setWzDeleteConfirm(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteWz(wzDeleteConfirm)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
