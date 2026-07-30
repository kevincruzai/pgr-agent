import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';

/* ══════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ══════════════════════════════════════════════════════════════ */

const API = '/api';
const STORAGE_TOKEN = 'pgr_token';
const STORAGE_USER = 'pgr_user';
const STORAGE_ADMIN_BACKUP = 'pgr_admin_backup'; // sesión del admin mientras usa "login como"

function formatBytes(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB']; const i=Math.min(u.length-1,Math.floor(Math.log(n)/Math.log(1024))); return (n/Math.pow(1024,i)).toFixed(i?1:0)+' '+u[i]; }

async function downloadAttachment(corrId, att){
  const token = localStorage.getItem(STORAGE_TOKEN);
  const res = await fetch(`${API}/correspondences/${corrId}/attachments/${att.id}/download`, { headers:{ Authorization:`Bearer ${token}` } });
  if(!res.ok){ alert('No se pudo descargar el adjunto'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = att.filename || 'adjunto';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const PRIORITY_COLORS = { baja:'#22c55e', media:'#f59e0b', alta:'#ef4444', urgente:'#dc2626' };
const PRIORITY_LABELS = { baja:'Baja', media:'Media', alta:'Alta', urgente:'Urgente' };
const STATUS_COLORS = { borrador:'#94a3b8', en_revision:'#f59e0b', aprobado:'#22c55e', en_proceso:'#3b82f6', adjudicado:'#8b5cf6', completado:'#10b981', cancelado:'#ef4444' };
const STATUS_LABELS = { borrador:'Borrador', en_revision:'En Revisión', aprobado:'Aprobado', en_proceso:'En Proceso', adjudicado:'Adjudicado', completado:'Completado', cancelado:'Cancelado' };

const AI_CAT_COLORS = { compras:'#3b82f6', revision:'#f59e0b', aprobacion:'#22c55e', alerta:'#ef4444', evaluacion:'#8b5cf6', legal:'#6366f1', proveedores:'#06b6d4', seguridad:'#dc2626' };

/* Fases del ciclo de compra pública (LCP Art. 1) según el estado del proyecto */
const LCP_PHASES = { borrador:'Planificación', en_revision:'Planificación', aprobado:'Selección del contratista', en_proceso:'Selección del contratista', adjudicado:'Contratación', completado:'Liquidación' };
const PAC_METHOD_LABELS = { licitacion_competitiva:'Licitación Competitiva', comparacion_precios:'Comparación de Precios', contratacion_directa:'Contratación Directa', consultoria:'Consultoría', convenio_marco:'Convenio Marco', subasta_inversa:'Subasta Inversa', baja_cuantia:'Baja Cuantía', libre_gestion:'Libre Gestión (LACAP)', licitacion_invitacion:'Lic. por Invitación (LACAP)', licitacion_publica:'Lic. Pública (LACAP)' };
const PAC_STATUS = { programado:{l:'Programado',c:'#94a3b8'}, en_proceso:{l:'En Proceso',c:'#f59e0b'}, contratado:{l:'Contratado',c:'#22c55e'}, desierto:{l:'Desierto',c:'#8b5cf6'}, cancelado:{l:'Cancelado',c:'#ef4444'} };
const MONTHS_ES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

async function apiFetch(path, opts={}){
  const token = localStorage.getItem(STORAGE_TOKEN);
  const headers = { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if(res.status===401){ localStorage.removeItem(STORAGE_TOKEN); localStorage.removeItem(STORAGE_USER); window.location.reload(); }
  return res.json();
}

function formatCurrency(n){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0); }
function formatDate(d){ if(!d) return '—'; return new Date(d).toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric'}); }
function daysUntil(d){ if(!d) return Infinity; return Math.ceil((new Date(d)-new Date())/(1000*60*60*24)); }
function timeAgo(d){ 
  if(!d) return ''; 
  const diff = Date.now()-new Date(d).getTime(); 
  const mins=Math.floor(diff/60000); 
  if(mins<60) return `hace ${mins}m`; 
  const hrs=Math.floor(mins/60); 
  if(hrs<24) return `hace ${hrs}h`; 
  const days=Math.floor(hrs/24); 
  return `hace ${days}d`; 
}

function Icon({name,size=20,color,style={}}){ return <span className="material-icons-round" style={{fontSize:size,color,verticalAlign:'middle',...style}}>{name}</span>; }

/* ══════════════════════════════════════════════════════════════
   LOGIN PAGE
   ══════════════════════════════════════════════════════════════ */

function LoginPage({ onLogin, goRegister }){
  const [docType,setDocType]=useState('DUI');
  const [docNum,setDocNum]=useState('');
  const [password,setPassword]=useState('');
  const [showPw,setShowPw]=useState(false);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  function formatDoc(val,type){
    const d=val.replace(/[^a-zA-Z0-9]/g,'');
    if(type==='DUI'){ if(d.length<=8) return d; return d.slice(0,8)+'-'+d.slice(8,9); }
    if(type==='Pasaporte') return d.slice(0,9).toUpperCase();
    return d.slice(0,9);
  }

  async function handleSubmit(e){
    e.preventDefault(); setError(''); setLoading(true);
    try{
      const res = await apiFetch('/auth/login',{method:'POST',body:JSON.stringify({document_type:docType,document_number:docNum,password})});
      if(res.success){ localStorage.setItem(STORAGE_TOKEN,res.token); localStorage.setItem(STORAGE_USER,JSON.stringify(res.user)); onLogin(res.user); }
      else setError(res.message||'Error al iniciar sesión');
    }catch{ setError('Error de conexión'); }
    setLoading(false);
  }

  return (
    <div style={styles.loginContainer}>
      <div style={styles.loginLeft}>
        <div style={styles.loginBrand}>
          <div style={styles.loginLogo}>
            <Icon name="account_balance" size={48} color="#fff"/>
          </div>
          <h1 style={styles.loginTitle}>PGR</h1>
          <p style={styles.loginSubtitle}>Procuraduría General de la República</p>
          <div style={styles.loginDivider}/>
          <h2 style={styles.loginSystemName}>Sistema de Compras Públicas</h2>
          <p style={styles.loginSystemDesc}>Unidad de Adquisiciones y Contrataciones Públicas · UACP</p>
          <div style={styles.loginFeatures}>
            {[
              ['mail','Gestión de Correspondencia con IA'],
              ['trending_up','Seguimiento de Proyectos'],
              ['notifications_active','Sistema de Alertas'],
              ['gavel','Ciclo de Compra LCP'],
            ].map(([icon,text])=>(
              <div key={icon} style={styles.loginFeatureItem}>
                <Icon name={icon} size={20} color="rgba(255,255,255,0.9)"/>
                <span style={{color:'rgba(255,255,255,0.85)',fontSize:14}}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={styles.loginRight}>
        <form onSubmit={handleSubmit} style={styles.loginForm}>
          <h2 style={styles.formTitle}>Iniciar Sesión</h2>
          <p style={styles.formSubtitle}>Ingresa tus credenciales institucionales</p>
          
          {error && <div style={styles.errorBox}><Icon name="error" size={18} color="#dc2626"/><span>{error}</span></div>}

          <label style={styles.label}>Tipo de Documento</label>
          <select value={docType} onChange={e=>setDocType(e.target.value)} style={styles.select}>
            <option value="DUI">DUI</option>
            <option value="Pasaporte">Pasaporte</option>
            <option value="Carnet de residente">Carnet de Residente</option>
          </select>

          <label style={styles.label}>Número de Documento</label>
          <div style={styles.inputGroup}>
            <Icon name="badge" size={20} color="#94a3b8" style={{position:'absolute',left:12,top:12}}/>
            <input type="text" placeholder={docType==='DUI'?'00000000-0':'Número de documento'} value={docNum}
              onChange={e=>setDocNum(formatDoc(e.target.value,docType))} style={{...styles.input,paddingLeft:40}} maxLength={docType==='DUI'?10:9}/>
          </div>

          <label style={styles.label}>Contraseña</label>
          <div style={styles.inputGroup}>
            <Icon name="lock" size={20} color="#94a3b8" style={{position:'absolute',left:12,top:12}}/>
            <input type={showPw?'text':'password'} placeholder="Ingresa tu contraseña" value={password}
              onChange={e=>setPassword(e.target.value)} style={{...styles.input,paddingLeft:40,paddingRight:40}}/>
            <button type="button" onClick={()=>setShowPw(!showPw)} style={styles.eyeBtn}>
              <Icon name={showPw?'visibility_off':'visibility'} size={20} color="#94a3b8"/>
            </button>
          </div>

          <button type="submit" disabled={loading} style={{...styles.submitBtn,...(loading?{opacity:0.7}:{})}}>
            {loading ? 'Verificando...' : 'Ingresar al Sistema'}
          </button>

          <button type="button" onClick={goRegister} style={styles.linkBtn}>
            ¿No tienes cuenta? <strong>Regístrate aquí</strong>
          </button>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   REGISTER PAGE
   ══════════════════════════════════════════════════════════════ */

function RegisterPage({ onRegister, goLogin }){
  const [form,setForm]=useState({name:'',docType:'DUI',docNum:'',email:'',password:'',confirm:''});
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  function upd(k,v){ setForm(p=>({...p,[k]:v})); }

  async function handleSubmit(e){
    e.preventDefault(); setError('');
    if(form.password.length<6) return setError('La contraseña debe tener al menos 6 caracteres');
    if(form.password!==form.confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    try{
      const res = await apiFetch('/auth/register',{method:'POST',body:JSON.stringify({name:form.name,document_type:form.docType,document_number:form.docNum,email:form.email,password:form.password})});
      if(res.success) onRegister();
      else setError(res.message||'Error al registrar');
    }catch{ setError('Error de conexión'); }
    setLoading(false);
  }

  return (
    <div style={styles.loginContainer}>
      <div style={styles.loginLeft}>
        <div style={styles.loginBrand}>
          <div style={styles.loginLogo}><Icon name="account_balance" size={48} color="#fff"/></div>
          <h1 style={styles.loginTitle}>PGR</h1>
          <p style={styles.loginSubtitle}>Registro de Usuario</p>
          <div style={styles.loginDivider}/>
          <p style={styles.loginSystemDesc}>Crea tu cuenta para acceder al sistema de Compras Públicas UACP</p>
        </div>
      </div>
      <div style={styles.loginRight}>
        <form onSubmit={handleSubmit} style={styles.loginForm}>
          <h2 style={styles.formTitle}>Crear Cuenta</h2>
          {error && <div style={styles.errorBox}><Icon name="error" size={18} color="#dc2626"/><span>{error}</span></div>}
          
          <label style={styles.label}>Nombre Completo</label>
          <input style={styles.input} placeholder="Nombre completo" value={form.name} onChange={e=>upd('name',e.target.value)} required/>

          <label style={styles.label}>Tipo de Documento</label>
          <select value={form.docType} onChange={e=>upd('docType',e.target.value)} style={styles.select}>
            <option value="DUI">DUI</option><option value="Pasaporte">Pasaporte</option>
          </select>

          <label style={styles.label}>Número de Documento</label>
          <input style={styles.input} placeholder="Número de documento" value={form.docNum} onChange={e=>upd('docNum',e.target.value)} required/>

          <label style={styles.label}>Correo Electrónico</label>
          <input style={styles.input} type="email" placeholder="correo@pgr.gob.sv" value={form.email} onChange={e=>upd('email',e.target.value)}/>

          <label style={styles.label}>Contraseña</label>
          <input style={styles.input} type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={e=>upd('password',e.target.value)} required/>

          <label style={styles.label}>Confirmar Contraseña</label>
          <input style={styles.input} type="password" placeholder="Repite tu contraseña" value={form.confirm} onChange={e=>upd('confirm',e.target.value)} required/>

          <button type="submit" disabled={loading} style={styles.submitBtn}>{loading?'Registrando...':'Crear Cuenta'}</button>
          <button type="button" onClick={goLogin} style={styles.linkBtn}>¿Ya tienes cuenta? <strong>Inicia sesión</strong></button>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SIDEBAR COMPONENT
   ══════════════════════════════════════════════════════════════ */

function Sidebar({ activeTab, setActiveTab, unreadCount, alertCount, collapsed, setCollapsed, userRole }){
  const tabs = [
    { id:'dashboard', icon:'dashboard', label:'Dashboard' },
    { id:'inbox', icon:'inbox', label:'Bandeja de Entrada', badge:unreadCount },
    { id:'starred', icon:'star', label:'Destacados' },
    { id:'projects', icon:'folder_open', label:'Proyectos' },
    { id:'procurement', icon:'gavel', label:'Procesos de Compra (LCP)' },
    { id:'pac', icon:'event_note', label:'PAC' },
    { id:'alerts', icon:'notifications', label:'Alertas', badge:alertCount },
    { id:'units', icon:'business', label:'Unidades' },
    { id:'email_config', icon:'mail_lock', label:'Correo Electrónico' },
    ...((userRole==='admin'||userRole==='jefe_uacp')?[
      { id:'users_admin', icon:'people', label:'Usuarios' },
      { id:'settings', icon:'settings', label:'Configuración' },
    ]:[]),
  ];

  return (
    <div style={{...styles.sidebar,...(collapsed?{width:64}:{})}}>
      <div style={styles.sidebarHeader}>
        <button onClick={()=>setCollapsed(!collapsed)} style={styles.menuBtn}>
          <Icon name="menu" size={24} color="#64748b"/>
        </button>
        {!collapsed && <span style={styles.sidebarTitle}>UACP</span>}
      </div>

      {!collapsed && (
        <button style={styles.composeBtn} onClick={()=>setActiveTab('compose')}>
          <Icon name="edit" size={20} color="#fff"/><span style={{marginLeft:8}}>Redactar</span>
        </button>
      )}

      <nav style={styles.sidebarNav}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)}
            style={{...styles.navItem,...(activeTab===t.id?styles.navItemActive:{})}}>
            <Icon name={t.icon} size={22} color={activeTab===t.id?'#1e40af':'#64748b'}/>
            {!collapsed && (
              <>
                <span style={{flex:1,textAlign:'left',marginLeft:12,fontSize:14,fontWeight:activeTab===t.id?600:400,color:activeTab===t.id?'#1e293b':'#475569'}}>{t.label}</span>
                {t.badge>0 && <span style={styles.badge}>{t.badge}</span>}
              </>
            )}
          </button>
        ))}
      </nav>

      {!collapsed && (
        <div style={styles.sidebarFooter}>
          <div style={{fontSize:11,color:'#94a3b8',textAlign:'center'}}>
            <Icon name="account_balance" size={14} color="#94a3b8"/> PGR · UACP<br/>Compras Públicas v1.0
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   AI TYPEWRITER HOOK
   ══════════════════════════════════════════════════════════════ */

function useTypewriter(texts, speed=18){
  const [displayedLines,setDisplayedLines]=useState([]);
  const [currentLine,setCurrentLine]=useState(0);
  const [currentChar,setCurrentChar]=useState(0);
  const [done,setDone]=useState(false);
  const timerRef=useRef(null);

  useEffect(()=>{
    if(!texts||texts.length===0){ setDone(true); return; }
    setDisplayedLines([]); setCurrentLine(0); setCurrentChar(0); setDone(false);
  },[texts]);

  useEffect(()=>{
    if(!texts||texts.length===0||done) return;
    if(currentLine>=texts.length){ setDone(true); return; }
    const line=texts[currentLine];
    if(currentChar<=line.length){
      timerRef.current=setTimeout(()=>{
        setDisplayedLines(prev=>{
          const copy=[...prev];
          copy[currentLine]=line.slice(0,currentChar);
          return copy;
        });
        setCurrentChar(c=>c+1);
      },speed);
    } else {
      setCurrentLine(l=>l+1);
      setCurrentChar(0);
    }
    return ()=>clearTimeout(timerRef.current);
  },[texts,currentLine,currentChar,done,speed]);

  return { displayedLines, done };
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ══════════════════════════════════════════════════════════════ */

function DashboardView({ stats }){
  const [aiInsights,setAiInsights]=useState([]);
  const [aiLoading,setAiLoading]=useState(false);
  const [aiSource,setAiSource]=useState('');
  const [aiRan,setAiRan]=useState(false);
  const [budget,setBudget]=useState(null);
  const { displayedLines, done } = useTypewriter(aiInsights, 12);

  useEffect(()=>{
    (async()=>{
      const bRes = await apiFetch('/dashboard/budget-compliance');
      if(bRes.success) setBudget(bRes.data);
    })();
  },[]);

  // El análisis IA se ejecuta SOLO bajo demanda (botón), nunca por defecto.
  const runAnalysis = async()=>{
    setAiLoading(true); setAiRan(true);
    const res = await apiFetch('/dashboard/ai-insights');
    if(res.success){ setAiInsights(res.data); setAiSource(res.source||'rules'); }
    else setAiInsights([]);
    setAiLoading(false);
  };

  const cards = [
    { icon:'folder_open', label:'Proyectos Activos', value:stats.totalProjects||0, color:'#3b82f6', bg:'#eff6ff' },
    { icon:'mail', label:'Correos sin Leer', value:stats.unreadCorrespondences||0, color:'#f59e0b', bg:'#fffbeb' },
    { icon:'gavel', label:'Procesos LCP', value:stats.totalRequests||0, color:'#8b5cf6', bg:'#f5f3ff' },
    { icon:'warning', label:'Alertas Urgentes', value:stats.urgentAlerts||0, color:'#ef4444', bg:'#fef2f2' },
  ];

  return (
    <div style={{padding:0}}>
      {/* KPI Cards */}
      <div style={styles.kpiGrid}>
        {cards.map(c=>(
          <div key={c.label} style={{...styles.kpiCard,borderLeft:`4px solid ${c.color}`}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:48,height:48,borderRadius:12,background:c.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Icon name={c.icon} size={24} color={c.color}/>
              </div>
              <div>
                <div style={{fontSize:28,fontWeight:800,color:'#0f172a',lineHeight:1}}>{c.value}</div>
                <div style={{fontSize:13,color:'#64748b',marginTop:2}}>{c.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Insights Panel */}
      <div style={{...styles.card,marginBottom:16,background:'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)',border:'1px solid #334155'}}>
        <div style={styles.cardHeader}>
          <div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Icon name="psychology" size={20} color="#fff"/>
          </div>
          <h3 style={{...styles.cardTitle,color:'#f1f5f9'}}>Observaciones Inteligentes</h3>
          {aiRan && !aiLoading && aiSource==='gemini' && <span style={{...styles.tagTiny,background:'linear-gradient(135deg,#3b82f6,#8b5cf6)'}}>Generado por Gemini</span>}
          {aiRan && !aiLoading && aiSource==='rules' && <span style={{...styles.tagTiny,background:'#64748b'}} title="Active Gemini en Configuración → Gemini Pro API para análisis con IA real">Análisis por reglas</span>}
          {aiRan && !aiLoading && done && <span style={{fontSize:11,color:'#22c55e',fontWeight:600}}>Análisis completo</span>}
          <button onClick={runAnalysis} disabled={aiLoading} style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:9,border:'1px solid rgba(255,255,255,0.15)',cursor:aiLoading?'default':'pointer',color:'#fff',fontSize:13,fontWeight:700,background:aiLoading?'#475569':'linear-gradient(135deg,#3b82f6,#8b5cf6)',opacity:aiLoading?0.7:1}}>
            <Icon name={aiLoading?'hourglass_top':'auto_awesome'} size={16} color="#fff"/>
            {aiLoading?'Analizando...':(aiRan?'Re-analizar':'Analizar con IA')}
          </button>
        </div>
        {aiLoading ? (
          <div style={{textAlign:'center',padding:20}}><Icon name="hourglass_top" size={28} color="#60a5fa"/><p style={{color:'#94a3b8',fontSize:13,marginTop:8}}>Analizando el portafolio con IA...</p></div>
        ) : !aiRan ? (
          <div style={{textAlign:'center',padding:'24px 20px'}}>
            <Icon name="insights" size={30} color="#60a5fa"/>
            <p style={{color:'#94a3b8',fontSize:13,marginTop:8,maxWidth:540,marginLeft:'auto',marginRight:'auto',lineHeight:1.6}}>Pulse <strong style={{color:'#e2e8f0'}}>Analizar con IA</strong> para generar observaciones reales del portafolio (proyectos, presupuesto, vencimientos y correspondencia) bajo demanda.</p>
          </div>
        ) : aiInsights.length===0 ? (
          <div style={{textAlign:'center',padding:20}}><p style={{color:'#94a3b8',fontSize:13}}>No se generaron observaciones. Intente nuevamente.</p></div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {displayedLines.map((line,i)=>(
              <div key={i} style={{padding:'10px 14px',borderRadius:10,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',fontSize:13,color:'#e2e8f0',lineHeight:1.6}}>
                {line}
                {i===displayedLines.length-1 && !done && <span style={{display:'inline-block',width:8,height:16,background:'#60a5fa',marginLeft:2,animation:'blink 0.8s infinite',verticalAlign:'middle'}}/>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cumplimiento del presupuesto anual de compras */}
      {budget?.configured&&(
        <div style={{...styles.card,marginBottom:16,border:budget.over_budget?'2px solid #ef4444':undefined}}>
          <div style={styles.cardHeader}>
            <Icon name="account_balance" size={22} color={budget.over_budget?'#ef4444':'#059669'}/>
            <h3 style={styles.cardTitle}>Presupuesto Anual de Compras {budget.year}</h3>
            <span style={{...styles.tagSmall,background:budget.over_budget?'#ef4444':budget.percent_committed>=90?'#f59e0b':'#22c55e',marginLeft:'auto'}}>
              {budget.over_budget?'⚠ PRESUPUESTO EXCEDIDO':`${budget.percent_committed}% comprometido`}
            </span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginTop:12}}>
            <div><div style={{fontSize:12,color:'#64748b'}}>Presupuestado</div><div style={{fontSize:20,fontWeight:800,color:'#0f172a'}}>{formatCurrency(budget.budget)}</div></div>
            <div><div style={{fontSize:12,color:'#64748b'}}>Comprometido ({budget.committed_count} proy.)</div><div style={{fontSize:20,fontWeight:800,color:budget.over_budget?'#ef4444':'#3b82f6'}}>{formatCurrency(budget.committed)}</div></div>
            <div><div style={{fontSize:12,color:'#64748b'}}>Ejecutado ({budget.executed_count} completados)</div><div style={{fontSize:20,fontWeight:800,color:'#059669'}}>{formatCurrency(budget.executed)}</div></div>
            <div><div style={{fontSize:12,color:'#64748b'}}>Disponible</div><div style={{fontSize:20,fontWeight:800,color:budget.available<0?'#ef4444':'#0f172a'}}>{formatCurrency(budget.available)}</div></div>
          </div>
          {/* Barra de progreso */}
          <div style={{marginTop:14,height:14,borderRadius:7,background:'#f1f5f9',overflow:'hidden',position:'relative'}}>
            <div style={{position:'absolute',inset:0,width:`${Math.min(100,budget.percent_committed)}%`,borderRadius:7,
              background:budget.over_budget?'linear-gradient(90deg,#ef4444,#dc2626)':budget.percent_committed>=90?'linear-gradient(90deg,#f59e0b,#f97316)':'linear-gradient(90deg,#22c55e,#3b82f6)',transition:'width 0.6s'}}/>
          </div>
          {budget.over_budget&&(
            <p style={{fontSize:13,color:'#991b1b',margin:'10px 0 0',fontWeight:600}}>
              ⚠ Los proyectos comprometidos superan el presupuesto anual por {formatCurrency(Math.abs(budget.available))}. Revise la cartera en Configuración → Seguimiento de Proyectos.
            </p>
          )}
          {budget.byCategory?.length>0&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
              {budget.byCategory.map(c=>(
                <span key={c.name} style={{fontSize:12,padding:'4px 10px',borderRadius:8,background:'#f8fafc',border:`1px solid ${c.color||'#e2e8f0'}`,color:'#475569'}}>
                  <strong style={{color:c.color||'#334155'}}>{c.name}</strong>: {formatCurrency(c.total)} ({c.count})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Two column layout */}
      <div style={styles.dashGrid}>
        {/* Upcoming Deadlines */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <Icon name="schedule" size={22} color="#f59e0b"/>
            <h3 style={styles.cardTitle}>Próximos Vencimientos</h3>
          </div>
          {(stats.upcomingDeadlines||[]).length===0 ? <p style={{color:'#94a3b8',textAlign:'center',padding:20}}>Sin vencimientos próximos</p> :
            (stats.upcomingDeadlines||[]).map(p=>{
              const days=daysUntil(p.deadline);
              const urgency = days<=3?'#ef4444':days<=7?'#f59e0b':'#22c55e';
              return (
                <div key={p.id} style={styles.deadlineItem}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:'#1e293b'}}>{p.title}</div>
                    <div style={{display:'flex',gap:8,marginTop:4,alignItems:'center'}}>
                      <span style={{...styles.tagSmall,background:p.category_color||'#94a3b8'}}>{p.category_name||'Sin categoría'}</span>
                      <span style={{fontSize:12,color:'#64748b'}}>{formatDate(p.deadline)}</span>
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:20,fontWeight:800,color:urgency}}>{days}</div>
                    <div style={{fontSize:11,color:urgency}}>días</div>
                  </div>
                </div>
              );
            })
          }
        </div>

        {/* Recent Projects */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <Icon name="trending_up" size={22} color="#3b82f6"/>
            <h3 style={styles.cardTitle}>Proyectos Recientes</h3>
          </div>
          {(stats.recentProjects||[]).map(p=>(
            <div key={p.id} style={styles.projectItem}>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,color:'#1e293b'}}>{p.title}</div>
                <div style={{display:'flex',gap:8,marginTop:4,flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{...styles.tagSmall,background:STATUS_COLORS[p.status]||'#94a3b8'}}>{STATUS_LABELS[p.status]||p.status}</span>
                  <span style={{...styles.tagSmall,background:p.category_color||'#94a3b8'}}>{p.category_name||'—'}</span>
                  <span style={{fontSize:12,color:'#64748b'}}>{p.unit_name||''}</span>
                </div>
              </div>
              <div style={{textAlign:'right',fontSize:13,color:'#64748b'}}>
                {formatCurrency(p.budget_estimated)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Categories overview */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <Icon name="category" size={22} color="#8b5cf6"/>
          <h3 style={styles.cardTitle}>Proyectos por Categoría</h3>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:12,padding:'8px 0'}}>
          {(stats.projectsByCategory||[]).map(c=>(
            <div key={c.name} style={{...styles.catChip,borderColor:c.color}}>
              <div style={{width:10,height:10,borderRadius:'50%',background:c.color}}/>
              <span style={{fontSize:13,fontWeight:600,color:'#1e293b'}}>{c.name}</span>
              <span style={{fontSize:13,color:'#64748b'}}>({c.count})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   INBOX VIEW (Gmail-like with Project Threading)
   ══════════════════════════════════════════════════════════════ */

function InboxView({ starred }){
  const [emails,setEmails]=useState([]);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [viewMode,setViewMode]=useState('inbox'); // inbox | threads
  const [threads,setThreads]=useState([]);
  const [ungrouped,setUngrouped]=useState([]);
  const [expandedThread,setExpandedThread]=useState(null);
  const [threadAnalysis,setThreadAnalysis]=useState({}); // {project_id: {loading, data, error}}
  const [attachments,setAttachments]=useState([]);
  const [page,setPage]=useState(1);
  const [pageInfo,setPageInfo]=useState({total:0,totalPages:1,pageSize:25});

  async function analyzeThreadAI(projectId,e){
    e.stopPropagation();
    setThreadAnalysis(p=>({...p,[projectId]:{loading:true}}));
    const res = await apiFetch(`/correspondences/by-project/${projectId}/analyze`,{method:'POST'});
    setThreadAnalysis(p=>({...p,[projectId]:res.success?{data:res.data}:{error:res.message||'Error al analizar'}}));
  }

  const loadInbox = useCallback(async ()=>{
    setLoading(true);
    const qs = new URLSearchParams();
    if(starred) qs.set('is_starred','1');
    if(search) qs.set('search',search);
    qs.set('page',String(page));
    qs.set('pageSize','25');
    const res = await apiFetch(`/correspondences?${qs.toString()}`);
    if(res.success){ setEmails(res.data); setPageInfo({total:res.total||0,totalPages:res.totalPages||1,pageSize:res.pageSize||25}); }
    setLoading(false);
  },[starred,search,page]);

  // Volver a la página 1 al cambiar la búsqueda o el filtro de destacados.
  useEffect(()=>{ setPage(1); },[search,starred]);

  const loadThreads = useCallback(async ()=>{
    setLoading(true);
    const res = await apiFetch('/correspondences/by-project');
    if(res.success){setThreads(res.data.threads||[]);setUngrouped(res.data.ungrouped||[]);}
    setLoading(false);
  },[]);

  useEffect(()=>{
    if(viewMode==='inbox') loadInbox();
    else loadThreads();
  },[viewMode,loadInbox,loadThreads]);

  async function toggleStar(id,e){
    e.stopPropagation();
    await apiFetch(`/correspondences/${id}/star`,{method:'PUT'});
    if(viewMode==='inbox') loadInbox(); else loadThreads();
  }

  async function archiveEmail(id,e){
    e.stopPropagation();
    await apiFetch(`/correspondences/${id}/archive`,{method:'PUT'});
    if(viewMode==='inbox') loadInbox(); else loadThreads();
  }

  async function openEmail(email){
    if(!email.is_read) await apiFetch(`/correspondences/${email.id}/read`,{method:'PUT'});
    setSelected(email);
    setAttachments([]);
    const res = await apiFetch(`/correspondences/${email.id}/attachments`);
    if(res.success) setAttachments(res.data||[]);
  }

  /* ── Email Detail ── */
  if(selected){
    return (
      <div style={{padding:0}}>
        <button onClick={()=>{setSelected(null);if(viewMode==='inbox')loadInbox();else loadThreads();}} style={styles.backBtn}>
          <Icon name="arrow_back" size={20}/><span>Volver a bandeja</span>
        </button>
        <div style={{...styles.card,marginTop:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <h2 style={{fontSize:20,fontWeight:700,color:'#0f172a',margin:0}}>{selected.subject}</h2>
            <div style={{display:'flex',gap:8}}>
              {selected.ai_priority && <span style={{...styles.tagSmall,background:PRIORITY_COLORS[selected.ai_priority]||'#94a3b8'}}>{PRIORITY_LABELS[selected.ai_priority]||selected.ai_priority}</span>}
              {selected.ai_category && <span style={{...styles.tagSmall,background:AI_CAT_COLORS[selected.ai_category]||'#64748b'}}>{selected.ai_category}</span>}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,padding:'12px 0',borderBottom:'1px solid #e2e8f0'}}>
            <div style={{width:40,height:40,borderRadius:'50%',background:'#3b82f6',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:16}}>
              {(selected.from_name||'?')[0]}
            </div>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{selected.from_name||'Sistema'}</div>
              <div style={{fontSize:12,color:'#64748b'}}>{timeAgo(selected.created_at)} · {selected.project_title ? `Proyecto: ${selected.project_title}` : 'Sin proyecto asociado'}</div>
            </div>
          </div>
          {selected.ai_summary && (
            <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8,padding:12,marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}><Icon name="psychology" size={16} color="#0284c7"/><span style={{fontSize:12,fontWeight:600,color:'#0284c7'}}>Resumen IA</span></div>
              <p style={{fontSize:13,color:'#0369a1',margin:0}}>{selected.ai_summary}</p>
            </div>
          )}
          <div style={{fontSize:15,color:'#334155',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{selected.body}</div>
          {attachments.length>0&&(
            <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
                <Icon name="attach_file" size={18} color="#64748b"/>
                <span style={{fontSize:13,fontWeight:700,color:'#334155'}}>{attachments.length} documento(s) adjunto(s)</span>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
                {attachments.map(a=>(
                  <button key={a.id} onClick={()=>downloadAttachment(selected.id,a)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderRadius:10,border:'1px solid #e2e8f0',background:'#f8fafc',cursor:'pointer'}}>
                    <Icon name={a.content_type?.includes('pdf')?'picture_as_pdf':a.content_type?.startsWith('image/')?'image':'description'} size={20}
                      color={a.content_type?.includes('pdf')?'#ef4444':a.content_type?.startsWith('image/')?'#8b5cf6':'#3b82f6'}/>
                    <div style={{textAlign:'left'}}>
                      <div style={{fontSize:13,fontWeight:600,color:'#0f172a',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.filename}</div>
                      <div style={{fontSize:11,color:'#94a3b8'}}>{formatBytes(a.size_bytes)}</div>
                    </div>
                    <Icon name="download" size={16} color="#64748b"/>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{padding:0}}>
      {/* Mode Tabs + Search */}
      <div style={{display:'flex',gap:12,marginBottom:12,alignItems:'center'}}>
        <div style={{display:'flex',background:'#f1f5f9',borderRadius:10,padding:3,flexShrink:0}}>
          <button onClick={()=>setViewMode('inbox')} style={{padding:'8px 16px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
            background:viewMode==='inbox'?'#fff':'transparent',color:viewMode==='inbox'?'#0f172a':'#64748b',
            boxShadow:viewMode==='inbox'?'0 1px 3px rgba(0,0,0,0.1)':'none',display:'flex',alignItems:'center',gap:6}}>
            <Icon name="inbox" size={18} color={viewMode==='inbox'?'#3b82f6':'#94a3b8'}/>Bandeja
          </button>
          <button onClick={()=>setViewMode('threads')} style={{padding:'8px 16px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
            background:viewMode==='threads'?'#fff':'transparent',color:viewMode==='threads'?'#0f172a':'#64748b',
            boxShadow:viewMode==='threads'?'0 1px 3px rgba(0,0,0,0.1)':'none',display:'flex',alignItems:'center',gap:6}}>
            <Icon name="account_tree" size={18} color={viewMode==='threads'?'#8b5cf6':'#94a3b8'}/>Seguimiento por Proyecto
          </button>
        </div>
        {viewMode==='inbox'&&<div style={{...styles.searchBar,flex:1,marginBottom:0}}>
          <Icon name="search" size={22} color="#94a3b8"/>
          <input style={styles.searchInput} placeholder="Buscar en correspondencia..." value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadInbox()}/>
          {search&&<button onClick={()=>setSearch('')} style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="close" size={20} color="#94a3b8"/></button>}
        </div>}
      </div>

      {loading?<div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando...</p></div>:

      /* ── Thread View ── */
      viewMode==='threads'?(
        <div>
          {/* AI grouping header */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,padding:'12px 16px',background:'linear-gradient(135deg,#0f172a,#1e293b)',borderRadius:12}}>
            <Icon name="psychology" size={22} color="#60a5fa"/>
            <span style={{fontSize:14,fontWeight:600,color:'#f1f5f9'}}>Agrupación Inteligente por Proyecto</span>
            <span style={{fontSize:12,color:'#94a3b8',marginLeft:8}}>Gemini Pro analizó el contexto de {threads.reduce((a,t)=>a+t.messages.length,0)+ungrouped.length} correos → {threads.length} cadenas identificadas</span>
          </div>

          {threads.length===0&&ungrouped.length===0?
            <div style={styles.loading}><Icon name="inbox" size={48} color="#cbd5e1"/><p style={{color:'#94a3b8'}}>No hay correos</p></div>:
          <>
            {/* Project threads */}
            {threads.map(thread=>{
              const isExpanded=expandedThread===thread.project_id;
              return (
                <div key={thread.project_id} style={{marginBottom:12}}>
                  {/* Thread header */}
                  <div onClick={()=>setExpandedThread(isExpanded?null:thread.project_id)}
                    style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'#fff',borderRadius:isExpanded?'14px 14px 0 0':'14px',border:'1px solid #e2e8f0',
                      cursor:'pointer',transition:'all 0.2s',borderBottom:isExpanded?'none':'1px solid #e2e8f0'}}>
                    <div style={{width:40,height:40,borderRadius:12,background:thread.category_color||'#3b82f6',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <Icon name="folder" size={22} color="#fff"/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                        <span style={{fontSize:15,fontWeight:700,color:'#0f172a'}}>{thread.project_title||'Proyecto sin título'}</span>
                        <span style={{...styles.tagTiny,background:STATUS_COLORS[thread.project_status]||'#94a3b8'}}>{STATUS_LABELS[thread.project_status]||thread.project_status}</span>
                        {thread.category_name&&<span style={{...styles.tagTiny,background:thread.category_color||'#64748b'}}>{thread.category_name}</span>}
                      </div>
                      <div style={{fontSize:12,color:'#64748b'}}>{thread.messages.length} correo{thread.messages.length!==1?'s':''} en esta cadena · Último: {timeAgo(thread.latest_at)}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      {thread.unread_count>0&&<span style={styles.badge}>{thread.unread_count}</span>}
                      <div style={{display:'flex'}}>
                        {thread.messages.slice(0,3).map((m,i)=>(
                          <div key={m.id} style={{width:24,height:24,borderRadius:'50%',background:AI_CAT_COLORS[m.ai_category]||'#64748b',border:'2px solid #fff',marginLeft:i>0?-8:0,
                            display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:10,fontWeight:700,zIndex:3-i}}>
                            {(m.from_name||'?')[0]}
                          </div>
                        ))}
                      </div>
                      <Icon name={isExpanded?'expand_less':'expand_more'} size={24} color="#94a3b8"/>
                    </div>
                  </div>

                  {/* Expanded thread messages (tree) */}
                  {isExpanded&&(
                    <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderTop:'none',borderRadius:'0 0 14px 14px',padding:'8px 0'}}>
                      <div style={{position:'relative',padding:'0 16px 0 40px'}}>
                        {/* Tree trunk */}
                        <div style={{position:'absolute',left:31,top:0,bottom:12,width:2,background:'linear-gradient(to bottom, '+( thread.category_color||'#3b82f6')+', #e2e8f0)'}}/>

                        {thread.messages.map((msg,mi)=>(
                          <div key={msg.id} style={{position:'relative',padding:'10px 0'}}>
                            {/* Branch node */}
                            <div style={{position:'absolute',left:-21,top:14,width:16,height:16,borderRadius:'50%',
                              background:msg.is_read?'#e2e8f0':AI_CAT_COLORS[msg.ai_category]||'#3b82f6',
                              border:msg.is_read?'2px solid #cbd5e1':`2px solid ${AI_CAT_COLORS[msg.ai_category]||'#3b82f6'}`,
                              display:'flex',alignItems:'center',justifyContent:'center',zIndex:2}}>
                              <Icon name="mail" size={8} color={msg.is_read?'#94a3b8':'#fff'}/>
                            </div>
                            {/* Branch line */}
                            <div style={{position:'absolute',left:-5,top:21,width:14,height:2,background:msg.is_read?'#e2e8f0':'#cbd5e1'}}/>

                            <div onClick={()=>openEmail(msg)}
                              style={{marginLeft:4,padding:'12px 16px',background:msg.is_read?'#fff':'#f0f9ff',borderRadius:10,
                                border:`1px solid ${msg.is_read?'#e2e8f0':'#bae6fd'}`,cursor:'pointer',transition:'all 0.15s'}}>
                              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                  <div style={{width:28,height:28,borderRadius:'50%',background:AI_CAT_COLORS[msg.ai_category]||'#64748b',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:11}}>
                                    {(msg.from_name||'?')[0]}
                                  </div>
                                  <span style={{fontSize:13,fontWeight:msg.is_read?400:700,color:'#0f172a'}}>{msg.from_name||'Sistema'}</span>
                                  {msg.ai_category&&<span style={{...styles.tagTiny,background:AI_CAT_COLORS[msg.ai_category]||'#94a3b8'}}>{msg.ai_category}</span>}
                                  {msg.ai_priority==='urgente'&&<span style={{...styles.tagTiny,background:'#dc2626'}}>URGENTE</span>}
                                </div>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                  <span style={{fontSize:11,color:'#94a3b8'}}>{timeAgo(msg.created_at)}</span>
                                  <button onClick={e=>toggleStar(msg.id,e)} style={{background:'none',border:'none',cursor:'pointer',padding:2}}>
                                    <Icon name={msg.is_starred?'star':'star_outline'} size={18} color={msg.is_starred?'#f59e0b':'#cbd5e1'}/>
                                  </button>
                                </div>
                              </div>
                              <div style={{fontSize:14,fontWeight:msg.is_read?400:600,color:'#1e293b',marginTop:4}}>{msg.subject}</div>
                              {msg.ai_summary&&<div style={{fontSize:12,color:'#64748b',marginTop:2,fontStyle:'italic'}}><Icon name="psychology" size={12} color="#94a3b8"/> {msg.ai_summary}</div>}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* AI analysis footer — análisis real con Gemini */}
                      <div style={{margin:'8px 16px 8px',padding:'10px 14px',background:'linear-gradient(135deg,rgba(59,130,246,0.05),rgba(139,92,246,0.05))',borderRadius:10,border:'1px solid rgba(59,130,246,0.15)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <Icon name="auto_awesome" size={16} color="#3b82f6"/>
                          <span style={{fontSize:12,fontWeight:600,color:'#3b82f6'}}>Análisis IA de la cadena</span>
                          <button onClick={e=>analyzeThreadAI(thread.project_id,e)} disabled={threadAnalysis[thread.project_id]?.loading}
                            style={{marginLeft:'auto',padding:'4px 12px',borderRadius:8,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,color:'#fff',
                              background:threadAnalysis[thread.project_id]?.loading?'#94a3b8':'linear-gradient(135deg,#3b82f6,#8b5cf6)'}}>
                            {threadAnalysis[thread.project_id]?.loading?'Analizando...':threadAnalysis[thread.project_id]?.data?'Re-analizar':'Analizar con Gemini'}
                          </button>
                        </div>
                        {threadAnalysis[thread.project_id]?.error&&(
                          <p style={{fontSize:12,color:'#dc2626',margin:'6px 0 0'}}>{threadAnalysis[thread.project_id].error}</p>
                        )}
                        {threadAnalysis[thread.project_id]?.data?(
                          <div style={{marginTop:8}}>
                            <p style={{fontSize:12,color:'#334155',margin:'0 0 6px',lineHeight:1.5}}>{threadAnalysis[thread.project_id].data.summary}</p>
                            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                              <span style={{...styles.tagTiny,background:{bajo:'#22c55e',medio:'#f59e0b',alto:'#ef4444'}[threadAnalysis[thread.project_id].data.risk_level]||'#94a3b8'}}>
                                RIESGO {(threadAnalysis[thread.project_id].data.risk_level||'').toUpperCase()}
                              </span>
                              <span style={{fontSize:12,color:'#475569'}}>{threadAnalysis[thread.project_id].data.current_state}</span>
                              {threadAnalysis[thread.project_id].data.attachments_analyzed>0&&(
                                <span style={{...styles.tagTiny,background:'#8b5cf6'}}>📎 {threadAnalysis[thread.project_id].data.attachments_analyzed} documento(s) analizados</span>
                              )}
                            </div>
                            {/* Estado del proyecto sugerido por la evidencia del correo */}
                            {threadAnalysis[thread.project_id].data.suggested_status&&(
                              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 10px',borderRadius:8,marginBottom:6,
                                background:threadAnalysis[thread.project_id].data.suggested_status!==thread.project_status?'#fffbeb':'#f0fdf4',
                                border:`1px solid ${threadAnalysis[thread.project_id].data.suggested_status!==thread.project_status?'#fcd34d':'#86efac'}`}}>
                                <Icon name="auto_fix_high" size={14} color="#7c3aed"/>
                                <span style={{fontSize:12,color:'#334155'}}>Estado según la evidencia del correo:</span>
                                <span style={{...styles.tagTiny,background:STATUS_COLORS[threadAnalysis[thread.project_id].data.suggested_status]||'#94a3b8'}}>
                                  {STATUS_LABELS[threadAnalysis[thread.project_id].data.suggested_status]||threadAnalysis[thread.project_id].data.suggested_status}
                                </span>
                                {threadAnalysis[thread.project_id].data.suggested_status!==thread.project_status?(
                                  <button onClick={async e=>{e.stopPropagation();
                                    await apiFetch(`/projects/${thread.project_id}/status`,{method:'PUT',body:JSON.stringify({status:threadAnalysis[thread.project_id].data.suggested_status})});
                                    loadThreads();}}
                                    style={{padding:'3px 10px',borderRadius:6,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,color:'#fff',background:'#7c3aed'}}>
                                    Aplicar al proyecto
                                  </button>
                                ):(
                                  <span style={{fontSize:11,color:'#16a34a',fontWeight:600}}>✓ coincide con el registrado</span>
                                )}
                                <span style={{fontSize:11,color:'#64748b',width:'100%'}}>{threadAnalysis[thread.project_id].data.suggested_status_reason}</span>
                              </div>
                            )}
                            {(threadAnalysis[thread.project_id].data.documents_findings||[]).length>0&&(
                              <div style={{marginBottom:6}}>
                                <span style={{fontSize:11,fontWeight:700,color:'#7c3aed'}}>Hallazgos en documentos adjuntos:</span>
                                <ul style={{fontSize:12,color:'#475569',margin:'2px 0 0',paddingLeft:18,lineHeight:1.6}}>
                                  {threadAnalysis[thread.project_id].data.documents_findings.map((f,i)=><li key={i}>{f}</li>)}
                                </ul>
                              </div>
                            )}
                            {(threadAnalysis[thread.project_id].data.pending_actions||[]).length>0&&(
                              <ul style={{fontSize:12,color:'#475569',margin:0,paddingLeft:18,lineHeight:1.6}}>
                                {threadAnalysis[thread.project_id].data.pending_actions.map((a,i)=><li key={i}>{a}</li>)}
                              </ul>
                            )}
                          </div>
                        ):(
                          <p style={{fontSize:12,color:'#475569',margin:'4px 0 0',lineHeight:1.5}}>
                            {thread.messages.length} documento(s) en la cadena · Categorías: {[...new Set(thread.messages.map(m=>m.ai_category).filter(Boolean))].join(', ')||'pendiente'} ·
                            {thread.unread_count>0?` ${thread.unread_count} pendiente(s) de revisión`:' Todos revisados ✓'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ungrouped emails */}
            {ungrouped.length>0&&(
              <div style={{marginTop:16}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,paddingLeft:4}}>
                  <Icon name="help_outline" size={18} color="#94a3b8"/>
                  <span style={{fontSize:13,fontWeight:600,color:'#64748b'}}>Sin proyecto asignado ({ungrouped.length})</span>
                </div>
                <div style={styles.emailList}>
                  {ungrouped.map(email=>(
                    <div key={email.id} onClick={()=>openEmail(email)} style={{...styles.emailRow,...(!email.is_read?styles.emailUnread:{})}}>
                      <button onClick={e=>toggleStar(email.id,e)} style={{background:'none',border:'none',cursor:'pointer',padding:4}}>
                        <Icon name={email.is_starred?'star':'star_outline'} size={22} color={email.is_starred?'#f59e0b':'#cbd5e1'}/>
                      </button>
                      <div style={{width:36,height:36,borderRadius:'50%',background:AI_CAT_COLORS[email.ai_category]||'#64748b',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:14,flexShrink:0}}>
                        {(email.from_name||'?')[0]}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                          <span style={{fontSize:13,fontWeight:email.is_read?400:700,color:'#0f172a'}}>{email.from_name||'Sistema'}</span>
                          {email.ai_category&&<span style={{...styles.tagTiny,background:AI_CAT_COLORS[email.ai_category]||'#94a3b8'}}>{email.ai_category}</span>}
                        </div>
                        <div style={{fontSize:14,fontWeight:email.is_read?400:600,color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{email.subject}</div>
                      </div>
                      <span style={{fontSize:12,color:'#94a3b8',flexShrink:0}}>{timeAgo(email.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>}
        </div>
      ):

      /* ── Regular Inbox ── */
      emails.length===0?<div style={styles.loading}><Icon name="inbox" size={48} color="#cbd5e1"/><p style={{color:'#94a3b8'}}>No hay correos</p></div>:
      <div style={styles.emailList}>
        {emails.map(email=>(
          <div key={email.id} onClick={()=>openEmail(email)}
            style={{...styles.emailRow,...(!email.is_read?styles.emailUnread:{})}}>
            <button onClick={e=>toggleStar(email.id,e)} style={{background:'none',border:'none',cursor:'pointer',padding:4}}>
              <Icon name={email.is_starred?'star':'star_outline'} size={22} color={email.is_starred?'#f59e0b':'#cbd5e1'}/>
            </button>
            <div style={{width:36,height:36,borderRadius:'50%',background:AI_CAT_COLORS[email.ai_category]||'#64748b',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:14,flexShrink:0}}>
              {(email.from_name||'?')[0]}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                <span style={{fontSize:13,fontWeight:email.is_read?400:700,color:'#0f172a'}}>{email.from_name||'Sistema'}</span>
                {email.ai_category && <span style={{...styles.tagTiny,background:AI_CAT_COLORS[email.ai_category]||'#94a3b8'}}>{email.ai_category}</span>}
                {email.ai_priority==='urgente' && <span style={{...styles.tagTiny,background:'#dc2626'}}>URGENTE</span>}
              </div>
              <div style={{fontSize:14,fontWeight:email.is_read?400:600,color:'#1e293b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{email.subject}</div>
              <div style={{fontSize:12,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{email.ai_summary||email.body?.slice(0,100)}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
              <span style={{fontSize:12,color:'#94a3b8'}}>{timeAgo(email.created_at)}</span>
              {email.project_title && <span style={{fontSize:11,color:'#64748b',background:'#f1f5f9',borderRadius:4,padding:'2px 6px'}}>{email.project_title}</span>}
            </div>
            <button onClick={e=>archiveEmail(email.id,e)} style={{background:'none',border:'none',cursor:'pointer',padding:4,opacity:0.3}} title="Archivar">
              <Icon name="archive" size={20} color="#64748b"/>
            </button>
          </div>
        ))}
      </div>}
      {viewMode==='inbox'&&!loading&&pageInfo.total>0&&(
        <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:14,padding:'12px 6px',color:'#475569',fontSize:13}}>
          <span>{((page-1)*pageInfo.pageSize)+1}–{Math.min(page*pageInfo.pageSize,pageInfo.total)} de {pageInfo.total.toLocaleString('es-SV')}</span>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1} style={{display:'flex',alignItems:'center',justifyContent:'center',width:34,height:34,borderRadius:8,border:'1px solid #e2e8f0',background:page<=1?'#f8fafc':'#fff',cursor:page<=1?'default':'pointer',opacity:page<=1?0.5:1}} title="Anteriores"><Icon name="chevron_left" size={20} color="#475569"/></button>
          <span style={{fontSize:12,color:'#94a3b8'}}>Pág. {page}/{pageInfo.totalPages}</span>
          <button onClick={()=>setPage(p=>Math.min(pageInfo.totalPages,p+1))} disabled={page>=pageInfo.totalPages} style={{display:'flex',alignItems:'center',justifyContent:'center',width:34,height:34,borderRadius:8,border:'1px solid #e2e8f0',background:page>=pageInfo.totalPages?'#f8fafc':'#fff',cursor:page>=pageInfo.totalPages?'default':'pointer',opacity:page>=pageInfo.totalPages?0.5:1}} title="Siguientes"><Icon name="chevron_right" size={20} color="#475569"/></button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   COMPOSE VIEW
   ══════════════════════════════════════════════════════════════ */

function ComposeView({ goBack }){
  const [form,setForm]=useState({subject:'',body:'',to_user_id:'',project_id:'',send_external:false});
  const [directory,setDirectory]=useState([]);
  const [projects,setProjects]=useState([]);
  const [smtpReady,setSmtpReady]=useState(false);
  const [sending,setSending]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    (async()=>{
      const [dir,projs,emailCfg]=await Promise.all([
        apiFetch('/users/directory'),
        apiFetch('/projects'),
        apiFetch('/email-config'),
      ]);
      if(dir.success) setDirectory(dir.data);
      if(projs.success) setProjects(projs.data);
      setSmtpReady(!!(emailCfg.success&&emailCfg.data&&emailCfg.data.is_active&&emailCfg.data.smtp_host));
    })();
  },[]);

  function upd(k,v){ setForm(p=>({...p,[k]:v})); }

  async function send(e){
    e.preventDefault(); setSending(true); setError('');
    const res = await apiFetch('/correspondences',{method:'POST',body:JSON.stringify({
      ...form,
      to_user_id:Number(form.to_user_id)||null,
      project_id:form.project_id?Number(form.project_id):null,
    })});
    if(res.success) setResult(res);
    else setError(res.message||'No se pudo enviar la correspondencia');
    setSending(false);
  }

  if(result) return (
    <div style={{...styles.card,textAlign:'center',padding:40}}>
      <Icon name="check_circle" size={64} color="#22c55e"/><h3 style={{color:'#0f172a',marginTop:16}}>Correspondencia enviada</h3>
      {result.ai&&(
        <div style={{margin:'16px auto 0',maxWidth:480,padding:'12px 16px',borderRadius:10,background:'#f0f9ff',border:'1px solid #bae6fd',textAlign:'left'}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
            <Icon name="psychology" size={16} color="#0284c7"/><span style={{fontSize:12,fontWeight:700,color:'#0284c7'}}>Clasificación IA (Gemini)</span>
          </div>
          <div style={{display:'flex',gap:6,marginBottom:6}}>
            <span style={{...styles.tagTiny,background:AI_CAT_COLORS[result.ai.category]||'#64748b'}}>{result.ai.category}</span>
            <span style={{...styles.tagTiny,background:PRIORITY_COLORS[result.ai.priority]||'#94a3b8'}}>{result.ai.priority}</span>
          </div>
          <p style={{fontSize:13,color:'#0369a1',margin:0}}>{result.ai.summary}</p>
        </div>
      )}
      {result.external&&(
        <div style={{margin:'10px auto 0',maxWidth:480,padding:'10px 16px',borderRadius:10,textAlign:'left',
          background:result.external.ok?'#f0fdf4':'#fef2f2',border:`1px solid ${result.external.ok?'#86efac':'#fca5a5'}`}}>
          <span style={{fontSize:13,color:result.external.ok?'#166534':'#991b1b'}}>
            {result.external.ok?'📧 Enviado también por correo electrónico (SMTP)':'⚠️ El envío SMTP falló: '+result.external.message}
          </span>
        </div>
      )}
      <button onClick={goBack} style={{...styles.submitBtn,width:'auto',marginTop:16}}>Volver a bandeja</button>
    </div>
  );

  return (
    <div style={{padding:0}}>
      <button onClick={goBack} style={styles.backBtn}><Icon name="arrow_back" size={20}/><span>Cancelar</span></button>
      <div style={{...styles.card,marginTop:12}}>
        <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',marginBottom:16,display:'flex',alignItems:'center',gap:8}}><Icon name="edit" size={22} color="#3b82f6"/>Nueva Correspondencia</h3>
        <form onSubmit={send}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label style={styles.label}>Destinatario *</label>
              <select style={styles.select} value={form.to_user_id} onChange={e=>upd('to_user_id',e.target.value)} required>
                <option value="">Seleccione destinatario...</option>
                {directory.map(u=><option key={u.id} value={u.id}>{u.name}{u.unit_name?` — ${u.unit_name}`:''}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Proyecto asociado (opcional)</label>
              <select style={styles.select} value={form.project_id} onChange={e=>upd('project_id',e.target.value)}>
                <option value="">Sin proyecto</option>
                {projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>
          <label style={styles.label}>Asunto *</label>
          <input style={styles.input} value={form.subject} onChange={e=>upd('subject',e.target.value)} placeholder="Asunto de la correspondencia" required/>
          <label style={styles.label}>Contenido</label>
          <textarea style={{...styles.input,minHeight:200,fontFamily:'inherit',resize:'vertical'}} value={form.body} onChange={e=>upd('body',e.target.value)} placeholder="Escribe el contenido..."/>
          {smtpReady&&(
            <label style={{display:'flex',alignItems:'center',gap:8,marginTop:12,cursor:'pointer',fontSize:13,color:'#475569'}}>
              <input type="checkbox" checked={form.send_external} onChange={e=>upd('send_external',e.target.checked)} style={{accentColor:'#3b82f6',width:16,height:16}}/>
              Enviar también por correo electrónico real (SMTP) al destinatario
            </label>
          )}
          {error&&<div style={{marginTop:12,padding:'10px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fca5a5',fontSize:13,color:'#991b1b'}}>{error}</div>}
          <button type="submit" disabled={sending} style={{...styles.submitBtn,marginTop:16}}>{sending?'Enviando...':'Enviar Correspondencia'}</button>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PROJECTS VIEW (with detail + timeline)
   ══════════════════════════════════════════════════════════════ */

const EVENT_ICONS={created:'add_circle',status_change:'swap_horiz',document:'description',correspondence:'mail',review:'rate_review',
  budget:'payments',milestone:'flag',note:'sticky_note_2',legal:'gavel',alert:'warning'};
const EVENT_COLORS={created:'#22c55e',status_change:'#3b82f6',document:'#8b5cf6',correspondence:'#06b6d4',review:'#f59e0b',
  budget:'#10b981',milestone:'#ec4899',note:'#64748b',legal:'#ef4444',alert:'#f97316'};

function ProjectsView(){
  const [projects,setProjects]=useState([]);
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState('all');
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [showEventForm,setShowEventForm]=useState(false);
  const [eventForm,setEventForm]=useState({event_type:'note',title:'',description:''});
  const [showEdit,setShowEdit]=useState(false);
  const [editForm,setEditForm]=useState(null);
  const [editError,setEditError]=useState('');
  const [editSaving,setEditSaving]=useState(false);
  const [catalogs,setCatalogs]=useState({units:[],categories:[],users:[]});
  /* Chat IA flotante del proyecto */
  const [chatOpen,setChatOpen]=useState(false);
  const [chatMsgs,setChatMsgs]=useState([]);
  const [chatInput,setChatInput]=useState('');
  const [chatLoading,setChatLoading]=useState(false);
  const chatScrollRef=useRef(null);

  useEffect(()=>{ if(chatScrollRef.current) chatScrollRef.current.scrollTop=chatScrollRef.current.scrollHeight; },[chatMsgs,chatLoading,chatOpen]);

  async function sendChat(text){
    const history=[...chatMsgs,{role:'user',text}];
    setChatMsgs(history); setChatInput(''); setChatLoading(true);
    const res=await apiFetch(`/projects/${selected.id}/chat`,{method:'POST',body:JSON.stringify({
      messages:history.filter(m=>!m.error).map(m=>({role:m.role,text:m.text})),
    })});
    setChatMsgs(prev=>[...prev, res.success?{role:'assistant',text:res.reply}:{role:'assistant',text:res.message||'No se pudo obtener respuesta',error:true}]);
    setChatLoading(false);
  }

  const toDateInput=d=>d?String(new Date(d).toISOString()).slice(0,10):'';

  async function openEdit(p){
    setEditError('');
    if(!catalogs.units.length){
      const [u,c,dir]=await Promise.all([apiFetch('/units'),apiFetch('/categories'),apiFetch('/users/directory')]);
      setCatalogs({units:u.data||[],categories:c.data||[],users:dir.data||[]});
    }
    setEditForm({
      title:p.title||'', description:p.description||'', unit_id:p.unit_id||'', category_id:p.category_id||'',
      priority:p.priority||'media', budget_estimated:p.budget_estimated||0, legal_reference:p.legal_reference||'',
      start_date:toDateInput(p.start_date), end_date:toDateInput(p.end_date), deadline:toDateInput(p.deadline),
      assigned_to:p.assigned_to||'',
    });
    setShowEdit(true);
  }

  async function saveEdit(e){
    e.preventDefault(); setEditSaving(true); setEditError('');
    const res=await apiFetch(`/projects/${selected.id}`,{method:'PUT',body:JSON.stringify({
      ...editForm,
      unit_id:editForm.unit_id?Number(editForm.unit_id):null,
      category_id:editForm.category_id?Number(editForm.category_id):null,
      assigned_to:editForm.assigned_to?Number(editForm.assigned_to):null,
      budget_estimated:parseFloat(editForm.budget_estimated)||0,
      start_date:editForm.start_date||null, end_date:editForm.end_date||null, deadline:editForm.deadline||null,
    })});
    setEditSaving(false);
    if(res.success){ setShowEdit(false); openDetail(selected); load(); }
    else setEditError(res.message||'No se pudo guardar el proyecto');
  }

  const load=useCallback(async()=>{
    setLoading(true);
    const res=await apiFetch('/projects');
    if(res.success) setProjects(res.data);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function openDetail(p){
    setSelected(prev=>{
      if(prev?.id!==p.id){ setChatOpen(false); setChatMsgs([]); setChatInput(''); }
      return p;
    });
    setDetailLoading(true);setDetail(null);
    const res=await apiFetch(`/projects/${p.id}/detail`);
    if(res.success) setDetail(res.data);
    setDetailLoading(false);
  }

  async function changeStatus(newStatus){
    await apiFetch(`/projects/${selected.id}/status`,{method:'PUT',body:JSON.stringify({status:newStatus})});
    openDetail({...selected,status:newStatus});
    load();
  }

  async function addEvent(e){
    e.preventDefault();
    await apiFetch(`/projects/${selected.id}/events`,{method:'POST',body:JSON.stringify(eventForm)});
    setShowEventForm(false);setEventForm({event_type:'note',title:'',description:''});
    openDetail(selected);
  }

  const filtered=filter==='all'?projects:projects.filter(p=>p.status===filter);
  const STATUSES_FLOW=['borrador','en_revision','aprobado','en_proceso','adjudicado','completado'];

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando proyectos...</p></div>;

  /* ── Detail View ── */
  if(selected){
    const d=detail;
    const p=d?.project||selected;
    const days=daysUntil(p.deadline);
    const deadlineColor=days<=3?'#ef4444':days<=7?'#f59e0b':'#22c55e';
    const statusIdx=STATUSES_FLOW.indexOf(p.status);

    return (
      <div style={{padding:0}}>
        <button onClick={()=>{setSelected(null);setDetail(null);}} style={styles.backBtn}><Icon name="arrow_back" size={20}/><span>Volver a proyectos</span></button>

        {/* Project Header */}
        <div style={{...styles.card,marginTop:12,position:'relative',overflow:'visible'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <span style={{...styles.tagSmall,background:PRIORITY_COLORS[p.priority]||'#94a3b8'}}>{PRIORITY_LABELS[p.priority]||p.priority}</span>
                <span style={{...styles.tagSmall,background:STATUS_COLORS[p.status]||'#94a3b8'}}>{STATUS_LABELS[p.status]||p.status}</span>
                {LCP_PHASES[p.status]&&<span style={{...styles.tagSmall,background:'#0f172a'}} title="Fase del ciclo de compra pública (LCP Art. 1)">Fase LCP: {LCP_PHASES[p.status]}</span>}
                {p.category_name&&<span style={{...styles.tagSmall,background:p.category_color||'#94a3b8'}}>{p.category_name}</span>}
              </div>
              <h2 style={{fontSize:22,fontWeight:800,color:'#0f172a',margin:'8px 0 4px'}}>{p.title}</h2>
              <p style={{fontSize:14,color:'#475569',margin:0}}>{p.description}</p>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:24,fontWeight:800,color:'#0f172a'}}>{formatCurrency(p.budget_estimated)}</div>
              {p.deadline&&<div style={{display:'flex',alignItems:'center',gap:4,justifyContent:'flex-end',marginTop:4}}>
                <Icon name="event" size={16} color={deadlineColor}/><span style={{fontSize:13,fontWeight:600,color:deadlineColor}}>{days<=0?'VENCIDO':`${days} días · ${formatDate(p.deadline)}`}</span>
              </div>}
              <button onClick={()=>showEdit?setShowEdit(false):openEdit(p)} style={{...styles.actionBtn,padding:'6px 14px',fontSize:13,marginTop:8,marginLeft:'auto'}}>
                <Icon name="edit" size={16} color="#fff"/><span>{showEdit?'Cerrar edición':'Editar Proyecto'}</span>
              </button>
            </div>
          </div>

          {/* Info chips */}
          <div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:16,paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="business" size={18} color="#64748b"/><span style={{fontSize:13,color:'#475569'}}>{p.unit_name||'Sin unidad'}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="person" size={18} color="#64748b"/><span style={{fontSize:13,color:'#475569'}}>Creado por: {p.created_by_name||'Sistema'}</span></div>
            {p.assigned_name&&<div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="assignment_ind" size={18} color="#64748b"/><span style={{fontSize:13,color:'#475569'}}>Responsable: {p.assigned_name}</span></div>}
            {p.legal_reference&&<div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="gavel" size={18} color="#64748b"/><span style={{fontSize:13,color:'#475569'}}>{p.legal_reference}</span></div>}
            <div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="schedule" size={18} color="#64748b"/><span style={{fontSize:13,color:'#475569'}}>{formatDate(p.created_at)}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="play_circle" size={18} color={p.start_date?'#22c55e':'#cbd5e1'}/><span style={{fontSize:13,fontWeight:600,color:p.start_date?'#166534':'#94a3b8'}}>Inicio: {formatDate(p.start_date)}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:6}}><Icon name="stop_circle" size={18} color={p.end_date?'#ef4444':'#cbd5e1'}/><span style={{fontSize:13,fontWeight:600,color:p.end_date?'#991b1b':'#94a3b8'}}>Fin: {formatDate(p.end_date)}</span></div>
          </div>

          {/* Editor manual del proyecto (fechas de inicio/fin y demás campos) */}
          {showEdit&&editForm&&(
            <form onSubmit={saveEdit} style={{marginTop:16,padding:16,borderRadius:12,background:'#f8fafc',border:'2px solid #3b82f6'}}>
              <h4 style={{fontSize:15,fontWeight:700,color:'#0f172a',margin:'0 0 12px',display:'flex',alignItems:'center',gap:6}}>
                <Icon name="edit_calendar" size={20} color="#3b82f6"/>Edición manual del proyecto
              </h4>
              <label style={styles.label}>Título *</label>
              <input style={styles.input} value={editForm.title} onChange={e=>setEditForm(f=>({...f,title:e.target.value}))} required/>
              <label style={styles.label}>Descripción</label>
              <textarea style={{...styles.input,minHeight:70,resize:'vertical'}} value={editForm.description} onChange={e=>setEditForm(f=>({...f,description:e.target.value}))}/>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                <div>
                  <label style={styles.label}>Fecha de inicio</label>
                  <input style={styles.input} type="date" value={editForm.start_date} onChange={e=>setEditForm(f=>({...f,start_date:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Fecha de fin</label>
                  <input style={styles.input} type="date" value={editForm.end_date} onChange={e=>setEditForm(f=>({...f,end_date:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Fecha límite (LCP)</label>
                  <input style={styles.input} type="date" value={editForm.deadline} onChange={e=>setEditForm(f=>({...f,deadline:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Prioridad</label>
                  <select style={styles.select} value={editForm.priority} onChange={e=>setEditForm(f=>({...f,priority:e.target.value}))}>
                    {Object.entries(PRIORITY_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Presupuesto (USD)</label>
                  <input style={styles.input} type="number" step="0.01" value={editForm.budget_estimated} onChange={e=>setEditForm(f=>({...f,budget_estimated:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Base legal</label>
                  <input style={styles.input} value={editForm.legal_reference} onChange={e=>setEditForm(f=>({...f,legal_reference:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Unidad solicitante</label>
                  <select style={styles.select} value={editForm.unit_id} onChange={e=>setEditForm(f=>({...f,unit_id:e.target.value}))}>
                    <option value="">Sin unidad</option>
                    {catalogs.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Categoría</label>
                  <select style={styles.select} value={editForm.category_id} onChange={e=>setEditForm(f=>({...f,category_id:e.target.value}))}>
                    <option value="">Sin categoría</option>
                    {catalogs.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Responsable asignado</label>
                  <select style={styles.select} value={editForm.assigned_to} onChange={e=>setEditForm(f=>({...f,assigned_to:e.target.value}))}>
                    <option value="">Sin asignar</option>
                    {catalogs.users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              {editError&&<div style={{marginTop:10,padding:'10px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fca5a5',fontSize:13,color:'#991b1b'}}>{editError}</div>}
              <div style={{display:'flex',gap:12,marginTop:14}}>
                <button type="submit" disabled={editSaving} style={styles.submitBtn}>{editSaving?'Guardando...':'Guardar cambios'}</button>
                <button type="button" onClick={()=>setShowEdit(false)} style={{...styles.submitBtn,background:'#64748b'}}>Cancelar</button>
              </div>
              <p style={{fontSize:12,color:'#64748b',margin:'10px 0 0'}}>Cada cambio queda registrado automáticamente en el timeline de seguimiento del proyecto.</p>
            </form>
          )}

          {/* Status Flow (Pipeline) */}
          <div style={{display:'flex',alignItems:'center',gap:0,marginTop:20,padding:'16px 0'}}>
            {STATUSES_FLOW.map((s,i)=>{
              const isActive=i<=statusIdx;
              const isCurrent=s===p.status;
              return (
                <React.Fragment key={s}>
                  <button onClick={()=>changeStatus(s)} title={STATUS_LABELS[s]||s}
                    style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',background:'none',border:'none',position:'relative',zIndex:1}}>
                    <div style={{width:isCurrent?36:28,height:isCurrent?36:28,borderRadius:'50%',
                      background:isCurrent?STATUS_COLORS[s]||'#3b82f6':isActive?STATUS_COLORS[s]||'#3b82f6':'#e2e8f0',
                      display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.3s',
                      boxShadow:isCurrent?`0 0 0 4px ${(STATUS_COLORS[s]||'#3b82f6')}33`:'none'}}>
                      {isActive?<Icon name="check" size={isCurrent?20:16} color="#fff"/>:<span style={{width:8,height:8,borderRadius:'50%',background:'#94a3b8'}}/>}
                    </div>
                    <span style={{fontSize:10,fontWeight:isCurrent?700:400,color:isCurrent?STATUS_COLORS[s]||'#1e40af':'#94a3b8',whiteSpace:'nowrap',maxWidth:70,overflow:'hidden',textOverflow:'ellipsis'}}>{STATUS_LABELS[s]||s}</span>
                  </button>
                  {i<STATUSES_FLOW.length-1&&<div style={{flex:1,height:3,background:isActive&&i<statusIdx?STATUS_COLORS[STATUSES_FLOW[i+1]]||'#3b82f6':'#e2e8f0',minWidth:20,transition:'background 0.3s',marginTop:-16}}/>}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {detailLoading?<div style={{...styles.card,marginTop:16,textAlign:'center',padding:40}}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p style={{color:'#94a3b8'}}>Cargando detalle...</p></div>:d&&(
        <>
          {/* Stats row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginTop:16}}>
            <div style={{...styles.card,textAlign:'center',padding:'16px 12px'}}><div style={{fontSize:28,fontWeight:800,color:'#3b82f6'}}>{d.timeline?.length||0}</div><div style={{fontSize:12,color:'#64748b'}}>Eventos</div></div>
            <div style={{...styles.card,textAlign:'center',padding:'16px 12px'}}><div style={{fontSize:28,fontWeight:800,color:'#06b6d4'}}>{d.correspondences?.length||0}</div><div style={{fontSize:12,color:'#64748b'}}>Correos</div></div>
            <div style={{...styles.card,textAlign:'center',padding:'16px 12px'}}><div style={{fontSize:28,fontWeight:800,color:'#8b5cf6'}}>{d.procurement?.length||0}</div><div style={{fontSize:12,color:'#64748b'}}>Solicitudes</div></div>
            <div style={{...styles.card,textAlign:'center',padding:'16px 12px'}}><div style={{fontSize:28,fontWeight:800,color:'#f59e0b'}}>{d.alerts?.length||0}</div><div style={{fontSize:12,color:'#64748b'}}>Alertas</div></div>
          </div>

          {/* Timeline */}
          <div style={{...styles.card,marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={styles.cardHeader}><Icon name="timeline" size={22} color="#3b82f6"/><h3 style={styles.cardTitle}>Timeline del Proyecto</h3></div>
              <button onClick={()=>setShowEventForm(!showEventForm)} style={{...styles.actionBtn,padding:'6px 14px',fontSize:13}}>
                <Icon name="add" size={18} color="#fff"/><span>Agregar Evento</span>
              </button>
            </div>

            {showEventForm&&(
              <form onSubmit={addEvent} style={{marginBottom:20,padding:16,background:'#f8fafc',borderRadius:12,border:'1px solid #e2e8f0'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:12}}>
                  <div><label style={styles.label}>Tipo</label><select style={styles.select} value={eventForm.event_type} onChange={e=>setEventForm(p=>({...p,event_type:e.target.value}))}>
                    {Object.keys(EVENT_ICONS).map(k=><option key={k} value={k}>{k.replace(/_/g,' ')}</option>)}</select></div>
                  <div><label style={styles.label}>Título *</label><input style={styles.input} value={eventForm.title} onChange={e=>setEventForm(p=>({...p,title:e.target.value}))} required/></div>
                  <div style={{gridColumn:'1/-1'}}><label style={styles.label}>Descripción</label><textarea style={{...styles.input,minHeight:50,resize:'vertical'}} value={eventForm.description} onChange={e=>setEventForm(p=>({...p,description:e.target.value}))}/></div>
                </div>
                <div style={{display:'flex',gap:8,marginTop:12}}>
                  <button type="submit" style={{...styles.submitBtn,padding:'8px 20px',fontSize:13}}>Guardar</button>
                  <button type="button" onClick={()=>setShowEventForm(false)} style={{...styles.submitBtn,padding:'8px 20px',fontSize:13,background:'#64748b'}}>Cancelar</button>
                </div>
              </form>
            )}

            <div style={{position:'relative',paddingLeft:32}}>
              {/* Vertical line */}
              <div style={{position:'absolute',left:15,top:0,bottom:0,width:2,background:'linear-gradient(to bottom,#3b82f6,#e2e8f0)'}}/>

              {(d.timeline||[]).map((ev,i)=>{
                const color=EVENT_COLORS[ev.event_type]||'#64748b';
                const icon=EVENT_ICONS[ev.event_type]||'circle';
                return (
                  <div key={ev.id} style={{position:'relative',marginBottom:i<d.timeline.length-1?0:0,paddingBottom:24}}>
                    {/* Node */}
                    <div style={{position:'absolute',left:-25,top:0,width:28,height:28,borderRadius:'50%',background:'#fff',border:`3px solid ${color}`,display:'flex',alignItems:'center',justifyContent:'center',zIndex:2}}>
                      <Icon name={icon} size={14} color={color}/>
                    </div>
                    {/* Content */}
                    <div style={{marginLeft:16,padding:'12px 16px',background:i===d.timeline.length-1?`${color}08`:'#fff',borderRadius:12,border:`1px solid ${i===d.timeline.length-1?color+'33':'#e2e8f0'}`,transition:'all 0.2s'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{ev.title}</span>
                          <span style={{...styles.tagTiny,background:color}}>{ev.event_type.replace(/_/g,' ')}</span>
                        </div>
                        <span style={{fontSize:11,color:'#94a3b8'}}>{formatDate(ev.created_at)}</span>
                      </div>
                      {ev.description&&<p style={{fontSize:13,color:'#475569',margin:'4px 0 0',lineHeight:1.5}}>{ev.description}</p>}
                      {ev.old_value&&ev.new_value&&(
                        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
                          <span style={{...styles.tagTiny,background:'#94a3b8'}}>{STATUS_LABELS[ev.old_value]||ev.old_value}</span>
                          <Icon name="arrow_forward" size={14} color="#94a3b8"/>
                          <span style={{...styles.tagTiny,background:STATUS_COLORS[ev.new_value]||'#3b82f6'}}>{STATUS_LABELS[ev.new_value]||ev.new_value}</span>
                        </div>
                      )}
                      <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}><Icon name="person" size={12} color="#94a3b8"/> {ev.user_name||'Sistema'}</div>
                    </div>
                  </div>
                );
              })}

              {(d.timeline||[]).length===0&&<p style={{color:'#94a3b8',textAlign:'center',padding:20,marginLeft:-32}}>No hay eventos registrados</p>}
            </div>
          </div>

          {/* Project Correspondences */}
          {(d.correspondences||[]).length>0&&(
            <div style={{...styles.card,marginTop:16}}>
              <div style={styles.cardHeader}><Icon name="mail" size={22} color="#06b6d4"/><h3 style={styles.cardTitle}>Cadena de Correspondencia ({d.correspondences.length})</h3></div>
              <div style={{position:'relative',paddingLeft:24}}>
                <div style={{position:'absolute',left:11,top:0,bottom:0,width:2,background:'#e2e8f0'}}/>
                {d.correspondences.map((c,i)=>(
                  <div key={c.id} style={{position:'relative',paddingBottom:i<d.correspondences.length-1?16:0,marginBottom:0}}>
                    <div style={{position:'absolute',left:-19,top:4,width:20,height:20,borderRadius:'50%',background:AI_CAT_COLORS[c.ai_category]||'#64748b',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2}}>
                      <Icon name="mail" size={10} color="#fff"/>
                    </div>
                    <div style={{marginLeft:16,padding:'12px 16px',borderRadius:10,background:c.is_read?'#fff':'#f0f9ff',border:`1px solid ${c.is_read?'#e2e8f0':'#bae6fd'}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{c.from_name||'Sistema'}</span>
                          {c.ai_category&&<span style={{...styles.tagTiny,background:AI_CAT_COLORS[c.ai_category]||'#94a3b8'}}>{c.ai_category}</span>}
                          {c.ai_priority==='urgente'&&<span style={{...styles.tagTiny,background:'#dc2626'}}>URGENTE</span>}
                        </div>
                        <span style={{fontSize:11,color:'#94a3b8'}}>{formatDate(c.created_at)}</span>
                      </div>
                      <div style={{fontSize:14,fontWeight:600,color:'#1e293b',marginTop:4}}>{c.subject}</div>
                      {c.ai_summary&&<p style={{fontSize:12,color:'#64748b',margin:'4px 0 0',fontStyle:'italic'}}>IA: {c.ai_summary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
        )}

        {/* ── Chat IA flotante del proyecto ── */}
        {!chatOpen&&(
          <button onClick={()=>setChatOpen(true)} title="Preguntar a la IA sobre este proyecto"
            style={{position:'fixed',bottom:24,right:24,width:60,height:60,borderRadius:'50%',border:'none',cursor:'pointer',zIndex:1000,
              background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',boxShadow:'0 8px 25px rgba(59,130,246,0.4)',
              display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Icon name="forum" size={28} color="#fff"/>
          </button>
        )}
        {chatOpen&&(
          <div style={{position:'fixed',bottom:24,right:24,width:380,height:520,zIndex:1000,display:'flex',flexDirection:'column',
            background:'#fff',borderRadius:18,boxShadow:'0 20px 60px rgba(15,23,42,0.3)',border:'1px solid #e2e8f0',overflow:'hidden'}}>
            {/* Header */}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',background:'linear-gradient(135deg,#0f172a,#1e293b)'}}>
              <div style={{width:34,height:34,borderRadius:10,background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Icon name="psychology" size={20} color="#fff"/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:'#f1f5f9'}}>Asistente del Proyecto</div>
                <div style={{fontSize:11,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.title}</div>
              </div>
              {chatMsgs.length>0&&<button onClick={()=>setChatMsgs([])} title="Nueva conversación" style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="restart_alt" size={20} color="#94a3b8"/></button>}
              <button onClick={()=>setChatOpen(false)} style={{background:'none',border:'none',cursor:'pointer'}}><Icon name="close" size={20} color="#94a3b8"/></button>
            </div>
            {/* Mensajes */}
            <div ref={chatScrollRef} style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10,background:'#f8fafc'}}>
              {chatMsgs.length===0&&(
                <div>
                  <p style={{fontSize:13,color:'#475569',margin:'4px 0 10px'}}>Pregúntame lo que necesites sobre este expediente: estado, responsable, fechas, riesgos, correspondencia, documentos...</p>
                  {['¿En qué estado se encuentra el proyecto?','¿Quién es el responsable actual?','¿Hay riesgo de vencimiento?','¿Qué acciones están pendientes?','Resume la correspondencia reciente'].map(q=>(
                    <button key={q} onClick={()=>sendChat(q)} style={{display:'block',width:'100%',textAlign:'left',padding:'8px 12px',marginBottom:6,borderRadius:10,
                      border:'1px solid #bfdbfe',background:'#eff6ff',color:'#1e40af',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {chatMsgs.map((m,i)=>(
                <div key={i} style={{alignSelf:m.role==='user'?'flex-end':'flex-start',maxWidth:'85%',
                  padding:'10px 14px',borderRadius:m.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px',
                  background:m.role==='user'?'linear-gradient(135deg,#3b82f6,#2563eb)':m.error?'#fef2f2':'#fff',
                  border:m.role==='user'?'none':`1px solid ${m.error?'#fca5a5':'#e2e8f0'}`,
                  color:m.role==='user'?'#fff':m.error?'#991b1b':'#334155',fontSize:13,lineHeight:1.55,whiteSpace:'pre-wrap'}}>
                  {m.text}
                </div>
              ))}
              {chatLoading&&(
                <div style={{alignSelf:'flex-start',padding:'10px 14px',borderRadius:'14px 14px 14px 4px',background:'#fff',border:'1px solid #e2e8f0',display:'flex',gap:5,alignItems:'center'}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:'#94a3b8',animation:'pulse 1s infinite'}}/>
                  <span style={{width:7,height:7,borderRadius:'50%',background:'#94a3b8',animation:'pulse 1s infinite 0.2s'}}/>
                  <span style={{width:7,height:7,borderRadius:'50%',background:'#94a3b8',animation:'pulse 1s infinite 0.4s'}}/>
                  <span style={{fontSize:12,color:'#94a3b8',marginLeft:4}}>Analizando expediente...</span>
                </div>
              )}
            </div>
            {/* Input */}
            <form onSubmit={e=>{e.preventDefault();if(chatInput.trim())sendChat(chatInput.trim());}} style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #e2e8f0',background:'#fff'}}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Escriba su pregunta..." disabled={chatLoading}
                style={{flex:1,padding:'10px 14px',borderRadius:12,border:'1px solid #e2e8f0',fontSize:13,outline:'none'}}/>
              <button type="submit" disabled={chatLoading||!chatInput.trim()}
                style={{width:42,height:42,borderRadius:12,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                  background:chatLoading||!chatInput.trim()?'#cbd5e1':'linear-gradient(135deg,#3b82f6,#8b5cf6)'}}>
                <Icon name="send" size={20} color="#fff"/>
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  /* ── Project List ── */
  return (
    <div style={{padding:0}}>
      <div style={styles.filterBar}>
        {[['all','Todos'],['borrador','Borrador'],['en_revision','En Revisión'],['aprobado','Aprobado'],['en_proceso','En Proceso'],['completado','Completado']].map(([k,label])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{...styles.filterTab,...(filter===k?styles.filterTabActive:{})}}>{label}</button>
        ))}
      </div>

      <div style={styles.projectGrid}>
        {filtered.map(p=>{
          const days=daysUntil(p.deadline);
          const deadlineColor=days<=3?'#ef4444':days<=7?'#f59e0b':'#22c55e';
          return (
            <div key={p.id} style={{...styles.projectCard,cursor:'pointer',transition:'transform 0.15s, box-shadow 0.15s'}}
              onClick={()=>openDetail(p)}
              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 25px rgba(0,0,0,0.1)';}}
              onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='';}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                <div style={{flex:1}}>
                  <h4 style={{fontSize:15,fontWeight:700,color:'#0f172a',margin:0}}>{p.title}</h4>
                  <p style={{fontSize:12,color:'#64748b',margin:'4px 0 0'}}>{p.unit_name||'Sin unidad'}</p>
                </div>
                <span style={{...styles.tagSmall,background:PRIORITY_COLORS[p.priority]||'#94a3b8'}}>{PRIORITY_LABELS[p.priority]||p.priority}</span>
              </div>
              <p style={{fontSize:13,color:'#475569',margin:'0 0 12px',lineHeight:1.5}}>{p.description?.slice(0,120)||(p.description||'Sin descripción')}{p.description?.length>120?'...':''}</p>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
                <span style={{...styles.tagSmall,background:STATUS_COLORS[p.status]||'#94a3b8'}}>{STATUS_LABELS[p.status]||p.status}</span>
                <span style={{...styles.tagSmall,background:p.category_color||'#94a3b8'}}>{p.category_name||'Sin categoría'}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:12,borderTop:'1px solid #f1f5f9'}}>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{formatCurrency(p.budget_estimated)}</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {p.deadline&&<div style={{display:'flex',alignItems:'center',gap:4}}>
                    <Icon name="event" size={16} color={deadlineColor}/><span style={{fontSize:12,fontWeight:600,color:deadlineColor}}>{days<=0?'VENCIDO':`${days}d`}</span>
                  </div>}
                  <Icon name="arrow_forward" size={18} color="#94a3b8"/>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PAC — Planificación Anual de Compras (LCP Art. 17)
   Formato referencial DINAC: descripción, código ONU (UNSPSC),
   unidad solicitante, fuente de financiamiento, método, monto y
   fecha estimada. Publicación en COMPRASAL ≤30 días del ejercicio.
   ══════════════════════════════════════════════════════════════ */

function PACView(){
  const currentYear=new Date().getFullYear();
  const [year,setYear]=useState(currentYear);
  const [items,setItems]=useState([]);
  const [summary,setSummary]=useState(null);
  const [units,setUnits]=useState([]);
  const [projects,setProjects]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [error,setError]=useState('');
  const emptyForm={description:'',unspsc_code:'',unit_id:'',funding_source:'Fondo General',procurement_method:'comparacion_precios',estimated_amount:'',planned_month:'',notes:'',status:'programado',project_id:''};
  const [form,setForm]=useState(emptyForm);

  const PAC_METHODS=[
    {v:'comparacion_precios',l:'Comparación de Precios (Art. 40)'},
    {v:'licitacion_competitiva',l:'Licitación Competitiva (Art. 39)'},
    {v:'contratacion_directa',l:'Contratación Directa (Art. 41)'},
    {v:'consultoria',l:'Servicios de Consultoría (Arts. 47+)'},
    {v:'convenio_marco',l:'Catálogo Electrónico / Convenio Marco'},
    {v:'subasta_inversa',l:'Subasta Electrónica Inversa'},
  ];
  const FUNDING_SOURCES=['Fondo General','Fondos Propios','Préstamo Externo','Donación','Otros'];

  const load=useCallback(async()=>{
    setLoading(true);
    const [pacRes,uRes,pRes]=await Promise.all([apiFetch(`/pac?year=${year}`),apiFetch('/units'),apiFetch('/projects')]);
    if(pacRes.success){ setItems(pacRes.data.items); setSummary(pacRes.data.summary); }
    if(uRes.success) setUnits(uRes.data);
    if(pRes.success) setProjects(pRes.data);
    setLoading(false);
  },[year]);
  useEffect(()=>{load();},[load]);

  function upd(k,v){ setForm(p=>({...p,[k]:v})); }
  function openCreate(){ setEditing(null); setForm(emptyForm); setShowForm(true); setError(''); }
  function openEdit(it){
    setEditing(it);
    setForm({description:it.description,unspsc_code:it.unspsc_code||'',unit_id:it.unit_id||'',funding_source:it.funding_source||'Fondo General',
      procurement_method:it.procurement_method,estimated_amount:it.estimated_amount,planned_month:it.planned_month||'',notes:it.notes||'',
      status:it.status,project_id:it.project_id||''});
    setShowForm(true); setError('');
  }

  async function save(e){
    e.preventDefault(); setError('');
    const payload={...form,pac_year:year,unit_id:form.unit_id?Number(form.unit_id):null,
      estimated_amount:parseFloat(form.estimated_amount)||0,planned_month:form.planned_month?Number(form.planned_month):null,
      project_id:form.project_id?Number(form.project_id):null};
    const res=editing
      ?await apiFetch(`/pac/${editing.id}`,{method:'PUT',body:JSON.stringify(payload)})
      :await apiFetch('/pac',{method:'POST',body:JSON.stringify(payload)});
    if(res.success){ setShowForm(false); load(); }
    else setError(res.message||'No se pudo guardar el ítem');
  }

  async function remove(it){
    if(!window.confirm(`¿Eliminar el ítem ${it.correlativo} "${it.description.slice(0,50)}"?`)) return;
    const res=await apiFetch(`/pac/${it.id}`,{method:'DELETE'});
    if(res.success) load(); else alert(res.message||'No se pudo eliminar');
  }

  function exportCSV(){
    const head=['Correlativo','Descripción del objeto','Código ONU (UNSPSC)','Unidad Solicitante','Fuente de Financiamiento','Método de Contratación','Monto Estimado (USD)','Mes Estimado','Estado','Proyecto Vinculado','Observaciones'];
    const rows=items.map(i=>[i.correlativo,i.description,i.unspsc_code,i.unit_name||'',i.funding_source,PAC_METHOD_LABELS[i.procurement_method]||i.procurement_method,
      Number(i.estimated_amount).toFixed(2),i.planned_month?MONTHS_ES[i.planned_month]:'',PAC_STATUS[i.status]?.l||i.status,i.project_title||'',i.notes||'']);
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const csv='﻿'+[head,...rows].map(r=>r.map(esc).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`PAC_PGR_${year}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando PAC...</p></div>;

  return (
    <div style={{padding:0}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
        <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',margin:0}}>Planificación Anual de Compras</h3>
        <select style={{...styles.select,width:'auto'}} value={year} onChange={e=>setYear(Number(e.target.value))}>
          {[currentYear-1,currentYear,currentYear+1].map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{marginLeft:'auto',display:'flex',gap:10}}>
          <button onClick={exportCSV} disabled={!items.length} style={{...styles.actionBtn,background:'linear-gradient(135deg,#059669,#10b981)'}}>
            <Icon name="download" size={18} color="#fff"/><span>Exportar CSV (COMPRASAL)</span>
          </button>
          <button onClick={openCreate} style={styles.actionBtn}><Icon name="add" size={18} color="#fff"/><span>Agregar Proceso</span></button>
        </div>
      </div>

      <div style={{padding:'10px 14px',borderRadius:10,background:'#eff6ff',border:'1px solid #bfdbfe',marginBottom:16,fontSize:13,color:'#1e3a5f'}}>
        <strong>LCP Art. 17:</strong> la PAC se elabora entre la UCP, las Unidades Solicitantes y la UFI, y debe publicarse en COMPRASAL a más tardar <strong>30 días calendario</strong> después de iniciado el ejercicio fiscal. Las compras por <strong>Baja Cuantía se excluyen</strong> de la PAC y se reportan mensualmente en COMPRASAL.
      </div>

      {/* Resumen */}
      {summary&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
          <div style={{...styles.card,padding:'14px 16px'}}><div style={{fontSize:12,color:'#64748b'}}>Procesos programados</div><div style={{fontSize:24,fontWeight:800,color:'#0f172a'}}>{summary.count}</div><div style={{fontSize:11,color:'#94a3b8'}}>{summary.linked} vinculados a proyecto · {summary.contracted} contratados</div></div>
          <div style={{...styles.card,padding:'14px 16px'}}><div style={{fontSize:12,color:'#64748b'}}>Total programado PAC {year}</div><div style={{fontSize:24,fontWeight:800,color:'#3b82f6'}}>{formatCurrency(summary.total)}</div></div>
          <div style={{...styles.card,padding:'14px 16px',border:summary.annualBudget&&!summary.withinBudget?'2px solid #ef4444':undefined}}>
            <div style={{fontSize:12,color:'#64748b'}}>vs. Presupuesto anual</div>
            {summary.annualBudget?(
              <>
                <div style={{fontSize:24,fontWeight:800,color:summary.withinBudget?'#059669':'#ef4444'}}>{summary.withinBudget?'✓ Dentro':'⚠ Excede'}</div>
                <div style={{fontSize:11,color:summary.withinBudget?'#15803d':'#b91c1c'}}>{summary.withinBudget?'Disponible':'Exceso'}: {formatCurrency(Math.abs(summary.budgetDifference))}</div>
              </>
            ):<div style={{fontSize:13,color:'#94a3b8',marginTop:6}}>Sin presupuesto definido para {year} (Configuración → Seguimiento)</div>}
          </div>
          <div style={{...styles.card,padding:'14px 16px'}}>
            <div style={{fontSize:12,color:'#64748b'}}>Programación por trimestre</div>
            <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap'}}>
              {Object.entries(summary.byQuarter).map(([q,v])=>(
                <span key={q} style={{fontSize:11,padding:'3px 8px',borderRadius:6,background:'#f1f5f9',color:'#475569'}}><strong>{q}</strong> {formatCurrency(v)}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Formulario */}
      {showForm&&(
        <div style={{...styles.card,marginBottom:16,border:'2px solid #3b82f6'}}>
          <h4 style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:14}}>{editing?`Editar proceso #${editing.correlativo}`:'Agregar proceso a la PAC'}</h4>
          <form onSubmit={save}>
            <label style={styles.label}>Descripción del objeto de compra *</label>
            <input style={styles.input} value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Ej.: Adquisición de equipo informático para oficinas regionales" required/>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              <div>
                <label style={styles.label}>Código ONU (UNSPSC)</label>
                <input style={styles.input} value={form.unspsc_code} onChange={e=>upd('unspsc_code',e.target.value)} placeholder="Ej.: 43211503"/>
              </div>
              <div>
                <label style={styles.label}>Unidad solicitante</label>
                <select style={styles.select} value={form.unit_id} onChange={e=>upd('unit_id',e.target.value)}>
                  <option value="">Seleccione...</option>
                  {units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Fuente de financiamiento</label>
                <select style={styles.select} value={form.funding_source} onChange={e=>upd('funding_source',e.target.value)}>
                  {FUNDING_SOURCES.map(f=><option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Método de contratación (LCP)</label>
                <select style={styles.select} value={form.procurement_method} onChange={e=>upd('procurement_method',e.target.value)}>
                  {PAC_METHODS.map(m=><option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Monto estimado (USD)</label>
                <input style={styles.input} type="number" step="0.01" value={form.estimated_amount} onChange={e=>upd('estimated_amount',e.target.value)}/>
              </div>
              <div>
                <label style={styles.label}>Mes estimado de contratación</label>
                <select style={styles.select} value={form.planned_month} onChange={e=>upd('planned_month',e.target.value)}>
                  <option value="">Sin definir</option>
                  {MONTHS_ES.slice(1).map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
                </select>
              </div>
              {editing&&(
                <>
                  <div>
                    <label style={styles.label}>Estado del proceso</label>
                    <select style={styles.select} value={form.status} onChange={e=>upd('status',e.target.value)}>
                      {Object.entries(PAC_STATUS).map(([v,s])=><option key={v} value={v}>{s.l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>Proyecto vinculado</label>
                    <select style={styles.select} value={form.project_id} onChange={e=>upd('project_id',e.target.value)}>
                      <option value="">Sin vincular</option>
                      {projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
            <label style={styles.label}>Observaciones</label>
            <input style={styles.input} value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder="Notas para COMPRASAL u observaciones internas"/>
            {error&&<div style={{marginTop:10,padding:'10px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fca5a5',fontSize:13,color:'#991b1b'}}>{error}</div>}
            <div style={{display:'flex',gap:12,marginTop:14}}>
              <button type="submit" style={styles.submitBtn}>{editing?'Guardar cambios':'Agregar a la PAC'}</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{...styles.submitBtn,background:'#64748b'}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla PAC */}
      <div style={styles.card}>
        <div style={{overflowX:'auto'}}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>N°</th>
                <th style={styles.th}>Descripción del objeto</th>
                <th style={styles.th}>UNSPSC</th>
                <th style={styles.th}>Unidad</th>
                <th style={styles.th}>Fuente</th>
                <th style={styles.th}>Método</th>
                <th style={styles.th}>Monto</th>
                <th style={styles.th}>Mes</th>
                <th style={styles.th}>Estado</th>
                <th style={styles.th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length===0&&<tr><td colSpan={10} style={{...styles.td,textAlign:'center',color:'#94a3b8',padding:30}}>La PAC {year} no tiene procesos registrados. Use "Agregar Proceso".</td></tr>}
              {items.map(it=>(
                <tr key={it.id} style={it.status==='cancelado'?{opacity:0.5}:{}}>
                  <td style={styles.td}><strong>{it.correlativo}</strong></td>
                  <td style={styles.td}>
                    <div style={{maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:600}} title={it.description}>{it.description}</div>
                    {it.project_title&&<div style={{fontSize:11,color:'#3b82f6'}}>↳ {it.project_title}</div>}
                  </td>
                  <td style={styles.td}>{it.unspsc_code||'—'}</td>
                  <td style={styles.td}><span style={{fontSize:12}}>{it.unit_name||'—'}</span></td>
                  <td style={styles.td}><span style={{fontSize:12}}>{it.funding_source}</span></td>
                  <td style={styles.td}><span style={{fontSize:12}}>{PAC_METHOD_LABELS[it.procurement_method]||it.procurement_method}</span></td>
                  <td style={styles.td}><strong>{formatCurrency(it.estimated_amount)}</strong></td>
                  <td style={styles.td}>{it.planned_month?MONTHS_ES[it.planned_month]:'—'}</td>
                  <td style={styles.td}><span style={{...styles.tagTiny,background:PAC_STATUS[it.status]?.c||'#94a3b8'}}>{PAC_STATUS[it.status]?.l||it.status}</span></td>
                  <td style={styles.td}>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>openEdit(it)} style={styles.iconBtn} title="Editar"><Icon name="edit" size={18} color="#3b82f6"/></button>
                      <button onClick={()=>remove(it)} style={styles.iconBtn} title="Eliminar (solo admin)"><Icon name="delete" size={18} color="#ef4444"/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PROCUREMENT VIEW (LCP)
   ══════════════════════════════════════════════════════════════ */

function ProcurementView(){
  const [requests,setRequests]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [form,setForm]=useState({title:'',description:'',legal_basis:'LCP Art. 40 - Comparación de Precios',procurement_type:'comparacion_precios',estimated_amount:'',justification:''});
  const [advising,setAdvising]=useState(false);
  const [advice,setAdvice]=useState(null);

  useEffect(()=>{
    (async ()=>{
      const res = await apiFetch('/procurement');
      if(res.success) setRequests(res.data);
      setLoading(false);
    })();
  },[]);

  function upd(k,v){ setForm(p=>({...p,[k]:v})); }

  /* Asistente LCP real: método por umbrales (DL 652/2023) + asesoría Gemini */
  async function getAdvice(){
    const amount=parseFloat(form.estimated_amount);
    if(!amount||amount<=0){ setAdvice({error:'Ingrese primero un monto estimado válido.'}); return; }
    setAdvising(true); setAdvice(null);
    const res = await apiFetch('/procurement/suggest',{method:'POST',body:JSON.stringify({amount,description:form.description||form.title})});
    if(res.success){
      setAdvice(res.data);
      setForm(p=>({...p,procurement_type:res.data.procurement_type,legal_basis:res.data.legal_basis}));
    } else {
      setAdvice({error:res.message||'No se pudo obtener la sugerencia'});
    }
    setAdvising(false);
  }

  async function handleSubmit(e){
    e.preventDefault();
    const res = await apiFetch('/procurement',{method:'POST',body:JSON.stringify({...form,estimated_amount:parseFloat(form.estimated_amount)||0})});
    if(res.success){
      setShowForm(false);
      const r2 = await apiFetch('/procurement');
      if(r2.success) setRequests(r2.data);
    }
  }

  const LCP_TYPES = [
    {value:'comparacion_precios',label:'LCP Art. 40 - Comparación de Precios',desc:'Hasta 240 salarios mínimos comercio (~$87,600)'},
    {value:'licitacion_competitiva',label:'LCP Art. 39 - Licitación Competitiva',desc:'Más de 240 salarios mínimos comercio'},
    {value:'contratacion_directa',label:'LCP Art. 41 - Contratación Directa',desc:'Casos de excepción tasados'},
    {value:'baja_cuantia',label:'LCP Art. 44 - Baja Cuantía',desc:'Fondo circulante (se excluye de la PAC)'},
  ];

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando...</p></div>;

  return (
    <div style={{padding:0}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',margin:0}}>Procesos de Compra — Ley de Compras Públicas (LCP)</h3>
        <button onClick={()=>setShowForm(!showForm)} style={styles.actionBtn}>
          <Icon name="add" size={20} color="#fff"/><span>Nueva Solicitud</span>
        </button>
      </div>

      {showForm && (
        <div style={{...styles.card,marginBottom:20,border:'2px solid #3b82f6'}}>
          <h4 style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:16}}>Nueva Solicitud de Compra</h4>
          <form onSubmit={handleSubmit}>
            <label style={styles.label}>Título *</label>
            <input style={styles.input} value={form.title} onChange={e=>upd('title',e.target.value)} placeholder="Título de la solicitud" required/>
            <label style={styles.label}>Descripción</label>
            <textarea style={{...styles.input,minHeight:80,resize:'vertical'}} value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Describa la necesidad..."/>
            <label style={styles.label}>Método de Contratación (LCP)</label>
            <select style={styles.select} value={form.procurement_type} onChange={e=>{upd('procurement_type',e.target.value); const t=LCP_TYPES.find(x=>x.value===e.target.value); if(t) upd('legal_basis',t.label);}}>
              {LCP_TYPES.map(t=><option key={t.value} value={t.value}>{t.label} - {t.desc}</option>)}
            </select>
            <label style={styles.label}>Monto Estimado (USD)</label>
            <div style={{display:'flex',gap:10,alignItems:'stretch'}}>
              <input style={{...styles.input,flex:1,marginBottom:0}} type="number" step="0.01" value={form.estimated_amount} onChange={e=>upd('estimated_amount',e.target.value)} placeholder="0.00"/>
              <button type="button" onClick={getAdvice} disabled={advising}
                style={{padding:'0 16px',borderRadius:10,border:'none',cursor:'pointer',fontSize:13,fontWeight:700,color:'#fff',whiteSpace:'nowrap',
                  background:advising?'#94a3b8':'linear-gradient(135deg,#3b82f6,#8b5cf6)'}}>
                <Icon name="smart_toy" size={16} color="#fff" style={{marginRight:4}}/>{advising?'Consultando...':'Asistente LCP'}
              </button>
            </div>
            {advice&&(advice.error?(
              <div style={{marginTop:10,padding:'10px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fca5a5',fontSize:13,color:'#991b1b'}}>{advice.error}</div>
            ):(
              <div style={{marginTop:10,padding:'12px 16px',borderRadius:10,background:'linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06))',border:'1px solid rgba(59,130,246,0.25)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <Icon name="gavel" size={18} color="#3b82f6"/>
                  <span style={{fontSize:13,fontWeight:700,color:'#1e40af'}}>Método sugerido: {advice.modality} ({advice.article} LCP)</span>
                </div>
                <div style={{fontSize:12,color:'#475569'}}>Se aplicó automáticamente al formulario.{advice.note?` ${advice.note}`:''}</div>
                {advice.ai&&(
                  <div style={{marginTop:8,paddingTop:8,borderTop:'1px dashed rgba(59,130,246,0.25)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <Icon name="psychology" size={14} color="#8b5cf6"/><span style={{fontSize:12,fontWeight:700,color:'#7c3aed'}}>Asesoría Gemini</span>
                    </div>
                    <p style={{fontSize:13,color:'#334155',margin:'0 0 6px'}}>{advice.ai.recommendation}</p>
                    <ul style={{fontSize:12,color:'#475569',margin:0,paddingLeft:18,lineHeight:1.6}}>
                      {(advice.ai.considerations||[]).map((c,i)=><li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            <label style={styles.label}>Justificación</label>
            <textarea style={{...styles.input,minHeight:60,resize:'vertical'}} value={form.justification} onChange={e=>upd('justification',e.target.value)} placeholder="Justificación legal y técnica..."/>
            <div style={{display:'flex',gap:12,marginTop:16}}>
              <button type="submit" style={styles.submitBtn}>Crear Solicitud</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{...styles.submitBtn,background:'#64748b'}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Requests table */}
      <div style={styles.card}>
        <div style={{overflowX:'auto'}}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Código</th>
                <th style={styles.th}>Título</th>
                <th style={styles.th}>Modalidad</th>
                <th style={styles.th}>Monto</th>
                <th style={styles.th}>Unidad</th>
                <th style={styles.th}>Estado</th>
                <th style={styles.th}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r=>(
                <tr key={r.id} style={styles.tr}>
                  <td style={styles.td}><code style={{fontWeight:600,color:'#1e40af'}}>{r.code}</code></td>
                  <td style={styles.td}><span style={{fontWeight:500}}>{r.title}</span></td>
                  <td style={styles.td}><span style={{fontSize:12}}>{r.legal_basis}</span></td>
                  <td style={styles.td}><strong>{formatCurrency(r.estimated_amount)}</strong></td>
                  <td style={styles.td}>{r.unit_name||'—'}</td>
                  <td style={styles.td}><span style={{...styles.tagSmall,background:STATUS_COLORS[r.status]||'#94a3b8'}}>{STATUS_LABELS[r.status]||r.status}</span></td>
                  <td style={styles.td}>{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ALERTS VIEW
   ══════════════════════════════════════════════════════════════ */

function AlertsView(){
  const [alerts,setAlerts]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    (async ()=>{
      const res = await apiFetch('/alerts');
      if(res.success) setAlerts(res.data);
      setLoading(false);
    })();
  },[]);

  async function markRead(id){
    await apiFetch(`/alerts/${id}/read`,{method:'PUT'});
    setAlerts(p=>p.map(a=>a.id===id?{...a,is_read:1}:a));
  }

  const ALERT_ICONS = { deadline_warning:'warning', deadline_expired:'error', status_change:'swap_horiz', info:'info', new_correspondence:'mail' };
  const ALERT_COLORS = { deadline_warning:'#f59e0b', deadline_expired:'#ef4444', status_change:'#3b82f6', info:'#06b6d4', new_correspondence:'#8b5cf6' };

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando...</p></div>;

  return (
    <div style={{padding:0}}>
      <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',marginBottom:16}}>Alertas del Sistema</h3>
      {alerts.length===0 ? <div style={{...styles.card,textAlign:'center',padding:40}}><Icon name="notifications_off" size={48} color="#cbd5e1"/><p style={{color:'#94a3b8'}}>Sin alertas</p></div> :
        alerts.map(a=>(
          <div key={a.id} onClick={()=>!a.is_read&&markRead(a.id)}
            style={{...styles.alertItem,...(!a.is_read?{background:'#fffbeb',borderLeft:`4px solid ${ALERT_COLORS[a.type]||'#94a3b8'}`}:{borderLeft:'4px solid #e2e8f0'})}}>
            <div style={{width:40,height:40,borderRadius:10,background:`${ALERT_COLORS[a.type]||'#94a3b8'}20`,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Icon name={ALERT_ICONS[a.type]||'info'} size={22} color={ALERT_COLORS[a.type]||'#94a3b8'}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:a.is_read?400:700,color:'#0f172a'}}>{a.title}</div>
              <div style={{fontSize:13,color:'#475569',marginTop:2}}>{a.message}</div>
              {a.project_title && <div style={{fontSize:12,color:'#64748b',marginTop:4}}>Proyecto: {a.project_title}</div>}
            </div>
            <div style={{fontSize:12,color:'#94a3b8',flexShrink:0}}>{formatDate(a.trigger_date)}</div>
          </div>
        ))
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   UNITS VIEW (CRUD)
   ══════════════════════════════════════════════════════════════ */

function UnitsView({ userRole }){
  const [units,setUnits]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({name:'',code:'',description:'',responsible_name:'',email:'',phone:''});
  const [error,setError]=useState('');
  const isAdmin = ['admin','jefe_uacp'].includes(userRole);

  const load = useCallback(async ()=>{
    setLoading(true);
    const res = await apiFetch(isAdmin ? '/units/all' : '/units');
    if(res.success) setUnits(res.data);
    setLoading(false);
  },[isAdmin]);

  useEffect(()=>{ load(); },[load]);

  function upd(k,v){ setForm(p=>({...p,[k]:v})); }

  function openCreate(){
    setEditing(null);
    setForm({name:'',code:'',description:'',responsible_name:'',email:'',phone:''});
    setShowForm(true); setError('');
  }

  function openEdit(u){
    setEditing(u);
    setForm({name:u.name,code:u.code,description:u.description||'',responsible_name:u.responsible_name||'',email:u.email||'',phone:u.phone||''});
    setShowForm(true); setError('');
  }

  async function handleSubmit(e){
    e.preventDefault(); setError('');
    if(!form.name||!form.code) return setError('Nombre y código son requeridos');
    const body=JSON.stringify(form);
    let res;
    if(editing) res = await apiFetch(`/units/${editing.id}`,{method:'PUT',body});
    else res = await apiFetch('/units',{method:'POST',body});
    if(res.success){ setShowForm(false); load(); }
    else setError(res.message||'Error');
  }

  async function toggleActive(u){
    if(u.is_active){
      await apiFetch(`/units/${u.id}`,{method:'DELETE'});
    } else {
      await apiFetch(`/units/${u.id}`,{method:'PUT',body:JSON.stringify({...u,is_active:1})});
    }
    load();
  }

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando...</p></div>;

  return (
    <div style={{padding:0}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',margin:0}}>Unidades Solicitantes</h3>
        {isAdmin && <button onClick={openCreate} style={styles.actionBtn}><Icon name="add" size={20} color="#fff"/><span>Nueva Unidad</span></button>}
      </div>

      {showForm && (
        <div style={{...styles.card,marginBottom:20,border:'2px solid #3b82f6'}}>
          <h4 style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:16}}>{editing?'Editar Unidad':'Nueva Unidad Solicitante'}</h4>
          {error && <div style={styles.errorBox}><Icon name="error" size={18} color="#dc2626"/><span>{error}</span></div>}
          <form onSubmit={handleSubmit}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={styles.label}>Nombre *</label><input style={styles.input} value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="Nombre de la unidad" required/></div>
              <div><label style={styles.label}>Código *</label><input style={styles.input} value={form.code} onChange={e=>upd('code',e.target.value)} placeholder="XX-001" required/></div>
              <div style={{gridColumn:'1/-1'}}><label style={styles.label}>Descripción</label><input style={styles.input} value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Descripción"/></div>
              <div><label style={styles.label}>Responsable</label><input style={styles.input} value={form.responsible_name} onChange={e=>upd('responsible_name',e.target.value)} placeholder="Nombre del responsable"/></div>
              <div><label style={styles.label}>Correo</label><input style={styles.input} type="email" value={form.email} onChange={e=>upd('email',e.target.value)} placeholder="correo@pgr.gob.sv"/></div>
              <div><label style={styles.label}>Teléfono</label><input style={styles.input} value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="2231-9400"/></div>
            </div>
            <div style={{display:'flex',gap:12,marginTop:16}}>
              <button type="submit" style={styles.submitBtn}>{editing?'Guardar Cambios':'Crear Unidad'}</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{...styles.submitBtn,background:'#64748b'}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:16}}>
        {units.map(u=>(
          <div key={u.id} style={{...styles.unitCard,...(!u.is_active?{opacity:0.5}:{})}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div style={{width:44,height:44,borderRadius:12,background:u.is_active?'#eff6ff':'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Icon name="business" size={24} color={u.is_active?'#3b82f6':'#94a3b8'}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:15,fontWeight:700,color:'#0f172a'}}>{u.name}</div>
                <div style={{fontSize:12,color:'#3b82f6',fontWeight:600}}>{u.code}</div>
              </div>
              {isAdmin && (
                <div style={{display:'flex',gap:4}}>
                  <button onClick={()=>openEdit(u)} style={styles.iconBtn} title="Editar"><Icon name="edit" size={18} color="#3b82f6"/></button>
                  <button onClick={()=>toggleActive(u)} style={styles.iconBtn} title={u.is_active?'Desactivar':'Activar'}>
                    <Icon name={u.is_active?'toggle_on':'toggle_off'} size={22} color={u.is_active?'#22c55e':'#94a3b8'}/>
                  </button>
                </div>
              )}
            </div>
            <p style={{fontSize:13,color:'#475569',margin:'0 0 12px'}}>{u.description}</p>
            <div style={{fontSize:12,color:'#64748b',display:'flex',flexDirection:'column',gap:4}}>
              <div><Icon name="person" size={14} color="#94a3b8"/> {u.responsible_name||'—'}</div>
              <div><Icon name="email" size={14} color="#94a3b8"/> {u.email||'—'}</div>
              <div><Icon name="phone" size={14} color="#94a3b8"/> {u.phone||'—'}</div>
            </div>
            {!u.is_active && <div style={{marginTop:8,fontSize:11,color:'#ef4444',fontWeight:600}}>INACTIVA</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS VIEW (Admin Only)
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   EMAIL CONFIG VIEW (per user)
   ══════════════════════════════════════════════════════════════ */

function EmailConfigView(){
  const PROVIDERS=[
    {v:'gmail',l:'Gmail',imap:'imap.gmail.com',smtp:'smtp.gmail.com',iport:993,sport:587},
    {v:'outlook',l:'Outlook / Hotmail',imap:'outlook.office365.com',smtp:'smtp.office365.com',iport:993,sport:587},
    {v:'yahoo',l:'Yahoo Mail',imap:'imap.mail.yahoo.com',smtp:'smtp.mail.yahoo.com',iport:993,sport:587},
    {v:'institutional',l:'Correo Institucional (PGR)',imap:'imap.pgr.gob.sv',smtp:'smtp.pgr.gob.sv',iport:993,sport:587},
    {v:'other',l:'Otro (personalizado)',imap:'',smtp:'',iport:993,sport:587},
  ];

  const [config,setConfig]=useState({email_address:'',imap_host:'',imap_port:993,imap_secure:true,smtp_host:'',smtp_port:587,smtp_secure:true,email_password:'',provider:'institutional',is_active:false});
  const [loading,setLoading]=useState(true);
  const [saved,setSaved]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);
  const [syncing,setSyncing]=useState(false);
  const [syncResult,setSyncResult]=useState(null);

  useEffect(()=>{
    (async()=>{
      const res=await apiFetch('/email-config');
      if(res.success && res.data){
        setConfig({
          email_address:res.data.email_address||'',
          imap_host:res.data.imap_host||'',
          imap_port:res.data.imap_port||993,
          imap_secure:!!res.data.imap_secure,
          smtp_host:res.data.smtp_host||'',
          smtp_port:res.data.smtp_port||587,
          smtp_secure:!!res.data.smtp_secure,
          email_password:res.data.email_password||'',
          provider:res.data.provider||'other',
          is_active:!!res.data.is_active,
        });
      }
      setLoading(false);
    })();
  },[]);

  function upd(k,v){setConfig(p=>({...p,[k]:v}));setSaved(false);}

  function selectProvider(prov){
    const p=PROVIDERS.find(x=>x.v===prov);
    if(p){
      setConfig(prev=>({...prev, provider:prov, imap_host:p.imap||prev.imap_host, smtp_host:p.smtp||prev.smtp_host, imap_port:p.iport||993, smtp_port:p.sport||587}));
      setSaved(false);
    }
  }

  async function save(e){
    e.preventDefault();
    await apiFetch('/email-config',{method:'PUT',body:JSON.stringify(config)});
    setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  async function testConnection(){
    setTesting(true); setTestResult(null);
    const res = await apiFetch('/email-config/test',{method:'POST',body:JSON.stringify(config)});
    if(res.success){
      const { imap, smtp } = res.data;
      setTestResult({ok:imap.ok&&smtp.ok,message:`${imap.message} | ${smtp.message}`});
    } else {
      setTestResult({ok:false,message:res.message||'Error al probar la conexión'});
    }
    setTesting(false);
  }

  async function syncNow(){
    setSyncing(true); setSyncResult(null);
    const res = await apiFetch('/email-config/sync',{method:'POST',body:JSON.stringify({limit:20})});
    if(res.success){
      const d=res.data;
      setSyncResult({ok:true,message:`Sincronización completa: ${d.imported} correo(s) importado(s), ${d.skipped} ya existente(s), ${d.classified} clasificado(s) con IA. Buzón: ${d.total} mensaje(s).`});
    } else {
      setSyncResult({ok:false,message:res.message||'Error al sincronizar'});
    }
    setSyncing(false);
  }

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando configuración de correo...</p></div>;

  return (
    <div style={{padding:0}}>
      <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
        <Icon name="mail_lock" size={22} color="#64748b"/>Configuración de Correo Electrónico
      </h3>

      {/* Status card */}
      <div style={{...styles.card,marginBottom:16,background:config.is_active?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'linear-gradient(135deg,#fef2f2,#fee2e2)',border:`1px solid ${config.is_active?'#86efac':'#fca5a5'}`}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <Icon name={config.is_active?'mark_email_read':'mail_lock'} size={28} color={config.is_active?'#16a34a':'#dc2626'}/>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:config.is_active?'#166534':'#991b1b'}}>
              {config.is_active?'Lectura de correo ACTIVA':'Lectura de correo INACTIVA'}
            </div>
            <div style={{fontSize:13,color:config.is_active?'#15803d':'#b91c1c'}}>
              {config.is_active?`Sincronizando con ${config.email_address}`:'Configure su cuenta para habilitar la lectura de correo electrónico'}
            </div>
          </div>
          <div style={{marginLeft:'auto'}}>
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <span style={{fontSize:13,fontWeight:600,color:'#475569'}}>{config.is_active?'Activado':'Desactivado'}</span>
              <div onClick={()=>upd('is_active',!config.is_active)} style={{width:44,height:24,borderRadius:12,background:config.is_active?'#22c55e':'#cbd5e1',position:'relative',cursor:'pointer',transition:'background 0.2s'}}>
                <div style={{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:config.is_active?22:2,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Provider selection */}
      <div style={{...styles.card,marginBottom:16}}>
        <div style={styles.cardHeader}>
          <Icon name="dns" size={20} color="#3b82f6"/>
          <h4 style={{...styles.cardTitle,margin:0}}>Proveedor de correo</h4>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10,marginTop:12}}>
          {PROVIDERS.map(p=>(
            <button key={p.v} onClick={()=>selectProvider(p.v)} style={{padding:'12px 16px',borderRadius:10,border:`2px solid ${config.provider===p.v?'#3b82f6':'#e2e8f0'}`,background:config.provider===p.v?'#eff6ff':'#fff',cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}>
              <div style={{fontSize:14,fontWeight:600,color:config.provider===p.v?'#1e40af':'#334155'}}>{p.l}</div>
              {p.imap && <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{p.imap}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Config form */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <Icon name="settings" size={20} color="#3b82f6"/>
          <h4 style={{...styles.cardTitle,margin:0}}>Configuración de la cuenta</h4>
        </div>

        <form onSubmit={save} style={{marginTop:16}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div style={{gridColumn:'1/-1'}}>
              <label style={styles.label}>Dirección de correo electrónico *</label>
              <input style={styles.input} type="email" value={config.email_address} onChange={e=>upd('email_address',e.target.value)} placeholder="usuario@pgr.gob.sv" required/>
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <label style={styles.label}>Contraseña / App Password *</label>
              <input style={styles.input} type="password" value={config.email_password} onChange={e=>upd('email_password',e.target.value)} placeholder="Contraseña de la cuenta de correo"/>
              <span style={{fontSize:11,color:'#94a3b8'}}>Para Gmail/Outlook use una "App Password" generada en la configuración de seguridad de su cuenta.</span>
            </div>
          </div>

          <div style={{marginTop:20,marginBottom:12,padding:'12px 16px',background:'#f8fafc',borderRadius:10,border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#334155',marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
              <Icon name="download" size={18} color="#3b82f6"/>Servidor de entrada (IMAP)
            </div>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:10}}>
              <div>
                <label style={styles.label}>Host IMAP</label>
                <input style={styles.input} value={config.imap_host} onChange={e=>upd('imap_host',e.target.value)} placeholder="imap.ejemplo.com"/>
              </div>
              <div>
                <label style={styles.label}>Puerto</label>
                <input style={styles.input} type="number" value={config.imap_port} onChange={e=>upd('imap_port',Number(e.target.value))}/>
              </div>
              <div>
                <label style={styles.label}>SSL/TLS</label>
                <select style={styles.select} value={config.imap_secure?'1':'0'} onChange={e=>upd('imap_secure',e.target.value==='1')}>
                  <option value="1">Sí (SSL)</option>
                  <option value="0">No</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{marginBottom:16,padding:'12px 16px',background:'#f8fafc',borderRadius:10,border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#334155',marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
              <Icon name="upload" size={18} color="#8b5cf6"/>Servidor de salida (SMTP)
            </div>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:10}}>
              <div>
                <label style={styles.label}>Host SMTP</label>
                <input style={styles.input} value={config.smtp_host} onChange={e=>upd('smtp_host',e.target.value)} placeholder="smtp.ejemplo.com"/>
              </div>
              <div>
                <label style={styles.label}>Puerto</label>
                <input style={styles.input} type="number" value={config.smtp_port} onChange={e=>upd('smtp_port',Number(e.target.value))}/>
              </div>
              <div>
                <label style={styles.label}>STARTTLS</label>
                <select style={styles.select} value={config.smtp_secure?'1':'0'} onChange={e=>upd('smtp_secure',e.target.value==='1')}>
                  <option value="1">Sí (TLS)</option>
                  <option value="0">No</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{display:'flex',gap:12}}>
            <button type="submit" style={{...styles.submitBtn,flex:1}}>{saved?'✓ Guardado':'Guardar Configuración'}</button>
            <button type="button" onClick={testConnection} disabled={testing} style={{...styles.submitBtn,flex:1,background:testing?'#475569':'linear-gradient(135deg,#8b5cf6,#a855f7)'}}>
              {testing?'Probando conexión real...':'Probar Conexión'}
            </button>
            <button type="button" onClick={syncNow} disabled={syncing||!config.is_active} title={!config.is_active?'Active y guarde la configuración primero':''}
              style={{...styles.submitBtn,flex:1,background:syncing?'#475569':config.is_active?'linear-gradient(135deg,#059669,#10b981)':'#cbd5e1'}}>
              {syncing?'Sincronizando...':'Sincronizar Ahora'}
            </button>
          </div>
        </form>

        {testResult && (
          <div style={{marginTop:16,padding:'12px 16px',borderRadius:10,background:testResult.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',border:`1px solid ${testResult.ok?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,display:'flex',alignItems:'center',gap:10}}>
            <Icon name={testResult.ok?'check_circle':'error'} size={22} color={testResult.ok?'#22c55e':'#ef4444'}/>
            <span style={{fontSize:13,color:testResult.ok?'#16a34a':'#dc2626'}}>{testResult.message}</span>
          </div>
        )}
        {syncResult && (
          <div style={{marginTop:10,padding:'12px 16px',borderRadius:10,background:syncResult.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',border:`1px solid ${syncResult.ok?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,display:'flex',alignItems:'center',gap:10}}>
            <Icon name={syncResult.ok?'cloud_done':'error'} size={22} color={syncResult.ok?'#22c55e':'#ef4444'}/>
            <span style={{fontSize:13,color:syncResult.ok?'#16a34a':'#dc2626'}}>{syncResult.message}</span>
          </div>
        )}
      </div>

      {/* Info card */}
      <div style={{...styles.card,marginTop:16,background:'#eff6ff',border:'1px solid #bfdbfe'}}>
        <div style={{display:'flex',gap:12}}>
          <Icon name="info" size={22} color="#3b82f6"/>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:'#1e40af',marginBottom:4}}>Información importante</div>
            <ul style={{fontSize:13,color:'#1e3a5f',margin:0,paddingLeft:16,lineHeight:1.8}}>
              <li>Su contraseña de correo se almacena de forma segura en el servidor.</li>
              <li>Para <strong>Gmail</strong>: Active "Acceso de apps menos seguras" o genere una App Password en <em>Seguridad → Contraseñas de aplicaciones</em>.</li>
              <li>Para <strong>Outlook</strong>: Use su contraseña normal o genere una App Password si tiene 2FA activado.</li>
              <li>Use "Sincronizar Ahora" para importar los últimos correos de su buzón al sistema; si Gemini está activo, se clasifican automáticamente con IA.</li>
              <li>Solo se leen correos; nunca se eliminan ni modifican mensajes de su buzón original.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS VIEW (Admin only)
   ══════════════════════════════════════════════════════════════ */

function SettingsView({ userRole, currentUserId, initialTab }){
  const [subTab,setSubTab]=useState(initialTab||'tracking');
  /* El tab de Gemini API solo existe para la cuenta de administrador general */
  const tabs=[
    {id:'tracking',icon:'monitoring',label:'Seguimiento de Proyectos'},
    {id:'users',icon:'people',label:'Gestión de Usuarios'},
    {id:'alerts_mgmt',icon:'notification_add',label:'Gestión de Alertas'},
    ...(userRole==='admin'?[
      {id:'gemini',icon:'psychology',label:'Gemini Pro API'},
      {id:'audit',icon:'verified_user',label:'Bitácora'},
    ]:[]),
  ];
  return (
    <div style={{padding:0}}>
      <h3 style={{fontSize:18,fontWeight:700,color:'#0f172a',marginBottom:16,display:'flex',alignItems:'center',gap:8}}><Icon name="settings" size={22} color="#64748b"/>Configuración del Sistema</h3>
      <div style={styles.filterBar}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setSubTab(t.id)} style={{...styles.filterTab,...(subTab===t.id?styles.filterTabActive:{}),display:'flex',alignItems:'center',gap:6}}>
            <Icon name={t.icon} size={18} color={subTab===t.id?'#fff':'#64748b'}/>{t.label}
          </button>
        ))}
      </div>
      {subTab==='tracking'&&<SettingsTrackingTab userRole={userRole}/>}
      {subTab==='users'&&<SettingsUsersTab userRole={userRole} currentUserId={currentUserId}/>}
      {subTab==='alerts_mgmt'&&<SettingsAlertsTab/>}
      {subTab==='gemini'&&userRole==='admin'&&<SettingsGeminiTab/>}
      {subTab==='audit'&&userRole==='admin'&&<SettingsAuditTab/>}
    </div>
  );
}

/* ── Users Management Tab ── */
function SettingsUsersTab({ userRole, currentUserId }){
  const [users,setUsers]=useState([]);
  const [units,setUnits]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const emptyUserForm={name:'',document_type:'DUI',document_number:'',email:'',phone:'',position:'',password:'',role:'solicitante',unit_id:''};
  const [form,setForm]=useState(emptyUserForm);
  const [error,setError]=useState('');
  const [createdInfo,setCreatedInfo]=useState(null); // {name, doc, tempPassword} mostrado al admin tras crear

  function genTempPassword(){
    // clave temporal legible: 3 sílabas + 3 dígitos + símbolo (≥8, letras y números)
    const con='bcdfgmprstv', vow='aeiou';
    let p='';
    for(let i=0;i<3;i++) p+=con[Math.floor(Math.random()*con.length)]+vow[Math.floor(Math.random()*vow.length)];
    p=p[0].toUpperCase()+p.slice(1)+Math.floor(100+Math.random()*900)+'!';
    setForm(f=>({...f,password:p}));
  }

  /* Login como: respalda la sesión del admin y entra a la cuenta del usuario */
  async function loginAs(u){
    if(!window.confirm(`¿Iniciar sesión como ${u.name}? Podrás volver a tu cuenta de administrador en cualquier momento.`)) return;
    const res=await apiFetch(`/admin/impersonate/${u.id}`,{method:'POST'});
    if(!res.success){ alert(res.message||'No se pudo iniciar la sesión de control'); return; }
    const backup={ token:localStorage.getItem(STORAGE_TOKEN), user:JSON.parse(localStorage.getItem(STORAGE_USER)||'null') };
    localStorage.setItem(STORAGE_ADMIN_BACKUP, JSON.stringify(backup));
    localStorage.setItem(STORAGE_TOKEN, res.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(res.user));
    window.location.reload();
  }

  const load=useCallback(async()=>{
    setLoading(true);
    const [uRes,unRes]=await Promise.all([apiFetch('/admin/users'),apiFetch('/units')]);
    if(uRes.success) setUsers(uRes.data);
    if(unRes.success) setUnits(unRes.data);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);
  function upd(k,v){setForm(p=>({...p,[k]:v}));}

  function openCreate(){
    setEditing(null);
    setForm(emptyUserForm);
    setShowForm(true); setError(''); setCreatedInfo(null);
  }
  function openEdit(u){
    setEditing(u);
    setForm({name:u.name,document_type:u.document_type,document_number:u.document_number,email:u.email||'',phone:u.phone||'',position:u.position||'',password:'',role:u.role,unit_id:u.unit_id||''});
    setShowForm(true); setError(''); setCreatedInfo(null);
  }

  async function handleSubmit(e){
    e.preventDefault(); setError('');
    const body={...form,unit_id:form.unit_id?Number(form.unit_id):null};
    let res;
    if(editing){
      if(!body.password) delete body.password;
      else if(body.password.length<8) return setError('La nueva clave temporal debe tener al menos 8 caracteres');
      res=await apiFetch(`/admin/users/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});
      if(res.success&&body.password) setCreatedInfo({name:form.name,doc:form.document_number,tempPassword:body.password,reset:true});
    } else {
      if(!body.password||body.password.length<8) return setError('La clave temporal debe tener al menos 8 caracteres (use "Generar")');
      res=await apiFetch('/admin/users',{method:'POST',body:JSON.stringify(body)});
      if(res.success) setCreatedInfo({name:form.name,doc:form.document_number,tempPassword:body.password});
    }
    if(res.success){setShowForm(false);load();}
    else setError(res.message||'Error');
  }

  async function toggleUser(u){
    if(u.is_active) await apiFetch(`/admin/users/${u.id}`,{method:'DELETE'});
    else await apiFetch(`/admin/users/${u.id}`,{method:'PUT',body:JSON.stringify({...u,is_active:1,name:u.name})});
    load();
  }

  const ROLES=[{v:'admin',l:'Administrador'},{v:'jefe_uacp',l:'Jefe UACP'},{v:'analista',l:'Analista'},{v:'solicitante',l:'Solicitante'}];
  const ROLE_COLORS={admin:'#ef4444',jefe_uacp:'#8b5cf6',analista:'#3b82f6',solicitante:'#22c55e'};

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando usuarios...</p></div>;

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'16px 0'}}>
        <span style={{fontSize:14,color:'#64748b'}}>{users.length} usuarios registrados</span>
        <button onClick={openCreate} style={styles.actionBtn}><Icon name="person_add" size={20} color="#fff"/><span>Nuevo Usuario</span></button>
      </div>

      {/* Credenciales temporales del usuario recién creado/reseteado — visible solo ahora */}
      {createdInfo&&(
        <div style={{...styles.card,marginBottom:16,background:'#f0fdf4',border:'2px solid #22c55e'}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
            <Icon name="key" size={26} color="#16a34a"/>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:'#166534'}}>
                {createdInfo.reset?'Clave temporal reseteada para':'Usuario creado:'} {createdInfo.name}
              </div>
              <div style={{fontSize:13,color:'#15803d',marginTop:4}}>
                Documento: <strong>{createdInfo.doc}</strong> · Clave temporal:
                <code style={{margin:'0 6px',padding:'3px 10px',borderRadius:6,background:'#dcfce7',fontWeight:700,fontSize:14}}>{createdInfo.tempPassword}</code>
                <button onClick={()=>navigator.clipboard?.writeText(createdInfo.tempPassword)} style={{...styles.iconBtn,verticalAlign:'middle'}} title="Copiar clave"><Icon name="content_copy" size={16} color="#16a34a"/></button>
              </div>
              <div style={{fontSize:12,color:'#15803d',marginTop:4}}>
                ⚠ Cópiela y entréguela por un canal seguro — <strong>no volverá a mostrarse</strong>. El usuario deberá cambiarla en su primer inicio de sesión.
              </div>
            </div>
            <button onClick={()=>setCreatedInfo(null)} style={styles.iconBtn}><Icon name="close" size={18} color="#16a34a"/></button>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{...styles.card,marginBottom:16,border:'2px solid #3b82f6'}}>
          <h4 style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:16}}>{editing?'Editar Usuario':'Nuevo Usuario'}</h4>
          {error&&<div style={styles.errorBox}><Icon name="error" size={18} color="#dc2626"/><span>{error}</span></div>}
          <form onSubmit={handleSubmit}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={styles.label}>Nombre *</label><input style={styles.input} value={form.name} onChange={e=>upd('name',e.target.value)} required/></div>
              <div><label style={styles.label}>Cargo</label><input style={styles.input} value={form.position} onChange={e=>upd('position',e.target.value)} placeholder="Ej.: Analista de Compras"/></div>
              <div><label style={styles.label}>Correo</label><input style={styles.input} type="email" value={form.email} onChange={e=>upd('email',e.target.value)}/></div>
              <div><label style={styles.label}>Teléfono</label><input style={styles.input} value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="Ej.: 2231-9400"/></div>
              <div><label style={styles.label}>Tipo Doc.</label><select style={styles.select} value={form.document_type} onChange={e=>upd('document_type',e.target.value)}><option>DUI</option><option>Pasaporte</option></select></div>
              <div><label style={styles.label}>Nº Documento *</label><input style={styles.input} value={form.document_number} onChange={e=>upd('document_number',e.target.value)} disabled={!!editing} required/></div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={styles.label}>Clave temporal {editing?'(dejar vacío para no resetear)':'*'}</label>
                <div style={{display:'flex',gap:8}}>
                  <input style={{...styles.input,flex:1,marginBottom:0,fontFamily:'Consolas,monospace'}} value={form.password} onChange={e=>upd('password',e.target.value)} placeholder={editing?'Sin cambios':'Mínimo 8 caracteres'}/>
                  <button type="button" onClick={genTempPassword} style={{padding:'0 16px',borderRadius:10,border:'none',cursor:'pointer',fontSize:13,fontWeight:700,color:'#fff',background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',whiteSpace:'nowrap'}}>
                    <Icon name="casino" size={16} color="#fff" style={{marginRight:4}}/>Generar
                  </button>
                </div>
                <span style={{fontSize:11,color:'#94a3b8'}}>El usuario estará <strong>obligado a cambiarla</strong> en su primer inicio de sesión. Compártala por un canal seguro.</span>
              </div>
              <div><label style={styles.label}>Rol</label><select style={styles.select} value={form.role} onChange={e=>upd('role',e.target.value)}>{ROLES.map(r=><option key={r.v} value={r.v}>{r.l}</option>)}</select></div>
              <div><label style={styles.label}>Unidad</label><select style={styles.select} value={form.unit_id} onChange={e=>upd('unit_id',e.target.value)}><option value="">Sin unidad</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            </div>
            <div style={{display:'flex',gap:12,marginTop:16}}>
              <button type="submit" style={styles.submitBtn}>{editing?'Guardar':'Crear Usuario'}</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{...styles.submitBtn,background:'#64748b'}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={styles.card}>
        <div style={{overflowX:'auto'}}>
          <table style={styles.table}>
            <thead><tr>
              <th style={styles.th}>Usuario</th><th style={styles.th}>Documento</th><th style={styles.th}>Correo</th>
              <th style={styles.th}>Rol</th><th style={styles.th}>Unidad</th><th style={styles.th}>Estado</th><th style={styles.th}>Acciones</th>
            </tr></thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id} style={{...styles.tr,...(!u.is_active?{opacity:0.5}:{})}}>
                  <td style={styles.td}><div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:32,height:32,borderRadius:'50%',background:ROLE_COLORS[u.role]||'#94a3b8',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:13}}>{(u.name||'?')[0]}</div>
                    <div>
                      <div style={{fontWeight:600}}>{u.name} {!!u.must_change_password&&<span style={{...styles.tagTiny,background:'#f59e0b',marginLeft:4}} title="Aún no cambia su clave temporal">CLAVE TEMPORAL</span>}</div>
                      {(u.position||u.phone)&&<div style={{fontSize:11,color:'#94a3b8'}}>{u.position||''}{u.position&&u.phone?' · ':''}{u.phone||''}</div>}
                    </div>
                  </div></td>
                  <td style={styles.td}><span style={{fontSize:12}}>{u.document_type}: {u.document_number}</span></td>
                  <td style={styles.td}>{u.email||'—'}</td>
                  <td style={styles.td}><span style={{...styles.tagSmall,background:ROLE_COLORS[u.role]||'#94a3b8'}}>{ROLES.find(r=>r.v===u.role)?.l||u.role}</span></td>
                  <td style={styles.td}>{u.unit_name||'—'}</td>
                  <td style={styles.td}><span style={{...styles.tagSmall,background:u.is_active?'#22c55e':'#ef4444'}}>{u.is_active?'Activo':'Inactivo'}</span></td>
                  <td style={styles.td}>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>openEdit(u)} style={styles.iconBtn} title="Editar"><Icon name="edit" size={18} color="#3b82f6"/></button>
                      <button onClick={()=>toggleUser(u)} style={styles.iconBtn} title={u.is_active?'Desactivar':'Activar'}><Icon name={u.is_active?'person_off':'person'} size={18} color={u.is_active?'#ef4444':'#22c55e'}/></button>
                      {userRole==='admin'&&u.id!==currentUserId&&u.is_active&&(
                        <button onClick={()=>loginAs(u)} style={styles.iconBtn} title={`Iniciar sesión como ${u.name} (control de administrador)`}>
                          <Icon name="supervisor_account" size={18} color="#7c3aed"/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Alerts Management Tab ── */
function SettingsAlertsTab(){
  const [alerts,setAlerts]=useState([]);
  const [projects,setProjects]=useState([]);
  const [users,setUsers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({title:'',message:'',type:'info',project_id:'',user_id:'',trigger_date:''});
  const [error,setError]=useState('');
  const [scanning,setScanning]=useState(false);
  const [scanResult,setScanResult]=useState(null);

  async function runScan(){
    setScanning(true); setScanResult(null);
    const res=await apiFetch('/admin/alerts/scan',{method:'POST'});
    setScanResult(res.success?res.data:{error:res.message||'Error al escanear vencimientos'});
    setScanning(false);
    if(res.success) load();
  }

  const load=useCallback(async()=>{
    setLoading(true);
    const [aRes,pRes,uRes]=await Promise.all([apiFetch('/admin/alerts'),apiFetch('/projects'),apiFetch('/admin/users')]);
    if(aRes.success) setAlerts(aRes.data);
    if(pRes.success) setProjects(pRes.data);
    if(uRes.success) setUsers(uRes.data);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);
  function upd(k,v){setForm(p=>({...p,[k]:v}));}

  function openCreate(){
    setEditing(null);
    setForm({title:'',message:'',type:'info',project_id:'',user_id:'',trigger_date:''});
    setShowForm(true); setError('');
  }
  function openEdit(a){
    setEditing(a);
    setForm({title:a.title,message:a.message||'',type:a.type,project_id:a.project_id||'',user_id:a.user_id||'',trigger_date:a.trigger_date||''});
    setShowForm(true); setError('');
  }

  async function handleSubmit(e){
    e.preventDefault(); setError('');
    const body={...form,project_id:form.project_id?Number(form.project_id):null,user_id:form.user_id?Number(form.user_id):null};
    let res;
    if(editing) res=await apiFetch(`/admin/alerts/${editing.id}`,{method:'PUT',body:JSON.stringify(body)});
    else res=await apiFetch('/admin/alerts',{method:'POST',body:JSON.stringify(body)});
    if(res.success){setShowForm(false);load();}
    else setError(res.message||'Error');
  }

  async function deleteAlert(id){
    await apiFetch(`/admin/alerts/${id}`,{method:'DELETE'});
    load();
  }

  const ALERT_TYPES=[{v:'info',l:'Información',c:'#06b6d4'},{v:'deadline_warning',l:'Vencimiento',c:'#f59e0b'},{v:'deadline_expired',l:'Vencido',c:'#ef4444'},{v:'status_change',l:'Cambio Estado',c:'#3b82f6'},{v:'new_correspondence',l:'Correspondencia',c:'#8b5cf6'}];

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando alertas...</p></div>;

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'16px 0',gap:10,flexWrap:'wrap'}}>
        <span style={{fontSize:14,color:'#64748b'}}>{alerts.length} alertas en el sistema</span>
        <div style={{display:'flex',gap:10}}>
          <button onClick={runScan} disabled={scanning} title="Detecta proyectos vencidos, por vencer y sin actividad; genera alertas y análisis IA de riesgos"
            style={{...styles.actionBtn,background:scanning?'#94a3b8':'linear-gradient(135deg,#f59e0b,#f97316)'}}>
            <Icon name="radar" size={20} color="#fff"/><span>{scanning?'Escaneando...':'Escanear Vencimientos'}</span>
          </button>
          <button onClick={openCreate} style={styles.actionBtn}><Icon name="notification_add" size={20} color="#fff"/><span>Nueva Alerta</span></button>
        </div>
      </div>
      {scanResult&&(
        <div style={{...styles.card,marginBottom:16,background:scanResult.error?'#fef2f2':'#fffbeb',border:`1px solid ${scanResult.error?'#fca5a5':'#fcd34d'}`}}>
          <span style={{fontSize:13,color:scanResult.error?'#991b1b':'#92400e'}}>
            {scanResult.error||`Escaneo completo: ${scanResult.overdue} vencido(s), ${scanResult.upcoming} por vencer (7 días), ${scanResult.stale} sin actividad → ${scanResult.alertsCreated} alerta(s) nueva(s)${scanResult.aiDigest?' + análisis ejecutivo IA para administración':''}.`}
          </span>
        </div>
      )}

      {showForm && (
        <div style={{...styles.card,marginBottom:16,border:'2px solid #f59e0b'}}>
          <h4 style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:16}}>{editing?'Editar Alerta':'Nueva Alerta'}</h4>
          {error&&<div style={styles.errorBox}><Icon name="error" size={18} color="#dc2626"/><span>{error}</span></div>}
          <form onSubmit={handleSubmit}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1/-1'}}><label style={styles.label}>Título *</label><input style={styles.input} value={form.title} onChange={e=>upd('title',e.target.value)} required/></div>
              <div style={{gridColumn:'1/-1'}}><label style={styles.label}>Mensaje</label><textarea style={{...styles.input,minHeight:60,resize:'vertical'}} value={form.message} onChange={e=>upd('message',e.target.value)}/></div>
              <div><label style={styles.label}>Tipo</label><select style={styles.select} value={form.type} onChange={e=>upd('type',e.target.value)}>{ALERT_TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
              <div><label style={styles.label}>Fecha de Activación</label><input style={styles.input} type="date" value={form.trigger_date} onChange={e=>upd('trigger_date',e.target.value)}/></div>
              <div><label style={styles.label}>Proyecto</label><select style={styles.select} value={form.project_id} onChange={e=>upd('project_id',e.target.value)}><option value="">Sin proyecto</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
              <div><label style={styles.label}>Usuario Destino</label><select style={styles.select} value={form.user_id} onChange={e=>upd('user_id',e.target.value)}><option value="">Todos</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            </div>
            <div style={{display:'flex',gap:12,marginTop:16}}>
              <button type="submit" style={styles.submitBtn}>{editing?'Guardar':'Crear Alerta'}</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{...styles.submitBtn,background:'#64748b'}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div style={styles.card}>
        <div style={{overflowX:'auto'}}>
          <table style={styles.table}>
            <thead><tr>
              <th style={styles.th}>Tipo</th><th style={styles.th}>Título</th><th style={styles.th}>Mensaje</th>
              <th style={styles.th}>Proyecto</th><th style={styles.th}>Usuario</th><th style={styles.th}>Fecha</th><th style={styles.th}>Estado</th><th style={styles.th}>Acciones</th>
            </tr></thead>
            <tbody>
              {alerts.map(a=>{
                const at=ALERT_TYPES.find(t=>t.v===a.type);
                return (
                  <tr key={a.id} style={styles.tr}>
                    <td style={styles.td}><span style={{...styles.tagSmall,background:at?.c||'#94a3b8'}}>{at?.l||a.type}</span></td>
                    <td style={styles.td}><span style={{fontWeight:600}}>{a.title}</span></td>
                    <td style={styles.td}><span style={{fontSize:12,color:'#64748b'}}>{(a.message||'').slice(0,50)}{a.message?.length>50?'...':''}</span></td>
                    <td style={styles.td}>{a.project_title||'—'}</td>
                    <td style={styles.td}>{a.user_name||'Todos'}</td>
                    <td style={styles.td}>{formatDate(a.trigger_date)}</td>
                    <td style={styles.td}><span style={{...styles.tagSmall,background:a.is_read?'#94a3b8':'#22c55e'}}>{a.is_read?'Leída':'Pendiente'}</span></td>
                    <td style={styles.td}>
                      <div style={{display:'flex',gap:4}}>
                        <button onClick={()=>openEdit(a)} style={styles.iconBtn}><Icon name="edit" size={18} color="#3b82f6"/></button>
                        <button onClick={()=>deleteAlert(a.id)} style={styles.iconBtn}><Icon name="delete" size={18} color="#ef4444"/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Seguimiento general de proyectos (administrador) ── */
function SettingsTrackingTab({ userRole }){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [syncReport,setSyncReport]=useState(null);
  const [sysCfg,setSysCfg]=useState({email_sync_enabled:'false',email_sync_interval_minutes:'5',email_sync_limit:'20',annual_budget_year:String(new Date().getFullYear()),annual_budget_amount:'',min_wage_comercio:'365',baja_cuantia_limit:'',alert_scan_enabled:'true',alert_scan_interval_hours:'12'});
  const [cfgSaved,setCfgSaved]=useState(false);
  const [lastReport,setLastReport]=useState(null);

  const load=useCallback(async()=>{
    setLoading(true);
    const res=await apiFetch('/admin/projects/overview');
    if(res.success) setData(res.data);
    if(userRole==='admin'){
      const s=await apiFetch('/admin/settings');
      if(s.success){
        setSysCfg(prev=>({...prev,...Object.fromEntries(Object.entries(s.data).filter(([k])=>k.startsWith('email_sync_')||k.startsWith('annual_budget_')||k.startsWith('alert_scan_')||['min_wage_comercio','baja_cuantia_limit'].includes(k)))}));
        try{ if(s.data.email_sync_last_report) setLastReport(JSON.parse(s.data.email_sync_last_report)); }catch{/* reporte ilegible */}
      }
    }
    setLoading(false);
  },[userRole]);
  useEffect(()=>{load();},[load]);

  async function saveSysCfg(){
    const interval=Math.max(1,parseInt(sysCfg.email_sync_interval_minutes)||5);
    await apiFetch('/admin/settings',{method:'PUT',body:JSON.stringify({
      email_sync_enabled:sysCfg.email_sync_enabled,
      email_sync_interval_minutes:String(interval),
      email_sync_limit:String(Math.max(0,parseInt(sysCfg.email_sync_limit)||0)),
      annual_budget_year:String(parseInt(sysCfg.annual_budget_year)||new Date().getFullYear()),
      annual_budget_amount:String(parseFloat(sysCfg.annual_budget_amount)||0),
      min_wage_comercio:String(parseFloat(sysCfg.min_wage_comercio)||365),
      baja_cuantia_limit:String(parseFloat(sysCfg.baja_cuantia_limit)||0),
      alert_scan_enabled:sysCfg.alert_scan_enabled,
      alert_scan_interval_hours:String(Math.max(1,parseInt(sysCfg.alert_scan_interval_hours)||12)),
    })});
    setSysCfg(p=>({...p,email_sync_interval_minutes:String(interval)}));
    setCfgSaved(true); setTimeout(()=>setCfgSaved(false),3000);
  }

  async function syncAll(){
    setSyncing(true); setSyncReport(null);
    const res=await apiFetch('/admin/email-sync-all',{method:'POST',body:JSON.stringify({limit:20})});
    setSyncReport(res.success?res.data:{error:res.message||'Error al sincronizar la unidad'});
    setSyncing(false);
  }

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando seguimiento...</p></div>;
  const projects=data?.projects||[];
  const byStatus=data?.byStatus||[];

  return (
    <div style={{marginTop:16}}>
      {/* Configuración del sistema: auto-sync y presupuesto anual (solo admin general) */}
      {userRole==='admin'&&(
        <div style={{...styles.card,marginBottom:16}}>
          <div style={{...styles.cardHeader,marginBottom:12}}>
            <Icon name="tune" size={22} color="#0f172a"/><h3 style={styles.cardTitle}>Configuración del sistema</h3>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {/* Sincronización automática */}
            <div style={{padding:14,borderRadius:12,background:'#f8fafc',border:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <Icon name="schedule" size={18} color="#3b82f6"/>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>Sincronización automática de correo</span>
                <span style={{...styles.tagTiny,background:sysCfg.email_sync_enabled==='true'?'#22c55e':'#94a3b8',marginLeft:'auto'}}>{sysCfg.email_sync_enabled==='true'?'ACTIVA':'INACTIVA'}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div>
                  <label style={styles.label}>Estado</label>
                  <select style={styles.select} value={sysCfg.email_sync_enabled} onChange={e=>setSysCfg(p=>({...p,email_sync_enabled:e.target.value}))}>
                    <option value="true">Activada</option>
                    <option value="false">Desactivada</option>
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Cada (minutos)</label>
                  <input style={styles.input} type="number" min="1" value={sysCfg.email_sync_interval_minutes} onChange={e=>setSysCfg(p=>({...p,email_sync_interval_minutes:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Correos por ciclo (0 = todos)</label>
                  <input style={styles.input} type="number" min="0" value={sysCfg.email_sync_limit} onChange={e=>setSysCfg(p=>({...p,email_sync_limit:e.target.value}))}/>
                </div>
              </div>
              <p style={{fontSize:11,color:'#94a3b8',margin:'6px 0 0'}}>Mínimo 1 minuto. <strong>Correos por ciclo = 0</strong> importa todo el histórico del buzón (sin límite); un número &gt; 0 limita cuántos correos nuevos se traen por ciclo. El servidor clasifica con IA cada correo nuevo y nunca marca como leído (solo lectura). Los cambios aplican en el siguiente ciclo, sin reiniciar.</p>
              {lastReport&&(
                <div style={{marginTop:8,fontSize:12,color:'#475569',padding:'8px 10px',background:'#eff6ff',borderRadius:8}}>
                  Última ejecución: {formatDate(lastReport.at)} {new Date(lastReport.at).toLocaleTimeString('es-SV')} — {lastReport.mailboxes} buzón(es), {lastReport.imported} importado(s), {lastReport.classified} con IA{lastReport.failed?`, ${lastReport.failed} con error`:''} ({Math.round(lastReport.duration_ms/1000)}s)
                </div>
              )}
              {/* Escáner de vencimientos */}
              <div style={{display:'flex',alignItems:'center',gap:8,margin:'14px 0 10px',paddingTop:12,borderTop:'1px dashed #e2e8f0'}}>
                <Icon name="radar" size={18} color="#f59e0b"/>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>Escáner de vencimientos de proyectos</span>
                <span style={{...styles.tagTiny,background:sysCfg.alert_scan_enabled!=='false'?'#22c55e':'#94a3b8',marginLeft:'auto'}}>{sysCfg.alert_scan_enabled!=='false'?'ACTIVO':'INACTIVO'}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label style={styles.label}>Estado</label>
                  <select style={styles.select} value={sysCfg.alert_scan_enabled} onChange={e=>setSysCfg(p=>({...p,alert_scan_enabled:e.target.value}))}>
                    <option value="true">Activado</option>
                    <option value="false">Desactivado</option>
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Cada (horas)</label>
                  <input style={styles.input} type="number" min="1" value={sysCfg.alert_scan_interval_hours} onChange={e=>setSysCfg(p=>({...p,alert_scan_interval_hours:e.target.value}))}/>
                </div>
              </div>
              <p style={{fontSize:11,color:'#94a3b8',margin:'6px 0 0'}}>Detecta proyectos vencidos, por vencer (7 días) y sin actividad (14 días); genera alertas al responsable y, con Gemini, un análisis ejecutivo de riesgos para administración.</p>
            </div>
            {/* Presupuesto anual */}
            <div style={{padding:14,borderRadius:12,background:'#f8fafc',border:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <Icon name="account_balance" size={18} color="#059669"/>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>Presupuesto anual de compras</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:10}}>
                <div>
                  <label style={styles.label}>Año fiscal</label>
                  <input style={styles.input} type="number" value={sysCfg.annual_budget_year} onChange={e=>setSysCfg(p=>({...p,annual_budget_year:e.target.value}))}/>
                </div>
                <div>
                  <label style={styles.label}>Monto presupuestado (USD)</label>
                  <input style={styles.input} type="number" step="0.01" placeholder="0.00 = sin presupuesto definido" value={sysCfg.annual_budget_amount} onChange={e=>setSysCfg(p=>({...p,annual_budget_amount:e.target.value}))}/>
                </div>
              </div>
              <p style={{fontSize:11,color:'#94a3b8',margin:'6px 0 0'}}>El dashboard mostrará a toda la unidad el cumplimiento: comprometido vs. presupuestado, ejecutado y disponible.</p>
            </div>
            {/* Umbrales LCP */}
            <div style={{padding:14,borderRadius:12,background:'#f8fafc',border:'1px solid #e2e8f0',gridColumn:'1/-1'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <Icon name="gavel" size={18} color="#7c3aed"/>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>Umbrales LCP (Ley de Compras Públicas)</span>
                <span style={{fontSize:12,color:'#64748b',marginLeft:'auto'}}>Umbral competitivo vigente: <strong>{formatCurrency(240*(parseFloat(sysCfg.min_wage_comercio)||365))}</strong> (240 salarios mínimos)</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label style={styles.label}>Salario mínimo sector comercio (USD/mes)</label>
                  <input style={styles.input} type="number" step="0.01" value={sysCfg.min_wage_comercio} onChange={e=>setSysCfg(p=>({...p,min_wage_comercio:e.target.value}))}/>
                  <span style={{fontSize:11,color:'#94a3b8'}}>Define el umbral de 240 SM entre Comparación de Precios (Art. 40) y Licitación Competitiva (Art. 39).</span>
                </div>
                <div>
                  <label style={styles.label}>Límite institucional de Baja Cuantía (USD)</label>
                  <input style={styles.input} type="number" step="0.01" placeholder="0 = no definido" value={sysCfg.baja_cuantia_limit} onChange={e=>setSysCfg(p=>({...p,baja_cuantia_limit:e.target.value}))}/>
                  <span style={{fontSize:11,color:'#94a3b8'}}>La LCP delega este monto en la máxima autoridad (Art. 44). Se usa en el Asistente LCP; estas compras se excluyen de la PAC.</span>
                </div>
              </div>
            </div>
          </div>
          <button onClick={saveSysCfg} style={{...styles.submitBtn,width:'auto',marginTop:12}}>{cfgSaved?'✓ Guardado':'Guardar configuración'}</button>
        </div>
      )}

      {/* Sincronización de correos de toda la unidad */}
      <div style={{...styles.card,marginBottom:16,display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <Icon name="sync" size={26} color="#3b82f6"/>
        <div style={{flex:1,minWidth:240}}>
          <div style={{fontSize:15,fontWeight:700,color:'#0f172a'}}>Correo de toda la unidad</div>
          <div style={{fontSize:13,color:'#64748b'}}>Sincroniza los buzones IMAP de todos los usuarios con configuración activa; cada correo se organiza en el perfil de su dueño y se clasifica con IA.</div>
        </div>
        <button onClick={syncAll} disabled={syncing} style={{...styles.actionBtn,background:syncing?'#94a3b8':undefined}}>
          <Icon name="cloud_sync" size={18} color="#fff"/><span>{syncing?'Sincronizando unidad...':'Sincronizar toda la unidad'}</span>
        </button>
      </div>
      {syncReport&&(
        <div style={{...styles.card,marginBottom:16,background:syncReport.error?'#fef2f2':'#f0fdf4',border:`1px solid ${syncReport.error?'#fca5a5':'#86efac'}`}}>
          {syncReport.error?(
            <span style={{fontSize:13,color:'#991b1b'}}>{syncReport.error}</span>
          ):(
            <>
              <div style={{fontSize:14,fontWeight:700,color:'#166534',marginBottom:8}}>
                Sincronización de la unidad completa: {syncReport.totals.imported} correo(s) importado(s), {syncReport.totals.classified} clasificado(s) con IA{syncReport.totals.failed>0?`, ${syncReport.totals.failed} buzón(es) con error`:''}.
              </div>
              {syncReport.results.map(r=>(
                <div key={r.user_id} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:r.ok?'#15803d':'#b91c1c',padding:'2px 0'}}>
                  <Icon name={r.ok?'check_circle':'error'} size={16} color={r.ok?'#22c55e':'#ef4444'}/>
                  <strong>{r.user_name}</strong> ({r.email}): {r.ok?`${r.imported} importado(s), ${r.skipped} ya existente(s)`:r.message}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Resumen por estado */}
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        {byStatus.map(s=>(
          <div key={s.status} style={{padding:'10px 16px',borderRadius:12,background:'#fff',border:`2px solid ${STATUS_COLORS[s.status]||'#94a3b8'}`,display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:22,fontWeight:800,color:STATUS_COLORS[s.status]||'#475569'}}>{s.count}</span>
            <span style={{fontSize:12,fontWeight:600,color:'#475569'}}>{STATUS_LABELS[s.status]||s.status}</span>
          </div>
        ))}
      </div>

      {/* Tabla de seguimiento */}
      <div style={styles.card}>
        <div style={{...styles.cardHeader,marginBottom:12}}>
          <Icon name="monitoring" size={22} color="#3b82f6"/><h3 style={styles.cardTitle}>Estado de seguimiento por proyecto</h3>
          <button onClick={load} style={{...styles.iconBtn,marginLeft:'auto'}} title="Actualizar"><Icon name="refresh" size={20} color="#64748b"/></button>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Proyecto</th>
                <th style={styles.th}>Estado</th>
                <th style={styles.th}>Inicio</th>
                <th style={styles.th}>Fin</th>
                <th style={styles.th}>Límite</th>
                <th style={styles.th}>Responsable</th>
                <th style={styles.th}>Último seguimiento</th>
                <th style={styles.th}>Actividad</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p=>{
                const days=daysUntil(p.deadline);
                const overdue=p.deadline&&days<=0&&!['completado','cancelado'].includes(p.status);
                return (
                  <tr key={p.id} style={overdue?{background:'#fef2f2'}:{}}>
                    <td style={styles.td}>
                      <div style={{fontWeight:600,color:'#0f172a',maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.title}>{p.title}</div>
                      <div style={{fontSize:11,color:'#94a3b8'}}>{p.unit_name||'—'} · {p.category_name||'—'}</div>
                    </td>
                    <td style={styles.td}><span style={{...styles.tagTiny,background:STATUS_COLORS[p.status]||'#94a3b8'}}>{STATUS_LABELS[p.status]||p.status}</span></td>
                    <td style={styles.td}>{formatDate(p.start_date)}</td>
                    <td style={styles.td}>{formatDate(p.end_date)}</td>
                    <td style={{...styles.td,color:overdue?'#dc2626':undefined,fontWeight:overdue?700:400}}>{formatDate(p.deadline)}{overdue?' ⚠':''}</td>
                    <td style={styles.td}>{p.assigned_name||'Sin asignar'}</td>
                    <td style={styles.td}>
                      {p.last_event_title?(
                        <div>
                          <div style={{fontSize:12,color:'#334155',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.last_event_title}>{p.last_event_title}</div>
                          <div style={{fontSize:11,color:'#94a3b8'}}>{p.last_event_by||'Sistema'} · {formatDate(p.last_event_at)}</div>
                        </div>
                      ):<span style={{color:'#94a3b8'}}>Sin eventos</span>}
                    </td>
                    <td style={styles.td}>
                      <span title="Eventos de seguimiento" style={{marginRight:8}}><Icon name="timeline" size={14} color="#3b82f6"/> {p.events_count}</span>
                      <span title="Correos asociados" style={{marginRight:8}}><Icon name="mail" size={14} color="#06b6d4"/> {p.correspondences_count}</span>
                      {p.open_alerts>0&&<span title="Alertas sin atender" style={{color:'#dc2626',fontWeight:700}}><Icon name="warning" size={14} color="#ef4444"/> {p.open_alerts}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Bitácora de auditoría (solo administrador general) ── */
function SettingsAuditTab(){
  const PAGE=50;
  const [rows,setRows]=useState([]);
  const [total,setTotal]=useState(0);
  const [offset,setOffset]=useState(0);
  const [q,setQ]=useState('');
  const [onlyFailures,setOnlyFailures]=useState(false);
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [loading,setLoading]=useState(true);
  const [expanded,setExpanded]=useState(null);
  const [verify,setVerify]=useState(null);
  const [verifying,setVerifying]=useState(false);

  const load=useCallback(async(off=0)=>{
    setLoading(true); setExpanded(null);
    const params=new URLSearchParams({limit:PAGE,offset:off});
    if(q) params.set('q',q);
    if(onlyFailures) params.set('only_failures','1');
    if(from) params.set('from',from);
    if(to) params.set('to',to);
    const res=await apiFetch(`/admin/audit?${params}`);
    if(res.success){ setRows(res.data.rows); setTotal(res.data.total); setOffset(off); }
    setLoading(false);
  },[q,onlyFailures,from,to]);
  useEffect(()=>{load(0);},[load]);

  async function runVerify(){
    setVerifying(true); setVerify(null);
    const res=await apiFetch('/admin/audit/verify');
    setVerify(res.success?res.data:{ok:false,reason:res.message});
    setVerifying(false);
  }

  function exportCSV(){
    const head=['ID','Fecha/Hora','Usuario','Vía admin','Acción','Entidad','ID Entidad','Resultado','IP','Detalles','Hash'];
    const lines=rows.map(r=>[r.id,new Date(r.event_time).toLocaleString('es-SV'),r.user_name||'(anónimo)',r.impersonated_by||'',r.action,r.entity,r.entity_id||'',r.success?'OK':'FALLO',r.ip,r.details,r.row_hash]);
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const csv='﻿'+[head,...lines].map(l=>l.map(esc).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`Bitacora_PGR_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{marginTop:16}}>
      {/* Verificación de integridad */}
      <div style={{...styles.card,marginBottom:16,display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <Icon name="verified_user" size={26} color="#0f172a"/>
        <div style={{flex:1,minWidth:240}}>
          <div style={{fontSize:15,fontWeight:700,color:'#0f172a'}}>Bitácora de auditoría del sistema</div>
          <div style={{fontSize:13,color:'#64748b'}}>Cada registro está encadenado con hash SHA-256: cualquier alteración o borrado se detecta con la verificación de integridad. (DL 113/2024 — registro de acciones)</div>
        </div>
        <button onClick={runVerify} disabled={verifying} style={{...styles.actionBtn,background:verifying?'#94a3b8':'linear-gradient(135deg,#0f172a,#334155)'}}>
          <Icon name="policy" size={18} color="#fff"/><span>{verifying?'Verificando cadena...':'Verificar integridad'}</span>
        </button>
      </div>
      {verify&&(
        <div style={{...styles.card,marginBottom:16,background:verify.ok?'#f0fdf4':'#fef2f2',border:`2px solid ${verify.ok?'#22c55e':'#ef4444'}`}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <Icon name={verify.ok?'gpp_good':'gpp_bad'} size={26} color={verify.ok?'#16a34a':'#dc2626'}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:verify.ok?'#166534':'#991b1b'}}>
                {verify.ok?`✓ Cadena íntegra: ${verify.total} registro(s) verificados, sin alteraciones`:`⚠ INTEGRIDAD COMPROMETIDA en el registro #${verify.broken_at_id}`}
              </div>
              {!verify.ok&&<div style={{fontSize:13,color:'#b91c1c'}}>{verify.reason} — Reporte este hallazgo a la dirección y a auditoría interna.</div>}
              {verify.ok&&verify.last_hash&&<div style={{fontSize:11,color:'#15803d',fontFamily:'Consolas,monospace'}}>Hash de cierre: {verify.last_hash}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{...styles.card,marginBottom:16,display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div style={{flex:2,minWidth:200}}>
          <label style={styles.label}>Buscar (acción, usuario, módulo)</label>
          <input style={{...styles.input,marginBottom:0}} value={q} onChange={e=>setQ(e.target.value)} placeholder="Ej.: LOGIN_FALLIDO, projects, María..."/>
        </div>
        <div>
          <label style={styles.label}>Desde</label>
          <input style={{...styles.input,marginBottom:0}} type="date" value={from} onChange={e=>setFrom(e.target.value)}/>
        </div>
        <div>
          <label style={styles.label}>Hasta</label>
          <input style={{...styles.input,marginBottom:0}} type="date" value={to} onChange={e=>setTo(e.target.value)}/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'#475569',paddingBottom:10,cursor:'pointer'}}>
          <input type="checkbox" checked={onlyFailures} onChange={e=>setOnlyFailures(e.target.checked)} style={{accentColor:'#ef4444'}}/>Solo fallos
        </label>
        <button onClick={exportCSV} disabled={!rows.length} style={{...styles.actionBtn,background:'linear-gradient(135deg,#059669,#10b981)'}}>
          <Icon name="download" size={18} color="#fff"/><span>CSV</span>
        </button>
      </div>

      {/* Tabla */}
      <div style={styles.card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <span style={{fontSize:13,color:'#64748b'}}>{total} evento(s) · mostrando {offset+1}–{Math.min(offset+PAGE,total)}</span>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>load(Math.max(0,offset-PAGE))} disabled={offset===0} style={styles.iconBtn}><Icon name="chevron_left" size={20} color={offset===0?'#cbd5e1':'#475569'}/></button>
            <button onClick={()=>load(offset+PAGE)} disabled={offset+PAGE>=total} style={styles.iconBtn}><Icon name="chevron_right" size={20} color={offset+PAGE>=total?'#cbd5e1':'#475569'}/></button>
          </div>
        </div>
        {loading?<div style={styles.loading}><Icon name="hourglass_top" size={28} color="#94a3b8"/></div>:(
        <div style={{overflowX:'auto'}}>
          <table style={styles.table}>
            <thead><tr>
              <th style={styles.th}>#</th><th style={styles.th}>Fecha/Hora</th><th style={styles.th}>Usuario</th>
              <th style={styles.th}>Acción</th><th style={styles.th}>Módulo</th><th style={styles.th}>Resultado</th><th style={styles.th}>IP</th>
            </tr></thead>
            <tbody>
              {rows.length===0&&<tr><td colSpan={7} style={{...styles.td,textAlign:'center',color:'#94a3b8',padding:24}}>Sin eventos con los filtros actuales</td></tr>}
              {rows.map(r=>(
                <React.Fragment key={r.id}>
                  <tr onClick={()=>setExpanded(expanded===r.id?null:r.id)} style={{cursor:'pointer',...(r.success?{}:{background:'#fef2f2'})}}>
                    <td style={styles.td}>{r.id}</td>
                    <td style={styles.td}><span style={{fontSize:12,whiteSpace:'nowrap'}}>{new Date(r.event_time).toLocaleString('es-SV')}</span></td>
                    <td style={styles.td}>
                      <span style={{fontSize:12,fontWeight:600}}>{r.user_name||'(anónimo)'}</span>
                      {r.impersonated_by&&<span style={{...styles.tagTiny,background:'#7c3aed',marginLeft:4}} title={`Sesión de control del admin #${r.impersonated_by}`}>VÍA ADMIN</span>}
                    </td>
                    <td style={styles.td}><code style={{fontSize:11,color:'#334155'}}>{r.action}</code></td>
                    <td style={styles.td}><span style={{fontSize:12,color:'#64748b'}}>{r.entity}{r.entity_id?` #${r.entity_id}`:''}</span></td>
                    <td style={styles.td}><span style={{...styles.tagTiny,background:r.success?'#22c55e':'#ef4444'}}>{r.success?'OK':'FALLO'}</span></td>
                    <td style={styles.td}><span style={{fontSize:11,color:'#94a3b8'}}>{r.ip}</span></td>
                  </tr>
                  {expanded===r.id&&(
                    <tr><td colSpan={7} style={{...styles.td,background:'#f8fafc'}}>
                      <div style={{fontSize:12,color:'#475569',fontFamily:'Consolas,monospace',whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
                        {(()=>{try{return JSON.stringify(JSON.parse(r.details||'{}'),null,2);}catch{return r.details;}})()}
                      </div>
                      <div style={{fontSize:10,color:'#94a3b8',marginTop:6,fontFamily:'Consolas,monospace'}}>hash: {r.row_hash}</div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}

/* ── Gemini Pro API Tab ── */
function SettingsGeminiTab(){
  const [settings,setSettings]=useState({gemini_api_key:'',gemini_model:'gemini-2.5-flash',gemini_enabled:'false',gemini_temperature:'0.7',gemini_max_tokens:'1024'});
  const [loading,setLoading]=useState(true);
  const [saved,setSaved]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);

  useEffect(()=>{
    (async()=>{
      const res=await apiFetch('/admin/settings');
      if(res.success) setSettings(prev=>({...prev,...res.data}));
      setLoading(false);
    })();
  },[]);

  function upd(k,v){setSettings(p=>({...p,[k]:v}));setSaved(false);}

  async function save(e){
    e.preventDefault();
    await apiFetch('/admin/settings',{method:'PUT',body:JSON.stringify(settings)});
    setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  async function testConnection(){
    setTesting(true); setTestResult(null);
    const res = await apiFetch('/admin/gemini/test',{method:'POST',body:JSON.stringify({
      gemini_api_key:settings.gemini_api_key,
      gemini_model:settings.gemini_model,
    })});
    setTestResult({ok:!!res.success,message:res.message||(res.success?'Conexión exitosa':'Error al conectar con Gemini')});
    setTesting(false);
  }

  if(loading) return <div style={styles.loading}><Icon name="hourglass_top" size={32} color="#94a3b8"/><p>Cargando configuración...</p></div>;

  return (
    <div>
      <div style={{...styles.card,marginTop:16,background:'linear-gradient(135deg,#0f172a,#1e293b)',border:'1px solid #334155'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
          <div style={{width:48,height:48,borderRadius:14,background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Icon name="psychology" size={28} color="#fff"/>
          </div>
          <div>
            <h4 style={{fontSize:18,fontWeight:700,color:'#f1f5f9',margin:0}}>Google Gemini Pro</h4>
            <p style={{fontSize:13,color:'#94a3b8',margin:0}}>Clasificación inteligente de correspondencia y análisis predictivo</p>
          </div>
          <div style={{marginLeft:'auto'}}>
            <span style={{...styles.tagSmall,background:settings.gemini_enabled==='true'?'#22c55e':'#64748b'}}>{settings.gemini_enabled==='true'?'ACTIVO':'INACTIVO'}</span>
          </div>
        </div>

        <form onSubmit={save}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <div style={{gridColumn:'1/-1'}}>
              <label style={{...styles.label,color:'#94a3b8'}}>API Key</label>
              <input style={{...styles.input,background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155'}} type="password" value={settings.gemini_api_key} onChange={e=>upd('gemini_api_key',e.target.value)} placeholder="AIza..."/>
            </div>
            <div>
              <label style={{...styles.label,color:'#94a3b8'}}>Modelo</label>
              <select style={{...styles.select,background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155'}} value={settings.gemini_model} onChange={e=>upd('gemini_model',e.target.value)}>
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (preview)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (recomendado)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-flash-latest">Gemini Flash (última versión)</option>
              </select>
            </div>
            <div>
              <label style={{...styles.label,color:'#94a3b8'}}>Estado</label>
              <select style={{...styles.select,background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155'}} value={settings.gemini_enabled} onChange={e=>upd('gemini_enabled',e.target.value)}>
                <option value="true">Activado</option>
                <option value="false">Desactivado</option>
              </select>
            </div>
            <div>
              <label style={{...styles.label,color:'#94a3b8'}}>Temperatura ({settings.gemini_temperature})</label>
              <input type="range" min="0" max="1" step="0.1" value={settings.gemini_temperature} onChange={e=>upd('gemini_temperature',e.target.value)} style={{width:'100%',accentColor:'#3b82f6'}}/>
            </div>
            <div>
              <label style={{...styles.label,color:'#94a3b8'}}>Max Tokens</label>
              <input style={{...styles.input,background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155'}} type="number" value={settings.gemini_max_tokens} onChange={e=>upd('gemini_max_tokens',e.target.value)}/>
            </div>
          </div>

          <div style={{display:'flex',gap:12,marginTop:20}}>
            <button type="submit" style={{...styles.submitBtn,flex:1}}>{saved?'✓ Guardado':'Guardar Configuración'}</button>
            <button type="button" onClick={testConnection} disabled={testing} style={{...styles.submitBtn,flex:1,background:testing?'#475569':'linear-gradient(135deg,#8b5cf6,#a855f7)'}}>
              {testing?'Probando...':'Probar Conexión'}
            </button>
          </div>
        </form>

        {testResult && (
          <div style={{marginTop:16,padding:'12px 16px',borderRadius:10,background:testResult.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',border:`1px solid ${testResult.ok?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}`,display:'flex',alignItems:'center',gap:10}}>
            <Icon name={testResult.ok?'check_circle':'error'} size={22} color={testResult.ok?'#22c55e':'#ef4444'}/>
            <span style={{fontSize:13,color:testResult.ok?'#86efac':'#fca5a5'}}>{testResult.message}</span>
          </div>
        )}
      </div>

      <div style={{...styles.card,marginTop:16}}>
        <div style={styles.cardHeader}>
          <Icon name="auto_awesome" size={22} color="#f59e0b"/>
          <h3 style={styles.cardTitle}>Funciones IA Disponibles</h3>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {[
            {icon:'mail',title:'Clasificación de Correspondencia',desc:'Categoriza automáticamente correos por tipo, prioridad y proyecto asociado.',active:settings.gemini_enabled==='true'},
            {icon:'summarize',title:'Resumen Automático',desc:'Genera resúmenes concisos de correspondencia entrante.',active:settings.gemini_enabled==='true'},
            {icon:'trending_up',title:'Análisis Predictivo',desc:'Identifica riesgos de vencimiento y sugiere acciones preventivas.',active:settings.gemini_enabled==='true'},
            {icon:'smart_toy',title:'Asistente de Compras',desc:'Sugiere el método de contratación LCP según el monto y tipo de adquisición.',active:settings.gemini_enabled==='true'},
          ].map((f,i)=>(
            <div key={i} style={{padding:16,borderRadius:12,border:'1px solid #e2e8f0',background:f.active?'#f0fdf4':'#f8fafc'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <Icon name={f.icon} size={20} color={f.active?'#22c55e':'#94a3b8'}/>
                <span style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{f.title}</span>
                <span style={{...styles.tagTiny,background:f.active?'#22c55e':'#94a3b8',marginLeft:'auto'}}>{f.active?'ON':'OFF'}</span>
              </div>
              <p style={{fontSize:12,color:'#64748b',margin:0}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN APP (Dashboard Layout)
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   CAMBIO OBLIGATORIO DE CLAVE TEMPORAL (primer ingreso)
   A diferencia del onboarding, esta pantalla SÍ bloquea: la clave
   temporal la conoce el administrador y debe ser reemplazada.
   ══════════════════════════════════════════════════════════════ */

function ForcePasswordChange({ user, onChanged, onLogout }){
  const [current,setCurrent]=useState('');
  const [next,setNext]=useState('');
  const [confirm,setConfirm]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  const valid=next.length>=8&&/[A-Za-z]/.test(next)&&/[0-9]/.test(next);
  const match=next===confirm;

  async function submit(e){
    e.preventDefault(); setError('');
    if(!valid) return setError('La nueva contraseña debe tener al menos 8 caracteres e incluir letras y números');
    if(!match) return setError('La confirmación no coincide');
    setSaving(true);
    const res=await apiFetch('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})});
    setSaving(false);
    if(res.success) onChanged();
    else setError(res.message||'No se pudo cambiar la contraseña');
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:3000,background:'rgba(15,23,42,0.8)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{width:460,maxWidth:'100%',background:'#fff',borderRadius:20,boxShadow:'0 25px 70px rgba(0,0,0,0.4)',padding:'28px 32px'}}>
        <div style={{textAlign:'center',marginBottom:16}}>
          <div style={{width:60,height:60,borderRadius:'50%',background:'linear-gradient(135deg,#f59e0b,#f97316)',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
            <Icon name="lock_reset" size={32} color="#fff"/>
          </div>
          <h3 style={{fontSize:18,fontWeight:800,color:'#0f172a',margin:'12px 0 4px'}}>Cambio de contraseña requerido</h3>
          <p style={{fontSize:13,color:'#64748b',margin:0}}>
            Hola {user?.name?.split(' ')[0]}: tu cuenta fue creada con una <strong>clave temporal</strong>.
            Por seguridad debes definir tu contraseña personal antes de continuar.
          </p>
        </div>
        <form onSubmit={submit}>
          <label style={styles.label}>Clave temporal (la que te entregó el administrador)</label>
          <input style={styles.input} type="password" value={current} onChange={e=>setCurrent(e.target.value)} autoFocus required/>
          <label style={styles.label}>Nueva contraseña</label>
          <input style={styles.input} type="password" value={next} onChange={e=>setNext(e.target.value)} required/>
          <div style={{display:'flex',gap:10,fontSize:11,marginTop:-6,marginBottom:6}}>
            <span style={{color:next.length>=8?'#16a34a':'#94a3b8'}}>✓ 8+ caracteres</span>
            <span style={{color:/[A-Za-z]/.test(next)?'#16a34a':'#94a3b8'}}>✓ letras</span>
            <span style={{color:/[0-9]/.test(next)?'#16a34a':'#94a3b8'}}>✓ números</span>
          </div>
          <label style={styles.label}>Confirmar nueva contraseña</label>
          <input style={styles.input} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/>
          {confirm&&!match&&<div style={{fontSize:12,color:'#dc2626',marginTop:-6}}>La confirmación no coincide</div>}
          {error&&<div style={{marginTop:10,padding:'10px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fca5a5',fontSize:13,color:'#991b1b'}}>{error}</div>}
          <button type="submit" disabled={saving||!valid||!match||!current} style={{...styles.submitBtn,marginTop:14,opacity:saving||!valid||!match||!current?0.6:1}}>
            {saving?'Guardando...':'Establecer mi contraseña'}
          </button>
        </form>
        <button onClick={onLogout} style={{display:'block',margin:'12px auto 0',background:'none',border:'none',cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MI PERFIL — datos de contacto y cambio de contraseña
   ══════════════════════════════════════════════════════════════ */

function ProfileModal({ user, onClose, onUpdated }){
  const [email,setEmail]=useState(user?.email||'');
  const [phone,setPhone]=useState(user?.phone||'');
  const [profile,setProfile]=useState(null);
  const [saved,setSaved]=useState(false);
  const [pw,setPw]=useState({current:'',next:'',confirm:''});
  const [pwMsg,setPwMsg]=useState(null);

  useEffect(()=>{
    (async()=>{
      const res=await apiFetch('/auth/me');
      if(res.success){ setProfile(res.user); setEmail(res.user.email||''); setPhone(res.user.phone||''); }
    })();
  },[]);

  async function saveContact(e){
    e.preventDefault();
    const res=await apiFetch('/auth/profile',{method:'PUT',body:JSON.stringify({email,phone})});
    if(res.success){ setSaved(true); setTimeout(()=>setSaved(false),2500); onUpdated({email,phone}); }
  }

  async function changePw(e){
    e.preventDefault(); setPwMsg(null);
    if(pw.next!==pw.confirm) return setPwMsg({ok:false,text:'La confirmación no coincide'});
    const res=await apiFetch('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:pw.current,new_password:pw.next})});
    setPwMsg(res.success?{ok:true,text:'Contraseña actualizada correctamente'}:{ok:false,text:res.message||'Error'});
    if(res.success) setPw({current:'',next:'',confirm:''});
  }

  const ROLE_LABELS={admin:'Administrador',jefe_uacp:'Jefe UCP',analista:'Analista',solicitante:'Solicitante'};

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:1500,background:'rgba(15,23,42,0.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{width:480,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto',background:'#fff',borderRadius:18,boxShadow:'0 20px 60px rgba(0,0,0,0.3)',padding:'24px 28px'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <div style={{width:52,height:52,borderRadius:'50%',background:'#1e40af',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:800,fontSize:20}}>{(user?.name||'?')[0]}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>{user?.name}</div>
            <div style={{fontSize:12,color:'#64748b'}}>{ROLE_LABELS[user?.role]||user?.role}{profile?.position?` · ${profile.position}`:''}</div>
          </div>
          <button onClick={onClose} style={styles.iconBtn}><Icon name="close" size={20} color="#64748b"/></button>
        </div>

        {/* Datos fijos (los administra la UCP) */}
        <div style={{padding:'10px 14px',borderRadius:10,background:'#f8fafc',border:'1px solid #e2e8f0',marginBottom:14,fontSize:13,color:'#475569'}}>
          <div><strong>Documento:</strong> {user?.document_type} {user?.document_number}</div>
          {profile?.position&&<div><strong>Cargo:</strong> {profile.position}</div>}
          <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>Nombre, documento, cargo, rol y unidad los administra la UCP (Gestión de Usuarios).</div>
        </div>

        {/* Contacto editable */}
        <form onSubmit={saveContact}>
          <label style={styles.label}>Correo de contacto</label>
          <input style={styles.input} type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
          <label style={styles.label}>Teléfono</label>
          <input style={styles.input} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Ej.: 2231-9400"/>
          <button type="submit" style={{...styles.submitBtn,marginTop:4}}>{saved?'✓ Guardado':'Guardar datos de contacto'}</button>
        </form>

        {/* Cambio de contraseña */}
        <div style={{marginTop:18,paddingTop:14,borderTop:'1px dashed #e2e8f0'}}>
          <div style={{fontSize:14,fontWeight:700,color:'#0f172a',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
            <Icon name="lock" size={18} color="#64748b"/>Cambiar mi contraseña
          </div>
          <form onSubmit={changePw}>
            <input style={styles.input} type="password" value={pw.current} onChange={e=>setPw(p=>({...p,current:e.target.value}))} placeholder="Contraseña actual"/>
            <input style={styles.input} type="password" value={pw.next} onChange={e=>setPw(p=>({...p,next:e.target.value}))} placeholder="Nueva (8+ caracteres, letras y números)"/>
            <input style={styles.input} type="password" value={pw.confirm} onChange={e=>setPw(p=>({...p,confirm:e.target.value}))} placeholder="Confirmar nueva"/>
            {pwMsg&&<div style={{padding:'8px 12px',borderRadius:8,fontSize:13,marginBottom:8,background:pwMsg.ok?'#f0fdf4':'#fef2f2',color:pwMsg.ok?'#166534':'#991b1b',border:`1px solid ${pwMsg.ok?'#86efac':'#fca5a5'}`}}>{pwMsg.text}</div>}
            <button type="submit" disabled={!pw.current||!pw.next} style={{...styles.submitBtn,background:'#475569'}}>Actualizar contraseña</button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   GETTING STARTED — Asistente de configuración de correo (Gmail)
   Aparece solo en el primer inicio de sesión de un usuario nuevo.
   Nunca bloquea: siempre puede omitirse y configurarse después.
   ══════════════════════════════════════════════════════════════ */

function OnboardingWizard({ user, onFinish }){
  const [step,setStep]=useState(1);
  const [email,setEmail]=useState(user?.email&&user.email.includes('@gmail')?user.email:'');
  const [appPassword,setAppPassword]=useState('');
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);
  const [syncResult,setSyncResult]=useState(null);
  const [done,setDone]=useState(false);

  const gmailCfg={email_address:email.trim(),email_password:appPassword.replace(/\s/g,''),imap_host:'imap.gmail.com',imap_port:993,imap_secure:true,smtp_host:'smtp.gmail.com',smtp_port:587,smtp_secure:true,provider:'gmail',is_active:true};

  async function markDone(){ await apiFetch('/auth/onboarding-done',{method:'POST'}); onFinish(); }

  async function validateAndSave(){
    setTesting(true); setTestResult(null); setSyncResult(null);
    const test=await apiFetch('/email-config/test',{method:'POST',body:JSON.stringify(gmailCfg)});
    if(!test.success||!test.data?.imap?.ok){
      setTestResult({ok:false,message:test.data?.imap?.message||test.message||'No se pudo validar la conexión'});
      setTesting(false); return;
    }
    setTestResult({ok:true,message:test.data.imap.message});
    await apiFetch('/email-config',{method:'PUT',body:JSON.stringify(gmailCfg)});
    const sync=await apiFetch('/email-config/sync',{method:'POST',body:JSON.stringify({limit:10})});
    if(sync.success) setSyncResult(sync.data);
    await apiFetch('/auth/onboarding-done',{method:'POST'});
    setDone(true); setTesting(false);
  }

  const stepDots=(
    <div style={{display:'flex',gap:8,justifyContent:'center',margin:'4px 0 18px'}}>
      {[1,2,3].map(s=>(
        <div key={s} style={{width:s===step?28:10,height:10,borderRadius:5,transition:'all 0.3s',
          background:s<=step?'linear-gradient(135deg,#3b82f6,#8b5cf6)':'#e2e8f0'}}/>
      ))}
    </div>
  );

  return (
    <div style={{position:'fixed',inset:0,zIndex:2000,background:'rgba(15,23,42,0.65)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{width:560,maxWidth:'100%',maxHeight:'92vh',overflowY:'auto',background:'#fff',borderRadius:20,boxShadow:'0 25px 70px rgba(0,0,0,0.35)',padding:'28px 32px'}}>
        {/* Encabezado */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
          <div style={{width:46,height:46,borderRadius:14,background:'linear-gradient(135deg,#ea4335,#fbbc05)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Icon name="mail" size={26} color="#fff"/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:800,color:'#0f172a'}}>¡Bienvenido(a), {user?.name?.split(' ')[0]}!</div>
            <div style={{fontSize:13,color:'#64748b'}}>Configuremos tu correo Gmail en 3 pasos</div>
          </div>
          <button onClick={markDone} title="Podrás configurarlo después en Correo Electrónico"
            style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:'#94a3b8'}}>
            Omitir por ahora ✕
          </button>
        </div>
        {!done&&stepDots}

        {/* Paso 1: qué logra */}
        {step===1&&!done&&(
          <div>
            <h3 style={{fontSize:16,fontWeight:700,color:'#0f172a',margin:'0 0 12px'}}>¿Qué lograrás al conectar tu correo?</h3>
            {[
              ['sync','Tus correos de Gmail se sincronizan automáticamente con el sistema'],
              ['psychology','La IA clasifica cada correo por categoría, prioridad y genera resúmenes'],
              ['attach_file','Los documentos adjuntos quedan disponibles y se analizan en los expedientes'],
              ['account_tree','La correspondencia se organiza por proyecto de compra para su seguimiento'],
            ].map(([icon,text])=>(
              <div key={icon} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',marginBottom:8,borderRadius:12,background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                <Icon name={icon} size={22} color="#3b82f6"/>
                <span style={{fontSize:13,color:'#334155'}}>{text}</span>
              </div>
            ))}
            <div style={{display:'flex',gap:10,marginTop:18}}>
              <button onClick={()=>setStep(2)} style={{...styles.submitBtn,flex:1}}>Comenzar configuración</button>
            </div>
          </div>
        )}

        {/* Paso 2: App Password de Gmail */}
        {step===2&&!done&&(
          <div>
            <h3 style={{fontSize:16,fontWeight:700,color:'#0f172a',margin:'0 0 6px'}}>Genera tu "Contraseña de aplicación" de Google</h3>
            <p style={{fontSize:13,color:'#64748b',margin:'0 0 12px'}}>Gmail no permite usar tu contraseña normal en sistemas externos. Necesitas una <strong>App Password</strong> (es gratis y toma 2 minutos):</p>
            {[
              ['1','Activa la Verificación en 2 pasos de tu cuenta Google (si no la tienes)','https://myaccount.google.com/signinoptions/two-step-verification'],
              ['2','Abre "Contraseñas de aplicaciones" e inicia sesión','https://myaccount.google.com/apppasswords'],
              ['3','Escribe un nombre (ej. "PGR Compras") y pulsa Crear',null],
              ['4','Copia la contraseña de 16 letras que te muestra Google',null],
            ].map(([n,text,link])=>(
              <div key={n} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',marginBottom:8,borderRadius:12,background:'#fffbeb',border:'1px solid #fcd34d'}}>
                <div style={{width:26,height:26,borderRadius:'50%',background:'#f59e0b',color:'#fff',fontWeight:800,fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{n}</div>
                <span style={{fontSize:13,color:'#78350f',flex:1}}>{text}</span>
                {link&&<a href={link} target="_blank" rel="noreferrer" style={{fontSize:12,fontWeight:700,color:'#3b82f6',whiteSpace:'nowrap'}}>Abrir ↗</a>}
              </div>
            ))}
            <div style={{display:'flex',gap:10,marginTop:18}}>
              <button onClick={()=>setStep(1)} style={{...styles.submitBtn,background:'#64748b',flex:1}}>Atrás</button>
              <button onClick={()=>setStep(3)} style={{...styles.submitBtn,flex:2}}>Ya tengo mi App Password</button>
            </div>
          </div>
        )}

        {/* Paso 3: credenciales + validación real */}
        {step===3&&!done&&(
          <div>
            <h3 style={{fontSize:16,fontWeight:700,color:'#0f172a',margin:'0 0 12px'}}>Conecta tu cuenta</h3>
            <label style={styles.label}>Tu dirección de Gmail</label>
            <input style={styles.input} type="email" value={email} onChange={e=>{setEmail(e.target.value);setTestResult(null);}} placeholder="usuario@gmail.com"/>
            <label style={styles.label}>App Password (16 letras)</label>
            <input style={styles.input} type="password" value={appPassword} onChange={e=>{setAppPassword(e.target.value);setTestResult(null);}} placeholder="xxxx xxxx xxxx xxxx"/>
            <p style={{fontSize:11,color:'#94a3b8',margin:'2px 0 0'}}>Se conectará a imap.gmail.com (lectura) y smtp.gmail.com (envío). La validación es real: probamos la conexión con Google ahora mismo.</p>
            {testResult&&!testResult.ok&&(
              <div style={{marginTop:10,padding:'10px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fca5a5',fontSize:13,color:'#991b1b'}}>
                {testResult.message}
                {/credentials|password|username/i.test(testResult.message)&&<div style={{marginTop:6,fontSize:12}}>💡 Verifica que copiaste la App Password completa (no tu contraseña normal de Gmail) y que el correo es correcto.</div>}
              </div>
            )}
            <div style={{display:'flex',gap:10,marginTop:18}}>
              <button onClick={()=>setStep(2)} style={{...styles.submitBtn,background:'#64748b',flex:1}}>Atrás</button>
              <button onClick={validateAndSave} disabled={testing||!email.includes('@')||appPassword.replace(/\s/g,'').length<8}
                style={{...styles.submitBtn,flex:2,background:testing?'#94a3b8':undefined}}>
                {testing?'Validando con Gmail...':'Validar y conectar'}
              </button>
            </div>
          </div>
        )}

        {/* Éxito */}
        {done&&(
          <div style={{textAlign:'center',padding:'10px 0'}}>
            <Icon name="check_circle" size={64} color="#22c55e"/>
            <h3 style={{fontSize:18,fontWeight:800,color:'#0f172a',margin:'12px 0 6px'}}>¡Correo conectado!</h3>
            <p style={{fontSize:13,color:'#475569',margin:'0 0 10px'}}>{testResult?.message}</p>
            {syncResult&&(
              <div style={{padding:'10px 14px',borderRadius:10,background:'#f0fdf4',border:'1px solid #86efac',fontSize:13,color:'#166534',marginBottom:14}}>
                Primera sincronización: {syncResult.imported} correo(s) importado(s){syncResult.classified?`, ${syncResult.classified} clasificado(s) con IA`:''}. Buzón: {syncResult.total} mensaje(s).
              </div>
            )}
            <p style={{fontSize:12,color:'#94a3b8',margin:'0 0 14px'}}>Puedes ajustar la configuración o sincronizar de nuevo en la sección "Correo Electrónico".</p>
            <button onClick={onFinish} style={{...styles.submitBtn,width:'auto',padding:'12px 32px'}}>Ir a mi Bandeja de Entrada</button>
          </div>
        )}

        {!done&&(
          <p style={{fontSize:11,color:'#cbd5e1',textAlign:'center',margin:'16px 0 0'}}>
            Este paso es opcional — puedes omitirlo y configurar tu correo (Gmail, Outlook, institucional u otro) más tarde en <strong>Correo Electrónico</strong>.
          </p>
        )}
      </div>
    </div>
  );
}

function App(){
  const [user,setUser]=useState(()=>{
    try{ const u=localStorage.getItem(STORAGE_USER); return u?JSON.parse(u):null; }catch{ return null; }
  });
  const [page,setPage]=useState('login');
  // Navegación por URL (React Router): activeTab se deriva de la ruta.
  const navigate=useNavigate();
  const location=useLocation();
  const activeTab=(location.pathname.replace(/^\/+/,'').split('/')[0])||'dashboard';
  const setActiveTab=(t)=>navigate('/'+t);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [stats,setStats]=useState({});
  const [unreadCount,setUnreadCount]=useState(0);
  const [alertCount,setAlertCount]=useState(0);
  const [showProfile,setShowProfile]=useState(false);

  useEffect(()=>{
    if(user){ 
      setPage('app');
      loadStats();
    }
  },[user]);

  async function loadStats(){
    const res = await apiFetch('/dashboard/stats');
    if(res.success){
      setStats(res.data);
      setUnreadCount(res.data.unreadCorrespondences||0);
      setAlertCount(res.data.urgentAlerts||0);
    }
  }

  function logout(){
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_ADMIN_BACKUP);
    setUser(null);
    setPage('login');
  }

  /* Sesión "login como": el admin conserva su sesión respaldada y puede volver */
  const adminBackup = (()=>{ try{ const b=localStorage.getItem(STORAGE_ADMIN_BACKUP); return b?JSON.parse(b):null; }catch{ return null; } })();
  function returnToAdmin(){
    const b = adminBackup;
    if(!b) return;
    localStorage.setItem(STORAGE_TOKEN, b.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(b.user));
    localStorage.removeItem(STORAGE_ADMIN_BACKUP);
    window.location.reload();
  }

  if(page==='login') return <LoginPage onLogin={u=>{setUser(u);setPage('app');}} goRegister={()=>setPage('register')}/>;
  if(page==='register') return <RegisterPage onRegister={()=>setPage('login')} goLogin={()=>setPage('login')}/>;

  const ROLE_LABELS = { admin:'Administrador', jefe_uacp:'Jefe UACP', analista:'Analista', solicitante:'Solicitante' };

  function renderContent(){
    switch(activeTab){
      case 'dashboard': return <DashboardView stats={stats}/>;
      case 'inbox': return <InboxView/>;
      case 'starred': return <InboxView starred/>;
      case 'compose': return <ComposeView goBack={()=>setActiveTab('inbox')}/>;
      case 'projects': return <ProjectsView/>;
      case 'procurement': return <ProcurementView/>;
      case 'pac': return <PACView/>;
      case 'alerts': return <AlertsView/>;
      case 'units': return <UnitsView userRole={user?.role}/>;
      case 'email_config': return <EmailConfigView/>;
      case 'users_admin': return (user?.role==='admin'||user?.role==='jefe_uacp')?<SettingsView key="users" initialTab="users" userRole={user?.role} currentUserId={user?.id}/>:<DashboardView stats={stats}/>;
      case 'settings': return (user?.role==='admin'||user?.role==='jefe_uacp')?<SettingsView key="cfg" userRole={user?.role} currentUserId={user?.id}/>:<DashboardView stats={stats}/>;
      default: return <DashboardView stats={stats}/>;
    }
  }

  /* Getting Started: solo usuarios nuevos (onboarding_done === false estricto;
     sesiones antiguas sin el campo no lo ven) */
  function finishOnboarding(){
    const u={...user,onboarding_done:true};
    localStorage.setItem(STORAGE_USER,JSON.stringify(u));
    setUser(u);
    setActiveTab('inbox');
  }

  function patchUser(patch){
    const u={...user,...patch};
    localStorage.setItem(STORAGE_USER,JSON.stringify(u));
    setUser(u);
  }

  /* La clave temporal bloquea ANTES que cualquier otra cosa (excepto en sesión de control del admin) */
  const needsPasswordChange = user?.must_change_password===true && !adminBackup;

  return (
    <div style={styles.appContainer}>
      {needsPasswordChange&&<ForcePasswordChange user={user} onChanged={()=>patchUser({must_change_password:false})} onLogout={logout}/>}
      {!needsPasswordChange&&user?.onboarding_done===false&&<OnboardingWizard user={user} onFinish={finishOnboarding}/>}
      {showProfile&&<ProfileModal user={user} onClose={()=>setShowProfile(false)} onUpdated={patchUser}/>}
      <Sidebar activeTab={activeTab} setActiveTab={t=>{setActiveTab(t);if(t==='dashboard')loadStats();}} unreadCount={unreadCount} alertCount={alertCount} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} userRole={user?.role}/>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Banner de sesión impersonada */}
        {adminBackup&&(
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 20px',background:'linear-gradient(135deg,#7c3aed,#8b5cf6)',color:'#fff'}}>
            <Icon name="supervisor_account" size={20} color="#fff"/>
            <span style={{fontSize:13,fontWeight:600,flex:1}}>
              Sesión de control: estás viendo el sistema como {user?.name} ({user?.document_number}). Tu sesión de administrador está protegida.
            </span>
            <button onClick={returnToAdmin} style={{padding:'6px 14px',borderRadius:8,border:'none',cursor:'pointer',fontSize:12,fontWeight:700,color:'#7c3aed',background:'#fff'}}>
              Volver a administrador
            </button>
          </div>
        )}
        {/* Top Bar */}
        <header style={styles.topBar}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <h2 style={{fontSize:16,fontWeight:700,color:'#0f172a',margin:0}}>
              {activeTab==='dashboard'?'Dashboard':activeTab==='inbox'?'Bandeja de Entrada':activeTab==='starred'?'Destacados':activeTab==='compose'?'Redactar':activeTab==='projects'?'Proyectos':activeTab==='procurement'?'Procesos de Compra (LCP)':activeTab==='pac'?'Planificación Anual de Compras (PAC)':activeTab==='alerts'?'Alertas':activeTab==='units'?'Unidades':activeTab==='email_config'?'Correo Electrónico':activeTab==='users_admin'?'Gestión de Usuarios':activeTab==='settings'?'Configuración':''}
            </h2>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            <button onClick={()=>setActiveTab('alerts')} style={{background:'none',border:'none',cursor:'pointer',position:'relative'}}>
              <Icon name="notifications" size={24} color="#64748b"/>
              {alertCount>0 && <span style={styles.topBadge}>{alertCount}</span>}
            </button>
            <div onClick={()=>setShowProfile(true)} style={{...styles.userChip,cursor:'pointer'}} title="Mi Perfil — datos de contacto y contraseña">
              <div style={{width:32,height:32,borderRadius:'50%',background:'#1e40af',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:14}}>
                {(user?.name||'?')[0]}
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'#0f172a'}}>{user?.name}</div>
                <div style={{fontSize:11,color:'#64748b'}}>{ROLE_LABELS[user?.role]||user?.role}</div>
              </div>
            </div>
            <button onClick={logout} style={styles.logoutBtn} title="Cerrar sesión">
              <Icon name="logout" size={20} color="#64748b"/>
            </button>
          </div>
        </header>
        {/* Main Content */}
        <main style={styles.mainContent}>
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════ */

const styles = {
  /* Login */
  loginContainer: { display:'flex', minHeight:'100vh', fontFamily:'Inter,sans-serif' },
  loginLeft: { width:'45%', background:'linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1e40af 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:40 },
  loginRight: { flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:40, background:'#f8fafc' },
  loginBrand: { textAlign:'center', maxWidth:400 },
  loginLogo: { width:80, height:80, borderRadius:20, background:'rgba(255,255,255,0.15)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:20, border:'2px solid rgba(255,255,255,0.2)' },
  loginTitle: { color:'#fff', fontSize:42, fontWeight:900, margin:0, fontFamily:'Poppins,sans-serif', letterSpacing:2 },
  loginSubtitle: { color:'rgba(255,255,255,0.7)', fontSize:14, marginTop:4 },
  loginDivider: { width:60, height:3, background:'rgba(255,255,255,0.3)', margin:'20px auto', borderRadius:2 },
  loginSystemName: { color:'#fff', fontSize:22, fontWeight:700, margin:'0 0 8px' },
  loginSystemDesc: { color:'rgba(255,255,255,0.6)', fontSize:13, margin:0 },
  loginFeatures: { marginTop:30, display:'flex', flexDirection:'column', gap:12, textAlign:'left' },
  loginFeatureItem: { display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.08)' },
  loginForm: { width:'100%', maxWidth:400 },
  formTitle: { fontSize:26, fontWeight:800, color:'#0f172a', margin:'0 0 4px', fontFamily:'Poppins,sans-serif' },
  formSubtitle: { fontSize:14, color:'#64748b', margin:'0 0 24px' },
  label: { display:'block', fontSize:13, fontWeight:600, color:'#374151', margin:'16px 0 6px' },
  input: { width:'100%', padding:'12px 14px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:14, outline:'none', transition:'border 0.2s', background:'#fff', boxSizing:'border-box' },
  select: { width:'100%', padding:'12px 14px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:14, outline:'none', background:'#fff', boxSizing:'border-box', cursor:'pointer' },
  inputGroup: { position:'relative' },
  eyeBtn: { position:'absolute', right:8, top:8, background:'none', border:'none', cursor:'pointer', padding:4 },
  submitBtn: { width:'100%', padding:'14px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#1e40af,#3b82f6)', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', marginTop:20, transition:'transform 0.1s', letterSpacing:0.5 },
  linkBtn: { width:'100%', padding:'12px', background:'none', border:'none', color:'#64748b', fontSize:13, cursor:'pointer', marginTop:8 },
  errorBox: { display:'flex', gap:8, alignItems:'center', padding:'10px 14px', borderRadius:8, background:'#fef2f2', border:'1px solid #fecaca', color:'#dc2626', fontSize:13, marginBottom:12 },

  /* App Layout */
  appContainer: { display:'flex', height:'100vh', fontFamily:'Inter,sans-serif', background:'#f1f5f9' },
  sidebar: { width:260, background:'#fff', borderRight:'1px solid #e2e8f0', display:'flex', flexDirection:'column', transition:'width 0.2s', flexShrink:0 },
  sidebarHeader: { display:'flex', alignItems:'center', gap:12, padding:'16px 12px', borderBottom:'1px solid #f1f5f9' },
  menuBtn: { background:'none', border:'none', cursor:'pointer', padding:4, borderRadius:8 },
  sidebarTitle: { fontSize:18, fontWeight:800, color:'#1e40af', fontFamily:'Poppins,sans-serif', letterSpacing:1 },
  composeBtn: { margin:'12px 12px 4px', padding:'12px 16px', borderRadius:16, border:'none', background:'linear-gradient(135deg,#1e40af,#3b82f6)', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(30,64,175,0.25)' },
  sidebarNav: { flex:1, padding:'8px 8px', display:'flex', flexDirection:'column', gap:2 },
  navItem: { display:'flex', alignItems:'center', padding:'10px 12px', borderRadius:10, border:'none', background:'none', cursor:'pointer', width:'100%', transition:'background 0.15s' },
  navItemActive: { background:'#eff6ff' },
  badge: { background:'#ef4444', color:'#fff', fontSize:11, fontWeight:700, borderRadius:10, padding:'2px 8px', minWidth:20, textAlign:'center' },
  sidebarFooter: { padding:'16px 12px', borderTop:'1px solid #f1f5f9' },

  /* Top Bar */
  topBar: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 24px', background:'#fff', borderBottom:'1px solid #e2e8f0', flexShrink:0 },
  userChip: { display:'flex', alignItems:'center', gap:10 },
  topBadge: { position:'absolute', top:-4, right:-4, background:'#ef4444', color:'#fff', fontSize:10, fontWeight:700, borderRadius:'50%', width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center' },
  logoutBtn: { background:'none', border:'none', cursor:'pointer', padding:8, borderRadius:8 },

  /* Main Content */
  mainContent: { flex:1, overflow:'auto', padding:24 },

  /* Cards */
  card: { background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', marginBottom:16, border:'1px solid #f1f5f9' },
  cardHeader: { display:'flex', alignItems:'center', gap:10, marginBottom:16, paddingBottom:12, borderBottom:'1px solid #f1f5f9' },
  cardTitle: { fontSize:16, fontWeight:700, color:'#0f172a', margin:0 },

  /* KPI */
  kpiGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:16, marginBottom:20 },
  kpiCard: { background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', border:'1px solid #f1f5f9' },

  /* Dashboard grid */
  dashGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 },
  deadlineItem: { display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid #f8fafc' },
  projectItem: { display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid #f8fafc' },
  tagSmall: { fontSize:11, fontWeight:600, color:'#fff', borderRadius:6, padding:'3px 8px', display:'inline-block' },
  tagTiny: { fontSize:10, fontWeight:600, color:'#fff', borderRadius:4, padding:'1px 6px' },
  iconBtn: { background:'none', border:'none', cursor:'pointer', padding:4, borderRadius:6, display:'inline-flex', alignItems:'center', justifyContent:'center' },
  catChip: { display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:10, border:'2px solid', background:'#fff' },

  /* Inbox */
  searchBar: { display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', marginBottom:12 },
  searchInput: { flex:1, border:'none', outline:'none', fontSize:14, background:'transparent', color:'#0f172a' },
  emailList: { background:'#fff', borderRadius:14, overflow:'hidden', border:'1px solid #e2e8f0' },
  emailRow: { display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderBottom:'1px solid #f1f5f9', cursor:'pointer', transition:'background 0.15s' },
  emailUnread: { background:'#f8fafc', borderLeft:'3px solid #3b82f6' },
  backBtn: { display:'inline-flex', alignItems:'center', gap:6, background:'none', border:'none', color:'#3b82f6', cursor:'pointer', fontSize:14, fontWeight:600, padding:'4px 0' },

  /* Projects */
  filterBar: { display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' },
  filterTab: { padding:'8px 16px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', fontSize:13, fontWeight:500, cursor:'pointer', color:'#475569' },
  filterTabActive: { background:'#1e40af', color:'#fff', border:'1px solid #1e40af' },
  projectGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:16 },
  projectCard: { background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', border:'1px solid #f1f5f9', transition:'box-shadow 0.15s' },

  /* Procurement */
  actionBtn: { display:'flex', alignItems:'center', gap:6, padding:'10px 20px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#1e40af,#3b82f6)', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' },

  /* Table */
  table: { width:'100%', borderCollapse:'collapse' },
  th: { textAlign:'left', padding:'12px 14px', fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:0.5, borderBottom:'2px solid #e2e8f0', background:'#f8fafc' },
  td: { padding:'12px 14px', fontSize:13, color:'#334155', borderBottom:'1px solid #f1f5f9' },
  tr: { transition:'background 0.15s' },

  /* Alerts */
  alertItem: { display:'flex', alignItems:'flex-start', gap:14, padding:'16px', marginBottom:8, borderRadius:12, background:'#fff', border:'1px solid #e2e8f0', cursor:'pointer', transition:'background 0.15s' },

  /* Units */
  unitCard: { background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', border:'1px solid #f1f5f9' },

  /* Common */
  loading: { textAlign:'center', padding:60, color:'#94a3b8' },
};

/* ── Global body styles ── */
const globalCSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:#f1f5f9;-webkit-font-smoothing:antialiased}
  input:focus,select:focus,textarea:focus{border-color:#3b82f6 !important;box-shadow:0 0 0 3px rgba(59,130,246,0.1)}
  button:hover{opacity:0.92}
  ::-webkit-scrollbar{width:6px}
  ::-webkit-scrollbar-track{background:#f1f5f9}
  ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
  @media(max-width:768px){
    .login-left{display:none !important}
  }
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
`;

const styleTag = document.createElement('style');
styleTag.textContent = globalCSS;
document.head.appendChild(styleTag);

/* ── Mount ── */
ReactDOM.createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
