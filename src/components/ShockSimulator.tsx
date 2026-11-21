/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { COMPONENT_LIST, MARKET_INDICES } from '../data';
import { useMarketIndices } from '../useMarketIndices';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronDown, Info, History, Globe, Zap, Ship, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import CarTwinViewport from './car3d/CarTwinViewport';

function IndexSlider({ 
  idx, 
  value, 
  onChange 
}: { 
  idx: typeof MARKET_INDICES[0]; 
  value: number; 
  onChange: (val: number) => void;
  key?: string | number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] font-mono text-slate-400">
        <span className="uppercase tracking-wider flex items-center gap-1.5">
          {idx.id === 'freight' ? <Ship size={12} className="text-indigo-400 shrink-0" /> : null}
          {idx.name}
        </span>
        <span className={`font-bold tabular-nums transition-colors ${value > 0 ? 'text-red-400' : value < 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
          {value > 0 ? '+' : value < 0 ? '-' : ''}{Math.abs(value).toFixed(1)}%
        </span>
      </div>
      <input 
        type="range" 
        min="-50" 
        max="200" 
        step="0.5"
        value={value || 0} 
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-400 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  );
}

function MaterialBar({ 
  name, 
  weight, 
  index,
  colorClass 
}: { 
  name: string; 
  weight: number; 
  index: string;
  colorClass: string;
  key?: string | number;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1.5 gap-2">
        <span className="text-slate-300 capitalize flex items-center gap-2 truncate">
          {name}
          <span className="text-[10px] text-slate-500 font-mono">· {index}</span>
        </span>
        <span className={`${colorClass} tabular-nums shrink-0`}>{Math.round((weight || 0) * 100)}%</span>
      </div>
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${(weight || 0) * 100}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`h-full ${colorClass.replace('text-', 'bg-')}`}
        />
      </div>
    </div>
  );
}

export default function ShockSimulator() {
  const { indices, historical, baseline, live, updatedAt } = useMarketIndices();
  const [shocks, setShocks] = useState<Record<string, number>>(() => ({ ...baseline }));
  const userTouched = useRef(false);

  useEffect(() => {
    if (!userTouched.current) setShocks({ ...baseline });
  }, [baseline]);

  const [selectedComponentId, setSelectedComponentId] = useState(COMPONENT_LIST[0].id);
  const [isNearshoring, setIsNearshoring] = useState(false);
  const [useSubstitution, setUseSubstitution] = useState(false);

  const selectedBaseComponent = useMemo(() => 
    COMPONENT_LIST.find(c => c.id === selectedComponentId), 
    [selectedComponentId]
  );

  const activeComponent = useMemo(() => {
    if (useSubstitution && selectedBaseComponent?.substitution) {
      return {
        ...selectedBaseComponent,
        materials: selectedBaseComponent.substitution.materials,
        weight_kg: selectedBaseComponent.substitution.weight_kg,
        name: `${selectedBaseComponent.name} (${selectedBaseComponent.substitution.name})`
      };
    }
    return selectedBaseComponent;
  }, [selectedBaseComponent, useSubstitution]);

  const calculatedShock = useMemo(() => {
    if (!activeComponent) return 0;
    
    const m = activeComponent.materials;
    let materialShock = (shocks[m.primary.index] || 0) * m.primary.weight;
    if (m.secondary) materialShock += (shocks[m.secondary.index] || 0) * m.secondary.weight;
    if (m.tertiary) materialShock += (shocks[m.tertiary.index] || 0) * m.tertiary.weight;
    
    const freightShock = shocks['Global Freight Index'] || 0;
    const logisticsMultiplier = (activeComponent.isGlobalSourcing && !isNearshoring) ? 1.0 : 0.2;
    const logisticsShock = freightShock * activeComponent.logisticsSensitivity * logisticsMultiplier;

    const complexityFactor = activeComponent.sensitivityScore / 6;
    
    return (materialShock * complexityFactor) + logisticsShock;
  }, [activeComponent, shocks, isNearshoring]);

  const forecastData = useMemo(() => {
    return [
      { month: 'Current', shock: 0 },
      { month: 'T+1', shock: calculatedShock * 0.4 },
      { month: 'T+2', shock: calculatedShock * 0.7 },
      { month: 'T+3 (Peak)', shock: calculatedShock },
      { month: 'T+6 (Recede)', shock: calculatedShock * 0.8 },
    ];
  }, [calculatedShock]);

  const handleComponentChange = (id: string) => {
    setSelectedComponentId(id);
    setUseSubstitution(false);
  };

  const resetShocks = () => {
    userTouched.current = false;
    setShocks({ ...baseline });
  };

  const zeroShocks = () => {
    userTouched.current = true;
    setShocks(indices.reduce((acc, idx) => ({ ...acc, [idx.name]: 0 }), {}));
  };

  const riskLabel = calculatedShock > 25 ? 'Extreme' : calculatedShock > 10 ? 'Elevated' : isNearshoring ? 'Minimized' : 'Stable';
  const riskColor = calculatedShock > 25 ? 'text-rose-400' : calculatedShock > 10 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="space-y-6">
      {/* 1. Command & Telemetry Header Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-6 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="min-w-[270px]">
            <label
              htmlFor="vehicle-component-select"
              className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1.5"
            >
              Select Vehicle Component
            </label>
            <div className="relative">
              <select
                id="vehicle-component-select"
                className="appearance-none bg-slate-950 text-slate-100 font-mono text-xs uppercase border border-slate-700 pl-3.5 pr-9 py-2.5 rounded-lg focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer w-full"
                value={selectedComponentId}
                onChange={(e) => handleComponentChange(e.target.value)}
              >
                {COMPONENT_LIST.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDown size={14} />
              </div>
            </div>
          </div>

          <div className="sm:border-l sm:border-slate-800 sm:pl-6 space-y-1">
            <div className="text-xs font-medium text-slate-200">
              {selectedBaseComponent?.category} <span className="text-slate-600 mx-1.5">·</span> {selectedBaseComponent?.supplier ?? 'Tier-1 OEM'}
            </div>
            <div className="text-[11px] font-mono text-slate-400 tabular-nums">
              Base Mass: {activeComponent?.weight_kg ?? 0} kg
              <span className="text-slate-600 mx-2">/</span>
              Sensitivity Index: {activeComponent?.sensitivityScore.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Horizontal KPI Strip */}
        <div className="flex flex-wrap items-center gap-6 sm:gap-8 pt-4 lg:pt-0 border-t lg:border-t-0 border-slate-800">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-0.5">Sourcing</div>
            <div className="text-sm font-mono font-semibold text-slate-200">
              {isNearshoring ? 'Localized' : activeComponent?.isGlobalSourcing ? 'Global' : 'Regional'}
            </div>
          </div>
          <div className="border-l border-slate-800 pl-6">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-0.5">Volatility Risk</div>
            <div className={`text-sm font-mono font-semibold ${riskColor}`}>
              {riskLabel}
            </div>
          </div>
          <div className="border-l border-slate-800 pl-6 text-right">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-0.5">Landed Cost Impact</div>
            <div className={`text-3xl sm:text-4xl font-mono font-bold tracking-tight tabular-nums ${calculatedShock > 0 ? 'text-red-400' : calculatedShock < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
              {calculatedShock > 0 ? '+' : ''}{calculatedShock.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* 2. Primary Interactive Workspace: Simulation Controls (Left) + 3D Vehicle Digital Twin (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Controls Column */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Market Index Simulator */}
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Market Index Simulator</h3>
              <span className="text-[10px] font-mono text-slate-400">
                {live
                  ? `Live · ${updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`
                  : 'Baseline'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
              {indices.map(idx => (
                <IndexSlider 
                  key={idx.id} 
                  idx={idx} 
                  value={shocks[idx.name]} 
                  onChange={(val) => { userTouched.current = true; setShocks(prev => ({ ...prev, [idx.name]: val })); }}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2.5 mt-5 pt-4 border-t border-slate-800">
              <button 
                onClick={resetShocks}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-mono text-[10px] uppercase tracking-wider transition-colors hover:border-cyan-500/50 hover:text-cyan-300 flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <History size={12} />
                Market Trend
              </button>
              <button
                onClick={zeroShocks}
                className="py-2 px-3 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Zero Shocks
              </button>
            </div>
          </div>

          {/* Strategist Toolbox */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 flex-grow flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
                <Globe size={15} className="text-cyan-400" />
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Strategist Toolbox</h3>
              </div>

              <div className="space-y-3.5">
                <label className={`block p-3.5 rounded-lg border transition-colors cursor-pointer ${selectedBaseComponent?.substitution ? (useSubstitution ? 'border-amber-500 bg-amber-500/5' : 'border-slate-800 bg-slate-950/50 hover:border-amber-500/50') : 'border-slate-800/60 bg-slate-950/30 opacity-45 cursor-not-allowed'}`}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-2">
                      <Zap size={13} className={useSubstitution ? 'text-amber-400' : 'text-amber-500'} />
                      Material Substitution
                    </span>
                    <input 
                      type="checkbox" 
                      disabled={!selectedBaseComponent?.substitution}
                      checked={useSubstitution} 
                      onChange={(e) => setUseSubstitution(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {selectedBaseComponent?.substitution 
                      ? useSubstitution 
                        ? selectedBaseComponent.substitution.rationale 
                        : `Preview alternative: ${selectedBaseComponent.substitution.name}`
                      : "No alternative material configuration available for this assembly."}
                  </p>
                </label>

                <label className={`block p-3.5 rounded-lg border transition-colors cursor-pointer ${isNearshoring ? 'border-cyan-500 bg-cyan-500/5' : 'border-slate-800 bg-slate-950/50 hover:border-cyan-500/50'}`}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-2">
                      <Globe size={13} className={isNearshoring ? 'text-cyan-400' : 'text-cyan-500'} />
                      Regional Nearshoring
                    </span>
                    <input 
                      type="checkbox" 
                      checked={isNearshoring} 
                      onChange={(e) => setIsNearshoring(e.target.checked)}
                      className="w-4 h-4 accent-cyan-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Shift assembly within region to dampen global freight volatility exposure.
                  </p>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* 3D Vehicle Digital Twin Column */}
        <div className="lg:col-span-8 flex flex-col">
          <CarTwinViewport
            selectedComponentId={selectedComponentId}
            onSelectComponent={handleComponentChange}
            useSubstitution={useSubstitution}
            calculatedShock={calculatedShock}
            className="h-[440px] lg:h-full min-h-[540px]"
          />
        </div>
      </div>

      {/* 3. Analytics & Cost Breakdown Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Forecast Trajectory */}
        <div className="lg:col-span-5 bg-slate-900/50 border border-slate-800 rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-cyan-400" />
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">6-Month Impact Trajectory</h3>
            </div>
            <span className="text-[10px] font-mono text-slate-500">180D Horizon</span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forecastData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis 
                  dataKey="month" 
                  axisLine={{ stroke: '#334155' }} 
                  tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: '#64748b' }}
                  tickLine={{ stroke: '#334155' }}
                />
                <YAxis 
                  axisLine={{ stroke: '#334155' }} 
                  tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: '#64748b' }}
                  tickLine={{ stroke: '#334155' }}
                  unit="%"
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    color: '#e2e8f0'
                  }}
                  itemStyle={{ color: '#22d3ee' }}
                  cursor={{ stroke: '#334155', strokeWidth: 1 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="shock" 
                  stroke={useSubstitution ? "#f59e0b" : "#22d3ee"} 
                  strokeWidth={3} 
                  dot={{ r: 4, fill: useSubstitution ? "#f59e0b" : "#22d3ee", stroke: "none" }}
                  activeDot={{ r: 6, stroke: "none", fill: '#ec4899' }}
                  animationDuration={700}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Sensitivity Distribution */}
        <div className="lg:col-span-4 bg-slate-900/50 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-5 pb-3 border-b border-slate-800">
              Sensitivity Distribution
            </h3>
            <div className="space-y-4 font-mono text-[11px] text-slate-200">
              {[
                activeComponent?.materials.primary,
                activeComponent?.materials.secondary,
                activeComponent?.materials.tertiary,
              ].filter(Boolean).map((mat, i) => (
                <MaterialBar 
                  key={i}
                  name={mat!.name}
                  weight={mat!.weight}
                  index={mat!.index}
                  colorClass={i === 0 ? "text-cyan-400" : "text-indigo-400"}
                />
              ))}
              <div className="pt-4 border-t border-slate-800">
                <MaterialBar 
                  name="Freight Exposure"
                  weight={activeComponent?.logisticsSensitivity || 0}
                  index="Global Freight Index"
                  colorClass="text-indigo-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Propagation Insights */}
        <div className="lg:col-span-3 bg-slate-900/50 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-5 pb-3 border-b border-slate-800 flex items-center gap-2">
              <Info size={13} className="text-slate-400" />
              Propagation Insights
            </h3>
            <div className="space-y-4 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Assembly Weight</span>
                <span className={`font-mono font-medium tabular-nums ${useSubstitution ? 'text-amber-400' : 'text-slate-200'}`}>
                  {activeComponent?.weight_kg} kg
                  {useSubstitution && selectedBaseComponent?.substitution && (
                    <span className="ml-1.5 text-[10px] text-slate-400">
                      ({(activeComponent!.weight_kg! - selectedBaseComponent!.weight_kg!).toFixed(1)} kg)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Sourcing Mode</span>
                <span className="font-mono text-slate-200">
                  {isNearshoring ? 'Localized' : activeComponent?.isGlobalSourcing ? 'Global' : 'Local'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Risk Exposure</span>
                <span className={`font-mono font-semibold ${riskColor}`}>
                  {riskLabel}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Active Config</span>
                <span className="font-mono text-slate-200 truncate max-w-[140px]">
                  {useSubstitution ? 'Substituted' : 'Baseline BOM'}
                </span>
              </div>
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-slate-800 text-[10px] font-mono text-slate-500">
            Supplier: {selectedBaseComponent?.supplier ?? 'OEM Direct'}
          </div>
        </div>
      </div>

      {/* 4. Historical Market Drift (Full Width) */}
      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 border border-slate-700 bg-slate-800/80 rounded-lg">
              <History size={18} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Historical Market Drift</h2>
              <p className="text-[11px] text-slate-400">Real-world commodity volatility tracking (6M window)</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-5">
            {['Brent Crude', 'LME Copper', 'SOX Index', 'LME Steel'].map((label, idx) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`w-2.5 h-0.5 rounded-full ${idx === 0 ? 'bg-red-400' : idx === 1 ? 'bg-amber-400' : idx === 2 ? 'bg-cyan-400' : 'bg-slate-400'}`} />
                <span className="text-[11px] text-slate-400 font-mono">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historical}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis 
                dataKey="month" 
                axisLine={{ stroke: '#334155' }} 
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: '#64748b' }}
              />
              <YAxis 
                axisLine={{ stroke: '#334155' }} 
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: '#64748b' }}
                unit="%"
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#e2e8f0'
                }}
              />
              <Line type="monotone" dataKey="Brent Crude" stroke="#f87171" strokeWidth={2} dot={{ r: 3, fill: '#ef4444', stroke: "none" }} activeDot={{ r: 5, stroke: "none" }} />
              <Line type="monotone" dataKey="LME Copper" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b', stroke: "none" }} activeDot={{ r: 5, stroke: "none" }} />
              <Line type="monotone" dataKey="SOX Index" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3, fill: '#06b6d4', stroke: "none" }} activeDot={{ r: 5, stroke: "none" }} />
              <Line type="monotone" dataKey="LME Steel" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3, fill: '#64748b', stroke: "none" }} activeDot={{ r: 5, stroke: "none" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
