import React from 'react';
import { useStore } from '../store/useStore';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

export function StatsPanel() {
  const sessionPnL = useStore(state => state.sessionPnL);
  const wins = useStore(state => state.wins);
  const losses = useStore(state => state.losses);
  const maxConsecutiveLosses = useStore(state => state.maxConsecutiveLosses);
  const currentConsecutiveLosses = useStore(state => state.currentConsecutiveLosses);
  const saveAndResetSession = useStore(state => state.saveAndResetSession);
  const takeProfit = useStore(state => state.settings.takeProfit);
  const stopLoss = useStore(state => state.settings.stopLoss);
  
  const cycleActive = useStore(state => state.cycleActive);
  const nextEvenStake = useStore(state => state.nextEvenStake);
  const nextOddStake = useStore(state => state.nextOddStake);
  const cycleNetPnL = useStore(state => state.cycleNetPnL);
  const tradeLog = useStore(state => state.tradeLog);

  const totalTrades = wins + losses;
  const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;

  // Compute equity curve data
  // tradeLog is newest first. We need oldest first.
  const chartData = React.useMemo(() => {
     let runningPnL = 0;
     const reversed = [...tradeLog].reverse();
     const data = [{ pnl: 0 }];
     for (let i = 0; i < reversed.length; i += 2) {
         // Add even and odd pairs
         const evnt = reversed[i];
         const odd = reversed[i+1];
         if (evnt) runningPnL += evnt.pnl;
         if (odd) runningPnL += odd.pnl;
         data.push({ pnl: runningPnL });
     }
     return data;
  }, [tradeLog]);

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">
      <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Session Performance</div>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3 shrink-0">
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Total PnL</div>
          <div className={`mt-1 font-mono text-[18px] font-bold ${sessionPnL >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
             {sessionPnL >= 0 ? '+' : ''}${sessionPnL.toFixed(2)}
          </div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Win Rate</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7]">{winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Trades</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7]">{totalTrades}</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Wins/Losses</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-[#e4e4e7]"><span className="text-[#00ff9c]">{wins}</span> / <span className="text-[#ff4b4b]">{losses}</span></div>
        </div>
      </div>

      <div className="shrink-0">
        <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider mb-2">Live Equity Curve</div>
        <div className="h-[120px] bg-black/20 rounded-md border border-[#27272a] p-2">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                    <YAxis domain={['auto', 'auto']} hide />
                    <Line type="stepAfter" dataKey="pnl" stroke={sessionPnL >= 0 ? '#00ff9c' : '#ff4b4b'} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
      </div>

      {cycleActive && (
        <div className="shrink-0 border border-[#00ff9c]/50 bg-[#00ff9c]/5 p-3 rounded-md relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00ff9c]/5 to-transparent animate-pulse pointer-events-none" />
            <div className="flex items-center gap-2 mb-3 relative">
                <div className="w-2 h-2 rounded-full bg-[#00ff9c] shadow-[0_0_8px_#00ff9c] animate-pulse" />
                <div className="text-[10px] uppercase text-[#00ff9c] font-bold tracking-widest">Active Cycle (Asymmetric Hedge)</div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 relative">
                <div>
                   <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Next Even</div>
                   <div className="font-mono text-sm font-bold text-[#e4e4e7]">${nextEvenStake.toFixed(2)}</div>
                </div>
                <div>
                   <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Next Odd</div>
                   <div className="font-mono text-sm font-bold text-[#e4e4e7]">${nextOddStake.toFixed(2)}</div>
                </div>
            </div>
            
            <div className="mt-3 pt-3 border-t border-[#00ff9c]/20 relative">
               <div className="flex justify-between items-center">
                   <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Cycle Net PnL</div>
                   <div className={`font-mono text-sm font-bold ${cycleNetPnL >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
                      {cycleNetPnL >= 0 ? '+' : ''}${cycleNetPnL.toFixed(2)}
                   </div>
               </div>
            </div>
        </div>
      )}

      {!cycleActive && (
          <div className="shrink-0 border border-[#27272a] bg-black/20 p-3 rounded-md flex items-center justify-center min-h-[100px]">
             <div className="text-[10px] uppercase text-[#a1a1aa] font-medium tracking-widest text-center">
                Waiting for target streak...
             </div>
          </div>
      )}
      
      <div className="mt-auto border border-[#27272a] p-3 rounded text-sm bg-black/20 shrink-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#ff4b4b]">Circuit Breakers</div>
        <div className="text-xs mt-2 flex justify-between">
          <span>Take Profit</span><span className="text-[#00ff9c]">${takeProfit.toFixed(2)}</span>
        </div>
        <div className="text-xs mt-1 flex justify-between">
          <span>Current Target Streak</span><span className="text-[#e4e4e7]">{useStore(state => state.settings.targetStreak)}</span>
        </div>
      </div>

      <button 
        onClick={saveAndResetSession}
        className="w-full shrink-0 py-2 text-[10px] font-mono uppercase tracking-widest text-[#a1a1aa] border border-[#27272a] rounded bg-black/20 hover:bg-[#27272a] hover:text-[#e4e4e7] transition-colors"
      >
        Save & Flush Memory
      </button>
    </div>
  );
}
