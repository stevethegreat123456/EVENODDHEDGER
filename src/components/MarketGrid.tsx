import React from 'react';
import { useStore, MarketData } from '../store/useStore';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  const lastLostSymbol = useStore((state) => state.lastLostSymbol);
  const isWaitingForRecovery = useStore((state) => state.isWaitingForRecovery);
  
  return (
    <div className="flex flex-col gap-4 w-full h-full">
      {Object.values(markets).map(market => (
        <MarketCard 
          key={market.symbol} 
          market={market} 
          targetStreak={settings.targetStreak} 
          lastLostSymbol={lastLostSymbol}
          isWaitingForRecovery={isWaitingForRecovery}
        />
      ))}
    </div>
  );
}

const MarketCard: React.FC<{ market: MarketData, targetStreak: number, lastLostSymbol: string | null, isWaitingForRecovery: boolean }> = ({ market, targetStreak, lastLostSymbol, isWaitingForRecovery }) => {
  const isTickActive = market.currentDigit === 0 || market.currentDigit === 1;

  // Render digit history boxes
  const history = market.streakHistory.slice(-10);
  while (history.length < 10) history.unshift(-1); // Pad with -1 or empty
  
  const isCloseToTarget = market.streak >= targetStreak - 1 && market.streak < targetStreak;
  const isTargetMet = market.streak >= targetStreak;
  const inRecoveryThisSymbol = isWaitingForRecovery && lastLostSymbol === market.symbol;

  return (
    <div className={`bg-[#111114] border rounded-lg p-6 sm:p-8 flex flex-col flex-1 justify-center gap-6 transition-colors ${isCloseToTarget ? 'border-[#ffb000]/50 shadow-[0_0_15px_rgba(255,176,0,0.1)]' : isTargetMet ? 'border-[#ff4b4b] shadow-[0_0_15px_rgba(255,75,75,0.2)]' : 'border-[#27272a]'}`}>
      <div className="flex justify-between items-start">
        <div className="font-bold text-xl sm:text-2xl">
            {market.name}
            {inRecoveryThisSymbol && (
              <span className="ml-3 text-xs sm:text-sm bg-[#ff4b4b]/20 text-[#ff4b4b] px-2 py-1 rounded font-mono uppercase">
                Recovery Target
              </span>
            )}
        </div>
        <div className="text-xs sm:text-sm font-semibold text-[#00ff9c] flex items-center gap-2">
          <div className="w-2 h-2 bg-[#00ff9c] rounded-full animate-pulse" /> SCANNING
        </div>
      </div>
      
      <div className="font-mono text-5xl sm:text-7xl font-bold tracking-tight">
        {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
      </div>
      
      <div className="flex gap-2 sm:gap-3 flex-wrap items-center mt-2">
        {history.map((digit, i) => {
          if (digit === -1) return <div key={i} className="w-10 h-10 sm:w-16 sm:h-16 flex items-center justify-center font-mono text-lg sm:text-3xl rounded bg-white/5 border border-[#27272a]" />;
          
          const isEven = digit % 2 === 0;
          return (
            <div 
              key={i} 
              className={`w-10 h-10 sm:w-16 sm:h-16 flex items-center justify-center font-mono text-lg sm:text-3xl rounded border ${isEven ? 'bg-[#00ff9c]/20 text-[#00ff9c] border-[#00ff9c]' : 'bg-[#00b0ff]/20 text-[#00b0ff] border-[#00b0ff]'}`}
            >
              {digit}
            </div>
          );
        })}
      </div>
      
      <div className="flex flex-col mt-4">
          <div className="flex items-center gap-2 mt-1">
            {Array.from({ length: targetStreak }).map((_, i) => (
              <div 
                key={i} 
                className={`w-4 h-4 rounded-full border ${i < market.streak ? 'bg-[#ff4b4b] border-[#ff4b4b] shadow-[0_0_8px_#ff4b4b]' : 'bg-transparent border-[#27272a]'}`}
              />
            ))}
            <span className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ml-2 ${market.streak >= targetStreak ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'}`}>
              {market.streak >= targetStreak ? 'EXECUTING...' : `STREAK: ${market.streak}/${targetStreak}`}
            </span>
          </div>
      </div>
      
      {market.history1kCount !== undefined && market.history1kCount > 0 && (
        <div className="mt-6 pt-6 border-t border-[#27272a]">
          <div className="text-sm font-semibold tracking-wider mb-4 text-[#e4e4e7]">
            Last {market.history1kCount} Ticks Analysis
          </div>
          <div className="flex items-center justify-between gap-6">
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between text-sm sm:text-base mb-2 font-mono">
                <span className="text-[#00ff9c]">EVEN</span>
                <span className="text-[#00ff9c] font-bold">
                  {((market.history1kEvens! / market.history1kCount) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-[#27272a] h-2.5 sm:h-3 rounded-full overflow-hidden">
                <div 
                  className="bg-[#00ff9c] h-full transition-all duration-300" 
                  style={{ width: `${(market.history1kEvens! / market.history1kCount) * 100}%` }}
                />
              </div>
            </div>
            
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between text-sm sm:text-base mb-2 font-mono">
                <span className="text-[#00b0ff]">ODD</span>
                <span className="text-[#00b0ff] font-bold">
                  {((market.history1kOdds! / market.history1kCount) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-[#27272a] h-2.5 sm:h-3 rounded-full overflow-hidden flex justify-end">
                <div 
                  className="bg-[#00b0ff] h-full transition-all duration-300" 
                  style={{ width: `${(market.history1kOdds! / market.history1kCount) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
