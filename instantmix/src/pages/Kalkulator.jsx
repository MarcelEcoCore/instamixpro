import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Kalkulator() {
  const { profile } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [mass, setMass] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const { data } = await supabase.from('recipes')
      .select('*, recipe_items(sort_order, percentage, ingredients(code,name,has_allergen,allergen_type))')
      .eq('status','dopuszczona').order('code')
    setRecipes(data || [])
    setLoading(false)
  }

  const q = search.toLowerCase()
  const recipesFiltered = recipes.filter(r => !q || (r.code||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q) || (r.client||'').toLowerCase().includes(q))
  const recipe = recipes.find(r => r.id === recipeId)
  const m = parseFloat(mass) || 0

  const rows = recipe ? [...(recipe.recipe_items||[])].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(it => ({
    code: it.ingredients?.code || '', name: it.ingredients?.name || '',
    pct: parseFloat(it.percentage||0), kg: parseFloat(((m * parseFloat(it.percentage||0))/100).toFixed(3)),
    allergen: it.ingredients?.has_allergen ? it.ingredients.allergen_type : '',
  })) : []
  const sumKg = rows.reduce((s,r)=>s+r.kg,0)
  const sumPct = rows.reduce((s,r)=>s+r.pct,0)
  const allergens = [...new Set(rows.filter(r=>r.allergen).map(r=>r.allergen))]

  function printCard() {
    if (!recipe) return
    const now = new Date()
    const allergenBlock = allergens.length>0
      ? `<div class="allergen-box"><strong>⚠ ALERGENY:</strong> ${allergens.join(', ')}</div>`
      : `<div class="no-allergen-box">✓ Brak alergenów</div>`
    const body = rows.map((r,i)=>`<tr><td class="num">${i+1}</td><td class="code">${r.code}</td><td>${r.name}</td><td class="pct">${r.pct.toFixed(2)}%</td><td class="kg"><strong>${r.kg.toFixed(3)}</strong></td><td class="al">${r.allergen?`<span class="tag">${r.allergen}</span>`:'—'}</td></tr>`).join('')
    const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>Karta poglądowa - ${recipe.code}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#000;padding:16px}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #0F6E56;padding-bottom:10px;margin-bottom:12px}
.company{font-size:16px;font-weight:bold;color:#0F6E56}.doc-title{font-size:13px;font-weight:bold;margin-top:4px}
.badge{background:#FFF3E0;border:1px solid #FFB74D;border-radius:4px;padding:3px 8px;font-size:10px;color:#E65100;display:inline-block;margin-top:4px}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
.info-box{border:1px solid #D3D1C7;border-radius:4px;padding:6px 10px}.info-label{font-size:9px;color:#888;text-transform:uppercase;margin-bottom:2px}.info-value{font-size:13px;font-weight:bold}
table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#F1EFE8;font-size:9px;font-weight:bold;text-transform:uppercase;padding:5px 6px;border:1px solid #D3D1C7;text-align:left}
td{padding:5px 6px;border:1px solid #D3D1C7;font-size:10px}tr:nth-child(even) td{background:#FAFAF8}
.num{width:24px;text-align:center;color:#888}.code{width:80px;font-family:monospace}.pct{width:70px;text-align:right}.kg{width:90px;text-align:right}.al{width:80px}
.tag{background:#FCEBEB;color:#791F1F;border:1px solid #F09595;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:bold}
.total td{background:#E1F5EE!important;font-weight:bold}
.allergen-box{background:#FCEBEB;border:1.5px solid #E24B4A;border-radius:4px;padding:8px 12px;margin-bottom:10px;color:#501313}.no-allergen-box{background:#E1F5EE;border:1px solid #1D9E75;border-radius:4px;padding:6px 12px;margin-bottom:10px;color:#085041}
@media print{body{padding:8px}@page{margin:10mm;size:A4}}</style></head><body>
<div class="header"><div><div class="company">InstantMix Pro</div><div class="doc-title">Karta poglądowa — kalkulacja składników</div><div class="badge">PODGLĄD — nie tworzy zlecenia produkcji</div></div>
<div style="text-align:right;font-size:10px;color:#555"><div>Data: <strong>${now.toLocaleDateString('pl-PL')} ${now.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</strong></div><div>Sporządził: <strong>${profile?.full_name||'—'}</strong></div></div></div>
<div class="info-grid">
<div class="info-box"><div class="info-label">Receptura</div><div class="info-value">${recipe.code} (v${recipe.version})</div></div>
<div class="info-box"><div class="info-label">Nazwa</div><div class="info-value">${recipe.name}</div></div>
<div class="info-box"><div class="info-label">Masa wsadu</div><div class="info-value">${m.toFixed(3)} kg</div></div></div>
${allergenBlock}
<table><thead><tr><th class="num">Lp.</th><th class="code">Kod</th><th>Nazwa składnika</th><th class="pct">Udział %</th><th class="kg">Ilość (kg)</th><th class="al">Alergen</th></tr></thead><tbody>
${body}
<tr class="total"><td></td><td></td><td style="text-align:right">RAZEM:</td><td style="text-align:right">${sumPct.toFixed(2)}%</td><td style="text-align:right">${sumKg.toFixed(3)} kg</td><td></td></tr>
</tbody></table>
<div style="margin-top:16px;font-size:9px;color:#888">Dokument poglądowy do planowania/kontroli. Nie jest zleceniem produkcji ani kartą dozowania z numerami partii.</div>
<script>window.onload=function(){window.print()}</script></body></html>`
    const win = window.open('','_blank'); win.document.write(html); win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Kalkulator</div><div className="page-sub">Ręczne przeliczenie składników receptury — podgląd i wydruk (nie tworzy produkcji)</div></div>
      </div>

      <div className="card" style={{ marginBottom:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, alignItems:'end' }}>
          <div>
            <label>Receptura</label>
            <input className="search" placeholder="Szukaj receptury (kod / nazwa / klient)..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom:6, width:'100%' }} />
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)} style={{ width:'100%' }}>
              <option value="">— wybierz recepturę —</option>
              {recipesFiltered.map(r => <option key={r.id} value={r.id}>{r.code} — {r.name} (v{r.version})</option>)}
            </select>
          </div>
          <div>
            <label>Masa wsadu (kg)</label>
            <input type="number" step="0.001" min="0" value={mass} onChange={e => setMass(e.target.value)} placeholder="np. 500" />
          </div>
        </div>
        {loading && <div className="muted" style={{ marginTop:8, fontSize:12 }}>Ładowanie receptur...</div>}
      </div>

      {recipe && m>0 && (
        <>
          {allergens.length>0 && <div className="err-box" style={{ marginBottom:10 }}>⚠ Alergeny w recepturze: <b>{allergens.join(', ')}</b></div>}
          <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto' }}>
            <table style={{ minWidth:620 }}>
              <thead><tr><th style={{width:36}}>Lp.</th><th>Kod</th><th>Nazwa składnika</th><th style={{textAlign:'right'}}>Udział %</th><th style={{textAlign:'right'}}>Ilość (kg)</th><th>Alergen</th></tr></thead>
              <tbody>
                {rows.map((r,i) => (
                  <tr key={i}>
                    <td className="muted" style={{textAlign:'center'}}>{i+1}</td>
                    <td><span className="lot">{r.code}</span></td>
                    <td style={{fontWeight:500}}>{r.name}</td>
                    <td style={{textAlign:'right'}}>{r.pct.toFixed(2)}%</td>
                    <td style={{textAlign:'right', fontWeight:600}}>{r.kg.toFixed(3)}</td>
                    <td>{r.allergen ? <span className="badge b-err" style={{fontSize:10}}>{r.allergen}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                <tr style={{ background:'#E1F5EE' }}>
                  <td colSpan={3} style={{ textAlign:'right', fontWeight:700 }}>RAZEM</td>
                  <td style={{ textAlign:'right', fontWeight:700 }}>{sumPct.toFixed(2)}%</td>
                  <td style={{ textAlign:'right', fontWeight:700 }}>{sumKg.toFixed(3)} kg</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex" style={{ justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn btn-primary" onClick={printCard}>🖨 Drukuj kartę poglądową</button>
          </div>
        </>
      )}
      {recipe && m<=0 && <div className="muted" style={{ fontSize:13, padding:12 }}>Podaj masę wsadu, aby przeliczyć składniki.</div>}
    </div>
  )
}
