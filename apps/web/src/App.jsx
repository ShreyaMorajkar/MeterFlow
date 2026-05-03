import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Copy,
  CreditCard,
  Gauge,
  KeyRound,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { api, clearSession, getApiUrl, getToken, getUser, setSession } from './api.js';
import './styles.css';

function formatPaise(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((value || 0) / 100);
}

function App() {
  const [user, setUser] = useState(getUser());
  const [authMode, setAuthMode] = useState('register');
  const [authForm, setAuthForm] = useState({ email: 'founder@meterflow.dev', password: 'password123' });
  const [apis, setApis] = useState([]);
  const [keys, setKeys] = useState([]);
  const [summary, setSummary] = useState(null);
  const [apiForm, setApiForm] = useState({ name: 'PokeAPI demo', baseUrl: 'https://pokeapi.co/api/v2' });
  const [lastRawKey, setLastRawKey] = useState('');
  const [selectedApiId, setSelectedApiId] = useState('');
  const [error, setError] = useState('');
  const [isWaiting, setIsWaiting] = useState(false);
  const [activeTab, setActiveTab] = useState('usage');
  const [subscription, setSubscription] = useState(null);

  const selectedApi = apis.find((item) => item.id === selectedApiId) || apis[0];
  const activeKey = keys.find((item) => item.status === 'active' && item.apiId === selectedApi?.id) || keys.find((item) => item.status === 'active');

  const curl = useMemo(() => {
    if (!selectedApi || !lastRawKey) return '';
    return `curl -H "x-api-key: ${lastRawKey}" ${getApiUrl()}/gateway/${selectedApi.id}/pokemon/ditto`;
  }, [selectedApi, lastRawKey]);

  async function refresh() {
    if (!getToken()) return;
    const [apiData, keyData, usageData] = await Promise.all([api('/apis'), api('/keys'), api('/usage/summary')]);
    setApis(apiData.apis);
    setKeys(keyData.keys);
    setSummary(usageData);
    if (!selectedApiId && apiData.apis[0]) setSelectedApiId(apiData.apis[0].id);
  }

  async function loadSubscription() {
    try {
      const data = await api('/payments/subscription');
      setSubscription(data);
    } catch (err) {
      console.error('Failed to load subscription:', err);
    }
  }

  async function upgradePlan() {
    try {
      const data = await api('/payments/checkout', { method: 'POST', body: JSON.stringify({}) });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function manageBilling() {
    try {
      const data = await api('/payments/portal', { method: 'POST' });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh().catch(() => {});
    loadSubscription().catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const socket = io(getApiUrl());
    socket.emit('dashboard:join', user.id);
    socket.on('usage:logged', () => {
      setIsWaiting(false);
      refresh().catch(() => {});
    });
    return () => socket.disconnect();
  }, [user?.id]);

  async function submitAuth(event) {
    event.preventDefault();
    setError('');
    try {
      const session = await api(`/auth/${authMode}`, { method: 'POST', body: JSON.stringify(authForm) });
      setSession(session);
      setUser(session.user);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createApi(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/apis', { method: 'POST', body: JSON.stringify(apiForm) });
      const keyData = await api('/keys', {
        method: 'POST',
        body: JSON.stringify({ apiId: data.api.id, label: 'Default test key', environment: 'test' })
      });
      setLastRawKey(keyData.rawKey);
      setSelectedApiId(data.api.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function rotateKey(id) {
    const data = await api(`/keys/${id}/rotate`, { method: 'POST' });
    setLastRawKey(data.rawKey);
    await refresh();
  }

  async function calculateBilling() {
    const data = await api('/billing/calculate', { method: 'POST' });
    setSummary((current) => ({ ...current, invoice: data.invoice }));
  }

  async function copy(text) {
    await navigator.clipboard.writeText(text);
  }

  if (!user) {
    return (
      <main className="authShell">
        <section className="authPanel">
          <div className="brandRow">
            <div className="brandMark"><Gauge size={24} /></div>
            <div>
              <h1>MeterFlow</h1>
              <p>Gateway metering and usage billing for API products.</p>
            </div>
          </div>
          <form onSubmit={submitAuth} className="authForm">
            <label>Email<input value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} /></label>
            <label>Password<input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} /></label>
            {error && <p className="error">{error}</p>}
            <button className="primaryButton" type="submit"><ShieldCheck size={18} /> {authMode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
          <button className="textButton" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>
            {authMode === 'register' ? 'Use an existing account' : 'Create a new account'}
          </button>
        </section>
      </main>
    );
  }

  const totals = summary?.totals || {};
  const logs = summary?.logs || [];
  const usedPercent = totals.includedRequests ? Math.min(100, (totals.requests / totals.includedRequests) * 100) : 0;

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brandRow compact">
          <div className="brandMark"><Gauge size={22} /></div>
          <strong>MeterFlow</strong>
        </div>
        <nav>
          <a className={activeTab === 'usage' ? 'active' : ''} onClick={() => setActiveTab('usage')}><Activity size={18} /> Usage</a>
          <a className={activeTab === 'keys' ? 'active' : ''} onClick={() => setActiveTab('keys')}><KeyRound size={18} /> API keys</a>
          <a className={activeTab === 'billing' ? 'active' : ''} onClick={() => setActiveTab('billing')}><CreditCard size={18} /> Billing</a>
        </nav>
        <button className="ghostButton" onClick={() => { clearSession(); setUser(null); }}><LogOut size={18} /> Sign out</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">MVP gateway</span>
            <h1>Usage command center</h1>
          </div>
          <button className="iconButton" title="Refresh" onClick={refresh}><RefreshCw size={18} /></button>
        </header>

        <section className="metricsGrid">
          <Metric icon={<Zap />} label="Requests this month" value={totals.requests || 0} detail={`${Math.round(usedPercent)}% of free tier`} />
          <Metric icon={<BarChart3 />} label="Average latency" value={`${totals.avgLatencyMs || 0}ms`} detail="Gateway overhead visible" />
          <Metric icon={<AlertTriangle />} label="Errors" value={totals.errors || 0} detail="4xx and 5xx responses" />
          <Metric icon={<CreditCard />} label="Current bill" value={formatPaise(totals.amountPaise)} detail={`${formatPaise(totals.spendHardCapPaise)} hard cap`} />
        </section>

        <section className="twoColumn">
          <div className="panel">
            <div className="panelHeader">
              <h2>Create a metered API</h2>
              <Plus size={18} />
            </div>
            <form onSubmit={createApi} className="stackForm">
              <label>Name<input value={apiForm.name} onChange={(event) => setApiForm({ ...apiForm, name: event.target.value })} /></label>
              <label>Origin base URL<input value={apiForm.baseUrl} onChange={(event) => setApiForm({ ...apiForm, baseUrl: event.target.value })} /></label>
              <button className="primaryButton" type="submit"><Plus size={18} /> Create API and key</button>
              {error && <p className="error">{error}</p>}
            </form>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <h2>First-call delight</h2>
              <Play size={18} />
            </div>
            {curl ? (
              <>
                <pre className="curlBox">{curl}</pre>
                <div className="buttonRow">
                  <button className="secondaryButton" onClick={() => copy(curl)}><Copy size={18} /> Copy cURL</button>
                  <button className="secondaryButton" onClick={() => setIsWaiting(true)}><Activity size={18} /> Waiting for first request</button>
                </div>
              </>
            ) : (
              <div className="emptyState">
                <Activity size={28} />
                <p>Create an API to receive a one-time raw key and an instant cURL command.</p>
              </div>
            )}
            {isWaiting && <div className="pulseLine">Waiting for first request...</div>}
          </div>
        </section>

        <section className="twoColumn bottom">
          <div className="panel">
            <div className="panelHeader">
              <h2>Managed keys</h2>
              <KeyRound size={18} />
            </div>
            <div className="list">
              {keys.map((key) => (
                <div className="listItem" key={key.id}>
                  <div>
                    <strong>{key.label}</strong>
                    <span>{key.environment} · {key.status} · {key.apiName}</span>
                  </div>
                  {key.status === 'active' && <button className="iconButton" title="Rotate key" onClick={() => rotateKey(key.id)}><RotateCcw size={17} /></button>}
                </div>
              ))}
              {!keys.length && <p className="muted">No keys yet.</p>}
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <h2>Request ledger</h2>
              <button className="secondaryButton small" onClick={calculateBilling}>Calculate bill</button>
            </div>
            <div className="logTable">
              {logs.map((log) => (
                <div className="logRow" key={log._id}>
                  <span>{log.method}</span>
                  <strong>{log.endpoint}</strong>
                  <span>{log.statusCode || '-'}</span>
                  <span>{log.latencyMs || 0}ms</span>
                </div>
              ))}
              {!logs.length && <div className="emptyState small"><p>Run the cURL command and this ledger updates in real time.</p></div>}
            </div>
            {summary?.invoice && <p className="invoiceNote">Invoice {summary.invoice.id}: {summary.invoice.totalReqs} requests, {formatPaise(summary.invoice.amountPaise)}</p>}
          </div>
        </section>

        {activeTab === 'billing' && (
          <section className="panel">
            <div className="panelHeader">
              <h2>Subscription & Billing</h2>
              <CreditCard size={18} />
            </div>
            <div className="billingContent">
              <div className="planInfo">
                <div className="planStatus">
                  <strong>Current Plan</strong>
                  <span className="badge">{subscription?.status === 'active' ? 'Pro' : 'Free'}</span>
                </div>
                <p className="muted">
                  {subscription?.status === 'active' 
                    ? 'You are on a paid subscription plan.'
                    : 'Upgrade to Pro for higher rate limits and more API calls.'}
                </p>
              </div>
              
              <div className="planActions">
                {subscription?.status === 'active' ? (
                  <>
                    <button className="secondaryButton" onClick={manageBilling}>
                      <CreditCard size={18} /> Manage Subscription
                    </button>
                  </>
                ) : (
                  <button className="primaryButton" onClick={upgradePlan}>
                    <Zap size={18} /> Upgrade to Pro
                  </button>
                )}
              </div>

              <div className="usageInfo">
                <h3>Usage This Month</h3>
                <div className="usageRow">
                  <span>Requests</span>
                  <span>{totals.requests || 0}</span>
                </div>
                <div className="usageRow">
                  <span>Included (Free Tier)</span>
                  <span>1,000</span>
                </div>
                <div className="usageRow">
                  <span>Overage Rate</span>
                  <span>₹0.10 per 100 requests</span>
                </div>
                <div className="usageRow">
                  <span>Current Bill</span>
                  <span>{formatPaise(totals.amountPaise)}</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function Metric({ icon, label, value, detail }) {
  return (
    <div className="metric">
      <div className="metricIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
