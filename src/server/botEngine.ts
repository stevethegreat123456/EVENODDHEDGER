import { Server } from "socket.io";
import WebSocket from "ws";
import { getSupabase } from "./supabase.ts";

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const HISTORY_SIZE = 50;

interface MarketState {
  symbol: string;
  price: number;
  digit: number;
  streak: number;
  evenStreak: number;
  oddStreak: number;
  history: Int8Array;
  historyIndex: number;
}

const markets = ['R_100']; // Only R_100
const marketStates: Record<string, MarketState> = {};

markets.forEach(symbol => {
  marketStates[symbol] = {
    symbol,
    price: 0,
    digit: 0,
    streak: 0,
    evenStreak: 0,
    oddStreak: 0,
    history: new Int8Array(HISTORY_SIZE).fill(-1),
    historyIndex: 0
  };
});

let ws: WebSocket | null = null;
let isRunning = false;
let currentSettings: any = null;
let currentBalance = 0;

let cycleNetPnL = 0;
let nextEvenStake = 0.35;
let nextOddStake = 0.35;
let cycleActive = false;

let globalCurrentStake = 1;
let isTradeActive = false;
let sessionPnL = 0;
let lastLostSymbol: string | null = null;
let cumulativeLoss = 0;
let stopScheduledAndWaitingForRecovery = false;
let deadlockTimeoutId: any = null;
let lastTradeAttemptTime = 0; // Added to prevent concurrent signal processing

let expectedCallbacks = 0;
let batchPnL = 0;
let batchSymbol: string | null = null;

let pendingUpdates: Record<string, any> = {};
let batchTimeout: any = null;

let pendingContracts: Record<number, { customId: string, symbol: string, stake: number, timestamp: number, type: string }> = {}; 
let reqIdToData: Record<number, { symbol: string, type: string }> = {};
let pingInterval: any = null;
let reqIdCounter = Math.floor(Date.now() / 1000);

let ioServer: Server | null = null;

async function saveSettings(settings: any) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('bot_data').upsert({ id: 'settings', data: settings, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

let lastStateSaveTime = 0;
async function saveState(force = false) {
  try {
    const now = Date.now();
    if (!force && now - lastStateSaveTime < 2000) return;
    lastStateSaveTime = now;
    
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('bot_data').upsert({
      id: 'state',
      data: {
        isRunning,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol: lastLostSymbol || null,
      },
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

function postMessage(event: any) {
  if (ioServer) {
    ioServer.emit('bot_event', event);
  }
  
  if (event && event.type === 'TRADE_RESULT') {
    saveTrade(event);
  }
}

async function saveTrade(tradeEvent: any) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from('bot_trades').insert({
      id: tradeEvent.id,
      market: tradeEvent.market || 'UNKNOWN',
      buy_price: tradeEvent.buyPrice || 0,
      timestamp: tradeEvent.timestamp || Date.now(),
      result: tradeEvent.result,
      pnl: tradeEvent.pnl,
      entry_tick: tradeEvent.entryTick,
      exit_tick: tradeEvent.exitTick,
      entry_digit: tradeEvent.entryDigit,
      exit_digit: tradeEvent.exitDigit,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error('Supabase error saving trade:', error);
    }
  } catch (err) {
    console.error('Error saving trade:', err);
  }
}

let lastCheckedMinute: string | null = null;
const scheduleInterval = setInterval(() => {
  if (!currentSettings || !currentSettings.useSchedule) return;

  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const current = `${hh}:${mm}`;

  if (lastCheckedMinute !== current) {
    lastCheckedMinute = current;

    if (currentSettings.startTime && current === currentSettings.startTime) {
      if (!isRunning) {
        isRunning = true;
        globalCurrentStake = currentSettings.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        cycleActive = false;
        cycleNetPnL = 0;
        lastLostSymbol = null;
        markets.forEach(m => { 
          marketStates[m].streak = 0; 
          marketStates[m].evenStreak = 0;
          marketStates[m].oddStreak = 0;
        });
        connect();
        postMessage({ type: 'SCHEDULE_START' });
      }
    }

    if (currentSettings.stopTime && current === currentSettings.stopTime) {
      if (isRunning) {
        if (cycleActive || cumulativeLoss > 0) {
          stopScheduledAndWaitingForRecovery = true;
        } else {
          isRunning = false;
          cycleActive = false;
          markets.forEach(m => { 
            marketStates[m].streak = 0;
            marketStates[m].evenStreak = 0;
            marketStates[m].oddStreak = 0;
          });
          postMessage({ type: 'SCHEDULE_STOP' });
        }
      }
    }
  }
}, 1000);

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('{"ping":1}');
      }
    }, 10000);

    if (currentSettings?.apiToken) {
      ws.send(JSON.stringify({ authorize: currentSettings.apiToken }));
    } else {
      postMessage({ type: 'STATUS', status: 'connected' });
      subscribeToTicks();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
    postMessage({ type: 'ERROR', message: `WS Error: ${err.message}` });
  });

  ws.on('message', (messageBuffer) => {
    let data;
    try {
      data = JSON.parse(messageBuffer.toString());
    } catch (e) {
      console.error('Invalid JSON from WS:', e);
      return;
    }

    if (data.error) {
      postMessage({ type: 'ERROR', message: data.error.message });
      if (data.echo_req && data.echo_req.req_id) {
         const reqId = data.echo_req.req_id;
         if (reqIdToData[reqId]) {
           delete reqIdToData[reqId];
           // Only reset if BOTH fail, or just reset to avoid broken state
           expectedCallbacks = 0;
           if (deadlockTimeoutId) {
             clearTimeout(deadlockTimeoutId);
             deadlockTimeoutId = null;
           }
         }
      }
      return;
    }

    if (data.msg_type === 'authorize') {
      postMessage({ type: 'STATUS', status: 'connected' });
      if (data.authorize && data.authorize.balance) {
        currentBalance = data.authorize.balance;
      }
      ws?.send('{"balance":1,"subscribe":1}');
      subscribeToTicks();
      ws?.send('{"proposal_open_contract":1,"subscribe":1}');
    }

    if (data.msg_type === 'balance') {
      currentBalance = data.balance.balance;
      postMessage({ type: 'BALANCE', balance: data.balance.balance });
    }

    if (data.msg_type === 'tick') {
      handleTick(data.tick);
    }

    if (data.msg_type === 'buy') {
      handleBuy(data.buy, data.echo_req);
    }

    if (data.msg_type === 'proposal_open_contract') {
      handleContractUpdate(data.proposal_open_contract);
    }

    if (data.msg_type === 'topup_virtual') {
      ws?.send('{"balance":1}');
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    postMessage({ type: 'STATUS', status: 'disconnected' });
    if (isRunning) {
      setTimeout(connect, 2000);
    }
  });
}

function subscribeToTicks() {
  markets.forEach(symbol => {
    ws?.send(JSON.stringify({ ticks: symbol }));
  });
}

function handleTick(tickInfo: any) {
  const symbol = tickInfo.symbol;
  const state = marketStates[symbol];
  if (!state) return;

  const price = tickInfo.quote;
  const pipSize = tickInfo.pip_size || 4;
  const digit = Math.round(price * Math.pow(10, pipSize)) % 10;

  state.price = price;
  state.digit = digit;

  postMessage({ type: 'DIGIT_STAT', digit });

  if (isRunning && currentSettings) {
    if (!cycleActive) {
      if (digit % 2 === 0) {
        state.evenStreak += 1;
        state.oddStreak = 0;
      } else {
        state.oddStreak += 1;
        state.evenStreak = 0;
      }

      state.streak = Math.max(state.evenStreak, state.oddStreak);

      if (state.evenStreak === currentSettings.targetStreak || state.oddStreak === currentSettings.targetStreak) {
        cycleActive = true;
        cycleNetPnL = 0;
        nextEvenStake = Math.max(0.35, currentSettings.globalStake);
        nextOddStake = Math.max(0.35, currentSettings.globalStake);
        expectedCallbacks = 0;
        // Immediately fire trades so the buy order is queued for the very next tick
        executeCycleTrades(symbol);
      }
    } else {
      if (expectedCallbacks === 0) {
        // Fallback in case of timeout or manual reset
        executeCycleTrades(symbol);
      }
    }
  } else {
    // If stopped, just track normally
    if (digit % 2 === 0) {
      state.evenStreak += 1;
      state.oddStreak = 0;
    } else {
      state.oddStreak += 1;
      state.evenStreak = 0;
    }
    state.streak = Math.max(state.evenStreak, state.oddStreak);
  }

  state.history[state.historyIndex] = digit;
  state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;

  queueUpdate(symbol, state);
}

function executeCycleTrades(symbol: string) {
  if (!cycleActive || !isRunning || expectedCallbacks > 0) return;
  
  const stakeEven = nextEvenStake;
  const stakeOdd = nextOddStake;
  batchPnL = 0;
  expectedCallbacks = 2; // Expect both even and odd responses
  executeBuyAsymmetric(symbol, 'DIGITEVEN', stakeEven);
  executeBuyAsymmetric(symbol, 'DIGITODD', stakeOdd);
}

function queueUpdate(symbol: string, state: MarketState) {
  const unwrappedHistory = new Array(HISTORY_SIZE);
  for (let i = 0; i < HISTORY_SIZE; i++) {
    unwrappedHistory[i] = state.history[(state.historyIndex + i) % HISTORY_SIZE];
  }

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    currentDigit: state.digit,
    streak: state.streak,
    streakHistory: unwrappedHistory
  };

  if (!batchTimeout) {
    batchTimeout = setTimeout(() => {
      postMessage({ type: 'MARKET_UPDATES', updates: pendingUpdates });
      pendingUpdates = {};
      batchTimeout = null;
    }, 250);
  }
}

function executeBuyAsymmetric(symbol: string, contractType: string, stake: number) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  
  reqIdToData[reqId] = { symbol, type: contractType };

  const rawPayloadString = `{"buy":1,"price":${stake},"parameters":{"amount":${stake},"basis":"stake","contract_type":"${contractType}","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}"},"req_id":${reqId}}`;
  
  ws.send(rawPayloadString);

  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }
  
  deadlockTimeoutId = setTimeout(() => {
    if (expectedCallbacks <= 0) return;
    
    // Deadlock triggered: no response for 10s. Treat as loss.
    const customId = reqId.toString();
    const pnl = -stake;
    
    postMessage({
      type: 'TRADE_RESULT',
      id: customId,
      market: symbol,
      buyPrice: stake,
      timestamp: Date.now(),
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });

    sessionPnL += pnl;
    
    if (currentSettings && isRunning) {
      if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      }
    }
  }, 10000);
}

function handleBuy(buyInfo: any, echo_req: any) {
  const contractId = buyInfo.contract_id;
  const reqId = echo_req.req_id;
  if (reqId) {
    const data = reqIdToData[reqId];
    if (data) {
      pendingContracts[contractId] = { 
        customId: reqId.toString(), 
        symbol: data.symbol,
        type: data.type,
        stake: Number(buyInfo.buy_price) || globalCurrentStake,
        timestamp: Number(buyInfo.start_time) * 1000 || Date.now()
      };
      delete reqIdToData[reqId];
    }
  }
}

function handleContractUpdate(contract: any) {
  if (!contract.is_expired && !contract.is_sold) {
    return;
  }

  const pendingData = pendingContracts[contract.contract_id];
  if (!pendingData) {
    if (!contract.__retries) contract.__retries = 0;
    if (contract.__retries < 5 && (contract.contract_type === 'DIGITEVEN' || contract.contract_type === 'DIGITODD')) {
      contract.__retries++;
      setTimeout(() => handleContractUpdate(contract), 250);
    }
    return;
  }

  const { customId, symbol, type } = pendingData;
  const pnl = Number(contract.profit) || 0;
  const isWin = pnl > 0;

  const entryTickStr = contract.entry_tick_display_value || String(contract.entry_tick || '');
  const exitTickStr = contract.exit_tick_display_value || String(contract.exit_tick || '');
  const entryDigit = entryTickStr ? parseInt(entryTickStr.slice(-1), 10) : undefined;
  const exitDigit = exitTickStr ? parseInt(exitTickStr.slice(-1), 10) : undefined;

  postMessage({
    type: 'TRADE_RESULT',
    id: customId,
    market: symbol,
    buyPrice: contract.buy_price || globalCurrentStake,
    timestamp: contract.date_start ? contract.date_start * 1000 : Date.now(),
    result: isWin ? 'won' : 'lost',
    pnl: pnl,
    entryTick: entryTickStr,
    exitTick: exitTickStr,
    entryDigit,
    exitDigit
  });

  delete pendingContracts[contract.contract_id];
  batchPnL += pnl;
  
  if (type === 'DIGITEVEN') {
    nextEvenStake = isWin ? Math.max(0.35, currentSettings.globalStake) : Math.ceil((nextEvenStake * 2.2) * 100) / 100;
  } else if (type === 'DIGITODD') {
    nextOddStake = isWin ? Math.max(0.35, currentSettings.globalStake) : Math.ceil((nextOddStake * 2.2) * 100) / 100;
  }

  expectedCallbacks -= 1;

  if (expectedCallbacks <= 0) {
    if (deadlockTimeoutId) {
      clearTimeout(deadlockTimeoutId);
      deadlockTimeoutId = null;
    }
  
    // Cycle evaluation
    cycleNetPnL += batchPnL;
    sessionPnL += batchPnL;

    if (cycleNetPnL > 0) {
      cycleActive = false;
      const state = marketStates[symbol];
      if (state) {
          state.evenStreak = 0;
          state.oddStreak = 0;
          state.streak = 0;
      }
      nextEvenStake = Math.max(0.35, currentSettings.globalStake);
      nextOddStake = Math.max(0.35, currentSettings.globalStake);
      
      if (stopScheduledAndWaitingForRecovery) {
        isRunning = false;
        stopScheduledAndWaitingForRecovery = false;
        postMessage({ type: 'SCHEDULE_STOP' });
      }
    } else {
      lastLostSymbol = symbol;
    }
    
    batchPnL = 0;

    if (currentSettings && isRunning) {
      if (sessionPnL >= currentSettings.takeProfit) {
        isRunning = false;
        cycleActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Take Profit Hit!' });
      } else if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        cycleActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      } else if (cycleActive) {
        // Immediately fire the next cycle trades to avoid waiting for the next tick event, executing faster.
        executeCycleTrades(symbol);
      }
    }
  }
    
  if (ioServer) {
    const isReady = ws && ws.readyState === 1; // WebSocket.OPEN is 1
    ioServer.emit('bot_sync', {
        isRunning,
        currentSettings,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol,
        isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
        isTradeActive: cycleActive,
        connectionStatus: isReady ? 'connected' : 'disconnected'
    });
  }
  saveState();
}

export async function initBot() {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    
    const { data: settingsRow } = await supabase.from('bot_data').select('data').eq('id', 'settings').single();
    if (settingsRow && settingsRow.data) {
      currentSettings = settingsRow.data;
    }
    
    const { data: stateRow } = await supabase.from('bot_data').select('data').eq('id', 'state').single();
    if (stateRow && stateRow.data) {
      const stateData = stateRow.data;
      isRunning = stateData?.isRunning || false;
      globalCurrentStake = stateData?.globalCurrentStake || 1;
      sessionPnL = stateData?.sessionPnL || 0;
      cumulativeLoss = stateData?.cumulativeLoss || 0;
      lastLostSymbol = stateData?.lastLostSymbol || null;
      
      // Auto resume
      if (isRunning && currentSettings) {
        connect();
      }
    }
  } catch (err) {
    console.error('Error loading DB state:', err);
  }
}

export function startBotEngine(io: Server) {
  ioServer = io;

  io.on('connection', (socket) => {
    const isReady = ws && ws.readyState === WebSocket.OPEN;
    // Send immediate sync data to newly connected client
    socket.emit('bot_sync', {
        isRunning,
        currentSettings,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol,
        isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
        isTradeActive,
        connectionStatus: isReady ? 'connected' : 'disconnected'
    });
    
    // Fetch past trades
    const supabase = getSupabase();
    if (supabase) {
      supabase.from('bot_trades').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
        if (data && data.length > 0) {
           const pastTrades = data.reverse().map(t => ({
             type: 'TRADE_RESULT',
             id: t.id,
             market: t.market,
             buyPrice: t.buy_price,
             timestamp: t.timestamp,
             result: t.result,
             pnl: t.pnl,
             entryTick: t.entry_tick,
             exitTick: t.exit_tick,
             entryDigit: t.entry_digit,
             exitDigit: t.exit_digit
           }));
           socket.emit('past_trades', pastTrades);
        }
      }).then(undefined, err => console.error('Error fetching past trades:', err));
    }

    socket.on('worker_command', (data: any) => {
      if (data.type === 'REQUEST_SYNC') {
        const isReady = ws && ws.readyState === WebSocket.OPEN;
        socket.emit('bot_sync', {
            isRunning,
            currentSettings,
            globalCurrentStake,
            sessionPnL,
            cumulativeLoss,
            lastLostSymbol,
            isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
            isTradeActive,
            connectionStatus: isReady ? 'connected' : 'disconnected'
        });
        if (supabase) {
          supabase.from('bot_trades').select('*').order('created_at', { ascending: false }).limit(50).then(({ data: tradeData }) => {
            if (tradeData && tradeData.length > 0) {
               const pastTrades = tradeData.reverse().map(t => ({
                 type: 'TRADE_RESULT',
                 id: t.id,
                 market: t.market,
                 buyPrice: t.buy_price,
                 timestamp: t.timestamp,
                 result: t.result,
                 pnl: t.pnl,
                 entryTick: t.entry_tick,
                 exitTick: t.exit_tick,
                 entryDigit: t.entry_digit,
                 exitDigit: t.exit_digit
               }));
               socket.emit('past_trades', pastTrades);
            }
          }).then(undefined, err => console.error('Error fetching past trades sync:', err));
        }
      }

      if (data.type === 'UPDATE_SETTINGS') {
        const isNewToken = currentSettings?.apiToken !== data.settings?.apiToken;
        currentSettings = data.settings;
        
        saveSettings(currentSettings);

        // Also broadcast settings to other clients
        socket.broadcast.emit('bot_sync', { currentSettings });

        if (isNewToken && ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (!ws || ws.readyState !== WebSocket.OPEN) {
          connect();
        }
      }

      if (data.type === 'START') {
        currentSettings = data.settings;
        saveSettings(currentSettings);
        
        globalCurrentStake = currentSettings?.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        cycleActive = false;
        cycleNetPnL = 0;
        lastLostSymbol = null;
        sessionPnL = data.sessionPnL || 0;

        markets.forEach(m => { 
          marketStates[m].streak = 0;
          marketStates[m].evenStreak = 0;
          marketStates[m].oddStreak = 0;
        });

        isRunning = true;
        saveState(true);

        connect();
        io.emit('bot_sync', { isRunning: true }); // Notify all
      }

      if (data.type === 'STOP') {
        isRunning = false;
        isTradeActive = false;
        cycleActive = false;
        stopScheduledAndWaitingForRecovery = false;
        markets.forEach(m => { 
          marketStates[m].streak = 0;
          marketStates[m].evenStreak = 0;
          marketStates[m].oddStreak = 0;
        });
        saveState(true);
        
        io.emit('bot_sync', { isRunning: false }); // Notify all
      }

      if (data.type === 'TOPUP') {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send('{"topup_virtual":1}');
        }
      }
    });
  });
}
