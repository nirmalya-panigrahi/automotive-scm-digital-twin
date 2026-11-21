/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ShockSimulator from './components/ShockSimulator';
import { motion } from 'motion/react';

export default function App() {
  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-200 font-sans selection:bg-cyan-500 selection:text-white">
      {/* Main Content Area */}
      <main className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4 sticky top-0 z-40">
          <div className="flex justify-between items-center relative z-10 max-w-[1600px] mx-auto w-full">
            <div className="flex items-center gap-3.5">
              <img 
                src="https://cdn-icons-png.flaticon.com/512/3067/3067260.png" 
                alt="AutoDrive Logo" 
                className="w-9 h-9 object-contain brightness-110 contrast-125"
                referrerPolicy="no-referrer"
              />
              <h1 className="text-lg font-bold tracking-tight text-white uppercase flex items-baseline gap-2.5 whitespace-nowrap">
                AutoDrive <span className="text-cyan-500 font-light font-mono text-xs tracking-[0.25em] hidden sm:inline">Digital Twin</span>
              </h1>
            </div>
            <div className="text-right border-l border-slate-800 pl-6">
              <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500 mb-0.5">Forecast Horizon</div>
              <div className="font-mono text-xs text-slate-200 whitespace-nowrap">180 Days (Q3 Projection)</div>
            </div>
          </div>
        </header>

        {/* Simulator Section */}
        <section className="p-6 max-w-[1600px] mx-auto w-full flex-grow">
          <motion.div
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
          >
            <ShockSimulator />
          </motion.div>
        </section>

        {/* Global Footer */}
        <footer className="mt-auto px-6 py-3.5 border-t border-slate-800 flex justify-between items-center text-[10px] font-mono text-slate-500">
          <div className="max-w-[1600px] mx-auto w-full flex justify-between items-center">
            <div className="flex gap-6 uppercase tracking-wider">
              <span className="text-emerald-400">Market Feed Active</span>
              <span>Simulation Time: {new Date().toISOString().slice(0, 19).replace('T', ' ')}</span>
            </div>
          </div>
        </footer>

        {/* Legal Ticker Tape */}
        <div className="bg-slate-950 border-t border-slate-800 h-8 flex items-center overflow-hidden">
          <div className="animate-marquee whitespace-nowrap text-[10px] font-mono text-slate-600 uppercase flex gap-20">
            <span>LEGAL DISCLAIMER: ALL DATA PROVIDED BY THE AUTODRIVE DIGITAL TWIN IS FOR SIMULATION AND INFORMATIONAL PURPOSES ONLY.</span>
            <span>PAST PERFORMANCE OF MARKET INDICES IS NOT INDICATIVE OF FUTURE RESULTS.</span>
            <span>NO PART OF THIS VISUALIZATION CONSTITUTES FINANCIAL OR PROCUREMENT ADVICE.</span>
            <span>SUPPLY CHAIN PROJECTIONS ARE SUBJECT TO UNFORESEEN GEOPOLITICAL AND ENVIRONMENTAL VARIABLES.</span>
            {/* Duplicate for seamless looping */}
            <span>LEGAL DISCLAIMER: ALL DATA PROVIDED BY THE AUTODRIVE DIGITAL TWIN IS FOR SIMULATION AND INFORMATIONAL PURPOSES ONLY.</span>
            <span>PAST PERFORMANCE OF MARKET INDICES IS NOT INDICATIVE OF FUTURE RESULTS.</span>
            <span>NO PART OF THIS VISUALIZATION CONSTITUTES FINANCIAL OR PROCUREMENT ADVICE.</span>
            <span>SUPPLY CHAIN PROJECTIONS ARE SUBJECT TO UNFORESEEN GEOPOLITICAL AND ENVIRONMENTAL VARIABLES.</span>
          </div>
        </div>
      </main>
    </div>
  );
}
