import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const SEED_OBJECTS = [
  {
    id: 1, title: "Untitled (Blue Period Study)", artist: "Pablo Picasso",
    medium: "Oil on canvas", year: 1903, category: "Painting",
    valuations: [
      { date: "2018-03-15", value: 1200000, note: "Christie's appraisal" },
      { date: "2019-09-10", value: 1450000, note: "Insurance renewal" },
      { date: "2021-02-20", value: 1800000, note: "Sotheby's estimate" },
      { date: "2022-11-05", value: 2100000, note: "Private sale offer" },
      { date: "2024-01-12", value: 2650000, note: "Current appraisal" },
    ],
  },
  {
    id: 2, title: "River Landscape at Dusk", artist: "J.M.W. Turner",
    medium: "Watercolour", year: 1842, category: "Painting",
    valuations: [
      { date: "2017-06-01", value: 320000,  note: "Acquisition price" },
      { date: "2019-04-18", value: 410000,  note: "Bonhams appraisal" },
      { date: "2021-08-30", value: 390000,  note: "Insurance renewal" },
      { date: "2023-03-14", value: 520000,  note: "Current appraisal" },
    ],
  },
  {
    id: 3, title: "Bronze Figure No. 4", artist: "Henry Moore",
    medium: "Bronze", year: 1957, category: "Sculpture",
    valuations: [
      { date: "2019-01-10", value: 750000,  note: "Acquisition price" },
      { date: "2020-07-22", value: 820000,  note: "Insurance renewal" },
      { date: "2022-05-05", value: 960000,  note: "Christie's estimate" },
      { date: "2024-02-28", value: 1150000, note: "Current appraisal" },
    ],
  },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtShort = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : "$" + (n / 1000).toFixed(0) + "K";
const fmtDate = (d) => { if (!d) return "—"; const p = d.split("-"); const m = MONTHS[+p[1]-1]||""; return p.length===2?`${m} '${p[0].slice(2)}`:`${m} ${+p[2]}, ${p[0]}`; };
const fmtAxis = (d) => { if (!d) return ""; const p = d.split("-"); return `${MONTHS[+p[1]-1]||""} '${p[0].slice(2)}`; };
const pct = (a, b) => (((b - a) / a) * 100).toFixed(1);

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => { const vals = line.split(",").map((v) => v.trim()); const obj = {}; headers.forEach((h, i) => (obj[h] = vals[i] || "")); return obj; });
}

// ── AI fetch — calls /api/comparables serverless function when hosted,
//    falls back to direct Anthropic API when running in Claude.ai ─────────────
async function fetchComparables(artist, medium, category) {
  const prompt_search = `Search for recent auction results (2020–2025) for works by ${artist}${medium ? `, particularly ${medium}` : ""} works. Find 5–7 real hammer prices from Christie's, Sotheby's, Phillips, or Bonhams. List each result with: work title, year made, medium, sale price in USD, auction house, and sale date (YYYY-MM format). Also note the general market trend (rising/stable/declining) and what drives value for this artist.`;

  const prompt_json = (searchText) => `Convert the following auction research into a JSON object. Return ONLY the JSON — no explanation, no markdown, no code fences. Start with { and end with }.

Research:
${searchText}

Required JSON shape:
{
  "artist": "${artist}",
  "marketSummary": "2-3 sentence summary of market performance",
  "trend": "rising",
  "comparables": [
    { "title": "Work Title", "year": 1955, "medium": "Oil on canvas", "salePrice": 1200000, "auctionHouse": "Christie's", "saleDate": "2023-06" }
  ],
  "lowEstimate": 500000,
  "highEstimate": 2000000,
  "notes": "Key value drivers"
}

Rules: trend must be "rising", "stable", or "declining". salePrice in USD as a number. Return only the JSON object.`;

  // Try serverless proxy first (works when hosted on Vercel with API key set)
  try {
    const res = await fetch("/api/comparables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist, medium, category }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.comparables) return data;
    }
  } catch (_) {}

  // Fallback: direct Anthropic API (works in Claude.ai artifacts)
  const callClaude = async (messages, useSearch = false) => {
    const body = { model: "claude-sonnet-4-6", max_tokens: 2000, messages };
    if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  };

  const extractText = (data) => (data.content||[]).filter((b)=>b.type==="text").map((b)=>b.text).join("\n").trim();

  const tryParseJSON = (str) => {
    const c = str.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
    try { return JSON.parse(c); } catch (_) {}
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s !== -1 && e > s) { try { return JSON.parse(c.slice(s, e+1)); } catch (_) {} }
    return null;
  };

  const searchData = await callClaude([{ role:"user", content: prompt_search }], true);
  const searchText = extractText(searchData);
  if (!searchText) throw new Error("No search results");

  const jsonData = await callClaude([{ role:"user", content: prompt_json(searchText) }], false);
  const jsonText = extractText(jsonData);
  if (!jsonText) throw new Error("No JSON response");

  const parsed = tryParseJSON(jsonText);
  if (!parsed) throw new Error("Could not parse response — please try again");
  return parsed;
}

const C = { bg:"#0F0E0C", card:"#161410", border:"#252019", gold:"#C9A84C", goldFaint:"#C9A84C22", text:"#E4DCCF", muted:"#8A7A68", dim:"#5A5044", green:"#6FA87A", red:"#A8706F", inner:"#121009", active:"#1C1914" };

const mkBtn = (variant="primary", extra={}) => ({
  background: variant==="primary"?C.gold:variant==="danger"?"#3D1515":"transparent",
  color: variant==="primary"?C.bg:variant==="danger"?"#C97070":C.gold,
  border:`1px solid ${variant==="primary"?C.gold:variant==="danger"?"#6B2525":C.border}`,
  padding:"7px 14px", cursor:"pointer", fontSize:10, letterSpacing:"0.1em",
  textTransform:"uppercase", borderRadius:2, fontFamily:"Georgia, serif", whiteSpace:"nowrap", ...extra,
});
const mkInput = (extra={}) => ({ background:C.inner, border:`1px solid ${C.border}`, color:C.text, padding:"8px 10px", borderRadius:2, fontSize:13, width:"100%", fontFamily:"Georgia, serif", outline:"none", boxSizing:"border-box", ...extra });

const LBL  = { fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:C.dim, marginBottom:4, display:"block" };
const CARD = { background:C.card, border:`1px solid ${C.border}`, borderRadius:3, padding:"16px", marginBottom:14 };
const SEC  = { fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:C.dim, marginBottom:10, borderBottom:`1px solid ${C.border}`, paddingBottom:6 };

const ChartTip = ({ active, payload, label:lbl }) => {
  if (!active||!payload?.length) return null;
  return <div style={{ background:"#1A1712", border:`1px solid ${C.goldFaint}`, padding:"9px 13px", borderRadius:3, fontSize:12 }}><div style={{ color:C.gold, marginBottom:3 }}>{lbl}</div>{payload.map((p)=><div key={p.dataKey} style={{ color:p.color }}>{p.name}: {fmt(p.value)}</div>)}</div>;
};

const StatCard = ({ lbl, val, sub, subColor }) => (
  <div style={{ background:C.card, border:`1px solid ${C.border}`, padding:"13px 14px", borderRadius:3, minWidth:0 }}>
    <div style={LBL}>{lbl}</div>
    <div style={{ fontSize:18, color:C.text, lineHeight:1.2, wordBreak:"break-word" }}>{val}</div>
    {sub && <div style={{ fontSize:11, color:subColor||C.muted, marginTop:3 }}>{sub}</div>}
  </div>
);

function ComparablesPanel({ object }) {
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setStatus("loading"); setErr("");
    try { setData(await fetchComparables(object.artist, object.medium, object.category)); setStatus("done"); }
    catch (e) { setErr(e.message); setStatus("error"); }
  };

  const currentVal = [...object.valuations].sort((a,b)=>a.date.localeCompare(b.date)).slice(-1)[0]?.value;
  const tC = !data?C.dim:data.trend==="rising"?C.green:data.trend==="declining"?C.red:C.muted;
  const tA = data?.trend==="rising"?"▲":data?.trend==="declining"?"▼":"◆";
  const tL = data?.trend?data.trend[0].toUpperCase()+data.trend.slice(1):"—";
  let vsMarket = null;
  if (currentVal&&data?.lowEstimate&&data?.highEstimate) {
    if (currentVal<data.lowEstimate) vsMarket={label:"Below range",color:C.gold};
    else if (currentVal>data.highEstimate) vsMarket={label:"Above range",color:C.gold};
    else vsMarket={label:"Within range",color:C.green};
  }
  const compChart = (data?.comparables||[]).filter((c)=>c.salePrice&&c.saleDate).sort((a,b)=>a.saleDate.localeCompare(b.saleDate)).map((c)=>({ date:fmtAxis(c.saleDate), comp:c.salePrice }));

  return (
    <div style={CARD}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12 }}>
        <div style={{ fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:C.dim }}>Market Comparables · AI</div>
        <button style={mkBtn(status==="done"?"ghost":"secondary",{ fontSize:10, padding:"5px 11px" })} onClick={run} disabled={status==="loading"}>
          {status==="loading"?"Searching…":status==="done"?"↻ Refresh":"Search Live Market"}
        </button>
      </div>
      {status==="idle"&&<div style={{ padding:"12px 0 2px", color:C.dim, fontSize:12, lineHeight:1.7 }}>Search recent auction sales for <span style={{ color:C.gold }}>{object.artist}</span> to see market comparables and price range.</div>}
      {status==="loading"&&<div style={{ padding:"18px 0 4px", color:C.dim, fontSize:12 }}><style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}`}</style><div style={{ color:C.gold, fontSize:18, marginBottom:8, animation:"pulse 1.4s infinite", textAlign:"center" }}>◎</div><div style={{ textAlign:"center" }}>Searching Christie's, Sotheby's, Phillips &amp; Bonhams…</div></div>}
      {status==="error"&&<div style={{ padding:"8px 0 2px", fontSize:12, color:C.red }}>{err}. <span style={{ color:C.gold, cursor:"pointer", textDecoration:"underline" }} onClick={run}>Try again</span></div>}
      {status==="done"&&data&&(
        <>
          <div style={{ background:C.inner, border:`1px solid ${C.border}`, borderRadius:2, padding:"11px 13px", marginBottom:12 }}>
            <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginBottom:8 }}>
              <div><div style={LBL}>Trend</div><div style={{ color:tC, fontSize:13 }}>{tA} {tL}</div></div>
              {data.lowEstimate&&<div><div style={LBL}>Comparable Range</div><div style={{ color:C.text, fontSize:12 }}>{fmt(data.lowEstimate)} – {fmt(data.highEstimate)}</div></div>}
              {vsMarket&&<div><div style={LBL}>Your Valuation</div><div style={{ color:vsMarket.color, fontSize:13 }}>{vsMarket.label}</div></div>}
            </div>
            <div style={{ fontSize:12, color:C.muted, lineHeight:1.65 }}>{data.marketSummary}</div>
            {data.notes&&<div style={{ fontSize:11, color:C.dim, marginTop:6, fontStyle:"italic" }}>{data.notes}</div>}
          </div>
          {data.comparables?.length>0&&(
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:C.dim, marginBottom:7 }}>Recent Sales</div>
              {data.comparables.map((c,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"9px 0", borderBottom:`1px solid ${C.border}`, gap:10 }}>
                  <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, color:C.text, marginBottom:1, wordBreak:"break-word" }}>{c.title||"Untitled"}</div><div style={{ fontSize:11, color:C.dim }}>{[c.medium,c.year,c.auctionHouse].filter(Boolean).join(" · ")}</div></div>
                  <div style={{ textAlign:"right", flexShrink:0 }}><div style={{ fontSize:13, color:C.gold }}>{c.salePrice?fmt(c.salePrice):"—"}</div><div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{c.saleDate?fmtAxis(c.saleDate):""}</div></div>
                </div>
              ))}
            </div>
          )}
          {compChart.length>=2&&(<><div style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:C.dim, marginBottom:7 }}>Sale Prices Over Time</div><ResponsiveContainer width="100%" height={100}><LineChart data={compChart} margin={{ top:2, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:9 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:9 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="comp" stroke="#7B9E87" strokeWidth={2} dot={{ fill:"#7B9E87", r:3 }} name="Sale price" /></LineChart></ResponsiveContainer></>)}
          <div style={{ fontSize:10, color:C.dim, marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:9, lineHeight:1.5 }}>Public auction records via live web search. For research only — not a formal appraisal.</div>
        </>
      )}
    </div>
  );
}

function ConfirmModal({ title, onConfirm, onCancel }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"#000000BB", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:4, padding:"24px 20px", maxWidth:320, width:"100%" }}>
        <div style={{ fontSize:15, color:C.text, marginBottom:8 }}>Delete object?</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:20, lineHeight:1.6 }}><span style={{ color:C.gold }}>{title}</span> and all its valuations will be permanently removed.</div>
        <div style={{ display:"flex", gap:10 }}>
          <button style={mkBtn("danger")} onClick={onConfirm}>Delete</button>
          <button style={mkBtn("ghost")} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [objects,      setObjects]      = useState(SEED_OBJECTS);
  const [selectedId,   setSelectedId]   = useState(null);
  const [view,         setView]         = useState("portfolio");
  const [newObj,       setNewObj]       = useState({ title:"", artist:"", medium:"", year:"", category:"Painting" });
  const [newVal,       setNewVal]       = useState({ date:"", value:"", note:"" });
  const [importText,   setImportText]   = useState("");
  const [importError,  setImportError]  = useState("");
  const [importStep,   setImportStep]   = useState(1);
  const [importMapped, setImportMapped] = useState(null);
  const [showAddVal,   setShowAddVal]   = useState(false);
  const [toast,        setToast]        = useState(null);
  const [editMode,     setEditMode]     = useState(false);
  const [editObj,      setEditObj]      = useState(null);
  const [confirmDelete,setConfirmDelete]= useState(false);

  const notify = (msg) => { setToast(msg); setTimeout(()=>setToast(null), 2800); };
  const selected = objects.find((o)=>o.id===selectedId);

  const portfolioChart = useMemo(()=>{
    const dates = [...new Set(objects.flatMap((o)=>o.valuations.map((v)=>v.date)))].sort();
    return dates.map((date)=>{ let total=0; objects.forEach((obj)=>{ const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)); const before=s.filter((v)=>v.date<=date); if(before.length) total+=before[before.length-1].value; }); return { date:fmtAxis(date), total }; });
  }, [objects]);

  const objectChart = useMemo(()=>{ if(!selected) return []; return [...selected.valuations].sort((a,b)=>a.date.localeCompare(b.date)).map((v)=>({ date:fmtAxis(v.date), value:v.value })); }, [selected]);

  const portStats = useMemo(()=>{
    const totals = objects.map((o)=>{ const s=[...o.valuations].sort((a,b)=>a.date.localeCompare(b.date)); return { first:s[0]?.value||0, last:s[s.length-1]?.value||0 }; });
    const cur=totals.reduce((acc,t)=>acc+t.last,0), acq=totals.reduce((acc,t)=>acc+t.first,0), gain=cur-acq;
    return { cur, acq, gain, gainPct:acq?((gain/acq)*100).toFixed(1):"0.0" };
  }, [objects]);

  const objStats = useMemo(()=>{
    if (!selected?.valuations?.length) return null;
    const s=[...selected.valuations].sort((a,b)=>a.date.localeCompare(b.date));
    const first=s[0], last=s[s.length-1];
    return { first, last, change:last.value-first.value, changePct:pct(first.value,last.value) };
  }, [selected]);

  const addObject = () => { if(!newObj.title||!newObj.artist) return; const id=Date.now(); setObjects((p)=>[...p,{ ...newObj, id, year:+newObj.year, valuations:[] }]); setNewObj({ title:"", artist:"", medium:"", year:"", category:"Painting" }); setSelectedId(id); setView("object"); notify("Object added"); };
  const addValuation = () => { if(!newVal.date||!newVal.value||!selectedId) return; setObjects((p)=>p.map((o)=>o.id===selectedId?{ ...o, valuations:[...o.valuations,{ ...newVal, value:+newVal.value }] }:o)); setNewVal({ date:"", value:"", note:"" }); setShowAddVal(false); notify("Valuation saved"); };
  const startEdit = () => { setEditObj({ ...selected }); setEditMode(true); };
  const saveEdit = () => { setObjects((p)=>p.map((o)=>o.id===selectedId?{ ...o, ...editObj, year:+editObj.year }:o)); setEditMode(false); setEditObj(null); notify("Object updated"); };
  const cancelEdit = () => { setEditMode(false); setEditObj(null); };
  const deleteObject = () => { setObjects((p)=>p.filter((o)=>o.id!==selectedId)); setSelectedId(null); setView("portfolio"); setConfirmDelete(false); notify("Object deleted"); };
  const importParse = () => { try { const rows=parseCSV(importText); if(!rows.length) throw new Error("No rows"); setImportMapped(rows); setImportStep(2); setImportError(""); } catch(e) { setImportError(e.message); } };
  const importConfirm = () => { if(!importMapped) return; const grouped={}; importMapped.forEach((row)=>{ const key=`${row.title}|${row.artist}`; if(!grouped[key]) grouped[key]={ title:row.title, artist:row.artist, medium:row.medium||"", year:+(row.year||0), category:row.category||"Painting", valuations:[] }; if(row.date&&row.value) grouped[key].valuations.push({ date:row.date, value:+row.value, note:row.note||"" }); }); const objs=Object.values(grouped).map((o,i)=>({ ...o, id:Date.now()+i })); setObjects((p)=>[...p,...objs]); setImportText(""); setImportMapped(null); setImportStep(1); setView("portfolio"); notify(`Imported ${objs.length} object(s)`); };

  const NAV = [{ key:"portfolio", label:"Portfolio" }, { key:"object", label:"Object", disabled:!selected }, { key:"add", label:"+ Add" }, { key:"import", label:"CSV" }];

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:"'Georgia', serif", overflowX:"hidden" }}>

      {confirmDelete&&selected&&<ConfirmModal title={selected.title} onConfirm={deleteObject} onCancel={()=>setConfirmDelete(false)} />}

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"14px 16px", boxSizing:"border-box", width:"100%" }}>
        <div style={{ marginBottom:11 }}>
          <div style={{ fontSize:17, letterSpacing:"0.14em", color:C.gold }}>PROVENANCE</div>
          <div style={{ fontSize:9, letterSpacing:"0.2em", color:C.dim, textTransform:"uppercase", marginTop:2 }}>Collection Value Intelligence</div>
        </div>
        <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:1, WebkitOverflowScrolling:"touch" }}>
          {NAV.map(({ key, label, disabled })=>(
            <button key={key} style={{ background:view===key?C.gold:"transparent", color:view===key?C.bg:disabled?C.dim:C.muted, border:`1px solid ${view===key?C.gold:C.border}`, padding:"6px 13px", cursor:disabled?"default":"pointer", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", borderRadius:2, fontFamily:"Georgia, serif", whiteSpace:"nowrap", flexShrink:0, opacity:disabled?0.4:1 }}
              onClick={()=>{ if(disabled) return; setView(key); }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:"18px 16px", boxSizing:"border-box", width:"100%", maxWidth:860, margin:"0 auto" }}>

        {/* ── PORTFOLIO ── */}
        {view==="portfolio"&&(
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              <StatCard lbl="Total Value" val={fmt(portStats.cur)} />
              <StatCard lbl="Total Gain" val={fmt(portStats.gain)} sub={`${portStats.gain>=0?"▲":"▼"} ${Math.abs(portStats.gainPct)}%`} subColor={portStats.gain>=0?C.green:C.red} />
              <StatCard lbl="Objects" val={objects.length} />
              <StatCard lbl="Acquisition Cost" val={fmt(portStats.acq)} />
            </div>
            <div style={CARD}>
              <div style={SEC}>Portfolio Value Over Time</div>
              <ResponsiveContainer width="100%" height={190}><LineChart data={portfolioChart} margin={{ top:4, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="total" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:3 }} activeDot={{ r:5 }} name="Total Value" /></LineChart></ResponsiveContainer>
            </div>
            <div style={SEC}>Objects</div>
            {objects.map((obj)=>{
              const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)), cur=s[s.length-1]?.value||0, fst=s[0]?.value||0, g=fst?pct(fst,cur):null;
              return (
                <div key={obj.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px", cursor:"pointer", borderRadius:2, marginBottom:4, background:selectedId===obj.id?C.active:"transparent", border:`1px solid ${selectedId===obj.id?C.gold+"44":"transparent"}`, boxSizing:"border-box" }}
                  onClick={()=>{ setSelectedId(obj.id); setView("object"); }}>
                  <div style={{ flex:1, minWidth:0, paddingRight:10 }}>
                    <div style={{ fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{obj.title}</div>
                    <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{obj.artist} · {obj.year}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:14, color:C.gold }}>{fmt(cur)}</div>
                    {g!==null&&<div style={{ fontSize:11, color:cur>=fst?C.green:C.red, marginTop:1 }}>{cur>=fst?"▲":"▼"} {Math.abs(g)}%</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── OBJECT ── */}
        {view==="object"&&selected&&(
          <>
            {editMode&&editObj ? (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:16, color:C.text, marginBottom:14 }}>Edit Object</div>
                <div style={CARD}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:13 }}>
                    <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Title</label><input style={mkInput()} value={editObj.title} onChange={(e)=>setEditObj({...editObj,title:e.target.value})} /></div>
                    <div><label style={LBL}>Artist / Maker</label><input style={mkInput()} value={editObj.artist} onChange={(e)=>setEditObj({...editObj,artist:e.target.value})} /></div>
                    <div><label style={LBL}>Year</label><input style={mkInput()} type="number" value={editObj.year} onChange={(e)=>setEditObj({...editObj,year:e.target.value})} /></div>
                    <div><label style={LBL}>Medium</label><input style={mkInput()} value={editObj.medium} onChange={(e)=>setEditObj({...editObj,medium:e.target.value})} /></div>
                    <div><label style={LBL}>Category</label><select style={mkInput()} value={editObj.category} onChange={(e)=>setEditObj({...editObj,category:e.target.value})}>{["Painting","Sculpture","Works on Paper","Photography","Decorative Arts","Jewellery","Furniture","Other"].map((c)=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <div style={{ display:"flex", gap:10 }}>
                    <button style={mkBtn("primary")} onClick={saveEdit}>Save Changes</button>
                    <button style={mkBtn("ghost")} onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* ── Object header — title full width, buttons on their own row ── */}
                <div style={{ marginBottom:16 }}>
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:22, lineHeight:1.2, marginBottom:3 }}>{selected.title}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{selected.artist} · {selected.year} · {selected.medium}</div>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button style={mkBtn("ghost",{ fontSize:10, padding:"5px 12px" })} onClick={()=>setView("portfolio")}>← Back</button>
                    <button style={mkBtn("secondary",{ fontSize:10, padding:"5px 12px" })} onClick={startEdit}>Edit</button>
                    <button style={mkBtn("danger",{ fontSize:10, padding:"5px 12px" })} onClick={()=>setConfirmDelete(true)}>Delete</button>
                  </div>
                </div>

                {objStats&&(
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                    <StatCard lbl="Current Value" val={fmt(objStats.last.value)} sub={fmtDate(objStats.last.date)} />
                    <StatCard lbl="Total Change" val={fmt(objStats.change)} sub={`${objStats.change>=0?"▲":"▼"} ${Math.abs(objStats.changePct)}%`} subColor={objStats.change>=0?C.green:C.red} />
                    <StatCard lbl="Acquired" val={fmt(objStats.first.value)} sub={fmtDate(objStats.first.date)} />
                    <StatCard lbl="Valuations" val={selected.valuations.length} />
                  </div>
                )}

                {objectChart.length>0&&(
                  <div style={CARD}>
                    <div style={SEC}>Value History</div>
                    <ResponsiveContainer width="100%" height={170}><LineChart data={objectChart} margin={{ top:4, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="value" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:4 }} activeDot={{ r:6 }} name={selected.artist} /></LineChart></ResponsiveContainer>
                  </div>
                )}

                <ComparablesPanel key={selected.id} object={selected} />

                <div style={CARD}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12 }}>
                    <div style={{ fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:C.dim }}>Valuation Ledger</div>
                    <button style={mkBtn("secondary",{ fontSize:10, padding:"5px 11px" })} onClick={()=>setShowAddVal((v)=>!v)}>{showAddVal?"Cancel":"+ Add"}</button>
                  </div>
                  {showAddVal&&(
                    <div style={{ background:C.inner, border:`1px solid ${C.border}`, borderRadius:2, padding:"13px", marginBottom:13 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, marginBottom:9 }}>
                        <div><label style={LBL}>Date</label><input type="date" style={mkInput()} value={newVal.date} onChange={(e)=>setNewVal({...newVal,date:e.target.value})} /></div>
                        <div><label style={LBL}>Value (USD)</label><input type="number" style={mkInput()} placeholder="0" value={newVal.value} onChange={(e)=>setNewVal({...newVal,value:e.target.value})} /></div>
                        <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Source / Note</label><input type="text" style={mkInput()} placeholder="e.g. Christie's appraisal" value={newVal.note} onChange={(e)=>setNewVal({...newVal,note:e.target.value})} /></div>
                      </div>
                      <button style={mkBtn("primary")} onClick={addValuation}>Save</button>
                    </div>
                  )}
                  {[...selected.valuations].sort((a,b)=>b.date.localeCompare(a.date)).map((v,i,arr)=>{
                    const prev=arr[i+1], chg=prev?v.value-prev.value:null, chgP=prev?pct(prev.value,v.value):null;
                    return (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:`1px solid ${C.border}`, background:i%2?C.inner+"88":"transparent" }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, color:C.gold, marginBottom:2 }}>{fmt(v.value)}</div>
                          <div style={{ fontSize:11, color:C.dim }}>{fmtDate(v.date)}</div>
                          {v.note&&<div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{v.note}</div>}
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          {chg!==null?(<><div style={{ fontSize:13, color:chg>=0?C.green:C.red }}>{chg>=0?"▲":"▼"} {fmt(Math.abs(chg))}</div><div style={{ fontSize:11, color:chg>=0?C.green:C.red, marginTop:1 }}>{Math.abs(chgP)}%</div></>):(<div style={{ fontSize:11, color:C.dim }}>Acquisition</div>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ── ADD ── */}
        {view==="add"&&(
          <div>
            <div style={{ fontSize:17, marginBottom:18 }}>Add Object</div>
            <div style={CARD}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:13 }}>
                <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Title</label><input style={mkInput()} value={newObj.title} onChange={(e)=>setNewObj({...newObj,title:e.target.value})} placeholder="Object title" /></div>
                <div><label style={LBL}>Artist / Maker</label><input style={mkInput()} value={newObj.artist} onChange={(e)=>setNewObj({...newObj,artist:e.target.value})} placeholder="Name" /></div>
                <div><label style={LBL}>Year</label><input style={mkInput()} type="number" value={newObj.year} onChange={(e)=>setNewObj({...newObj,year:e.target.value})} placeholder="e.g. 1952" /></div>
                <div><label style={LBL}>Medium</label><input style={mkInput()} value={newObj.medium} onChange={(e)=>setNewObj({...newObj,medium:e.target.value})} placeholder="e.g. Oil on canvas" /></div>
                <div><label style={LBL}>Category</label><select style={mkInput()} value={newObj.category} onChange={(e)=>setNewObj({...newObj,category:e.target.value})}>{["Painting","Sculpture","Works on Paper","Photography","Decorative Arts","Jewellery","Furniture","Other"].map((c)=><option key={c}>{c}</option>)}</select></div>
              </div>
              <button style={mkBtn("primary")} onClick={addObject}>Add to Collection</button>
            </div>
          </div>
        )}

        {/* ── IMPORT ── */}
        {view==="import"&&(
          <div>
            <div style={{ fontSize:17, marginBottom:5 }}>Import CSV</div>
            <div style={{ fontSize:12, color:C.dim, marginBottom:18, lineHeight:1.6 }}>Columns: <span style={{ color:C.gold }}>title, artist, medium, year, category, date, value, note</span></div>
            {importStep===1&&(<div style={CARD}><label style={LBL}>Paste CSV</label><textarea style={mkInput({ height:160, resize:"vertical", display:"block", marginBottom:11 })} value={importText} onChange={(e)=>setImportText(e.target.value)} placeholder={"title,artist,medium,year,category,date,value,note\nBlue Study,Picasso,Oil,1903,Painting,2020-01-01,1200000,Christie's"} />{importError&&<div style={{ color:C.red, fontSize:12, marginBottom:9 }}>{importError}</div>}<button style={mkBtn("primary")} onClick={importParse}>Parse</button></div>)}
            {importStep===2&&importMapped&&(<div style={CARD}><div style={SEC}>Preview — {importMapped.length} rows</div><div style={{ overflowX:"auto", marginBottom:14 }}><table style={{ borderCollapse:"collapse", fontSize:11, minWidth:"100%" }}><thead><tr>{Object.keys(importMapped[0]).map((k)=>(<th key={k} style={{ padding:"4px 7px", textAlign:"left", color:C.dim, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{k}</th>))}</tr></thead><tbody>{importMapped.slice(0,6).map((row,i)=>(<tr key={i}>{Object.values(row).map((v,j)=>(<td key={j} style={{ padding:"4px 7px", color:C.muted, borderBottom:`1px solid ${C.inner}`, whiteSpace:"nowrap" }}>{v}</td>))}</tr>))}</tbody></table>{importMapped.length>6&&<div style={{ color:C.dim, fontSize:10, marginTop:6 }}>…and {importMapped.length-6} more</div>}</div><div style={{ display:"flex", gap:8 }}><button style={mkBtn("primary")} onClick={importConfirm}>Import All</button><button style={mkBtn("ghost")} onClick={()=>setImportStep(1)}>Back</button></div></div>)}
          </div>
        )}

      </div>

      {toast&&<div style={{ position:"fixed", bottom:18, right:18, background:C.gold, color:C.bg, padding:"9px 16px", borderRadius:2, fontSize:12, letterSpacing:"0.05em", fontFamily:"Georgia, serif", boxShadow:"0 4px 14px #00000066", zIndex:999 }}>{toast}</div>}
    </div>
  );
}
