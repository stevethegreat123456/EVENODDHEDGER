import React from 'react';
import { useStore, MarketData } from '../store/useStore';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  const lastLostSymbol = useStore((state) => state.lastLostSymbol);
  const isWaitingForRecovery = useStore((state) => state.isWaitingForRecovery);
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 w-full max-h-full overflow-y-auto pr-2 pb-4">
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
    <div className={`bg-[#111114] border rounded-lg p-4 sm:p-5 flex flex-col justify-between gap-4 transition-colors ${isCloseToTarget ? 'border-[#ffb000]/50 shadow-[0_0_10px_rgba(255,176,0,0.1)]' : isTargetMet ? 'border-[#ff4b4b] shadow-[0_0_10px_rgba(255,75,75,0.2)]' : 'border-[#27272a]'}`}>
      <div className="flex justify-between items-start">
        <div className="font-bold text-lg sm:text-xl truncate">
            {market.name}
            {inRecoveryThisSymbol && (
              <span className="ml-2 text-[10px] sm:text-xs bg-[#ff4b4b]/20 text-[#ff4b4b] px-1.5 py-0.5 rounded font-mono uppercase">
                Recovery
              </span>
            )}
        </div>
        <div className="text-[10px] sm:text-xs font-semibold text-[#00ff9c] flex items-center gap-1.5 whitespace-nowrap ml-2">
          <div className="w-1.5 h-1.5 bg-[#00ff9c] rounded-full animate-pulse" /> SCANNING
        </div>
      </div>
      
      <div className="font-mono text-3xl sm:text-4xl font-bold tracking-tight">
        {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
      </div>
      
      <div className="flex gap-1.5 sm:gap-2 flex-wrap items-center mt-1">
        {history.map((digit, i) => {
          if (digit === -1) return <div key={i} className="w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center font-mono text-sm sm:text-base rounded bg-white/5 border border-[#27272a]" />;
          
          const isEven = digit % 2 === 0;
          return (
            <div 
              key={i} 
              className={`w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center font-mono text-sm sm:text-base rounded border ${isEven ? 'bg-[#00ff9c]/20 text-[#00ff9c] border-[#00ff9c]' : 'bg-[#00b0ff]/20 text-[#00b0ff] border-[#00b0ff]'}`}
            >
              {digit}
            </div>
          );
        })}
      </div>
      
      <div className="flex flex-col mt-2">
          <div className="flex items-center gap-1.5 mt-1">
            {Array.from({ length: targetStreak }).map((_, i) => (
              <div 
                key={i} 
                className={`w-3 h-3 rounded-full border ${i < market.streak ? 'bg-[#ff4b4b] border-[#ff4b4b] shadow-[0_0_6px_#ff4b4b]' : 'bg-transparent border-[#27272a]'}`}
              />
            ))}
            <span className={`text-[10px] sm:text-xs font-semibold uppercase tracking-wider ml-2 ${market.streak >= targetStreak ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'}`}>
              {market.streak >= targetStreak ? 'EXECUTING...' : `STREAK: ${market.streak}/${targetStreak}`}
            </span>
          </div>
      </div>
      
      {market.history1kCount !== undefined && market.history1kCount > 0 && (
        <div className="mt-3 pt-4 border-t border-[#27272a]">
          <div className="text-xs font-semibold tracking-wider mb-3 text-[#e4e4e7]">
            Last {market.history1kCount} Ticks
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between text-[10px] sm:text-xs mb-1.5 font-mono">
                <span className="text-[#00ff9c]">EVEN</span>
                <span className="text-[#00ff9c] font-bold">
                  {((market.history1kEvens! / market.history1kCount) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-[#27272a] h-1.5 sm:h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-[#00ff9c] h-full transition-all duration-300" 
                  style={{ width: `${(market.history1kEvens! / market.history1kCount) * 100}%` }}
                />
              </div>
            </div>
            
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between text-[10px] sm:text-xs mb-1.5 font-mono">
                <span className="text-[#00b0ff]">ODD</span>
                <span className="text-[#00b0ff] font-bold">
                  {((market.history1kOdds! / market.history1kCount) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-[#27272a] h-1.5 sm:h-2 rounded-full overflow-hidden flex justify-end">
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
