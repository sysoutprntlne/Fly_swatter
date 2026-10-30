import type { ActionRecord, AiStatus, Category, ChatMessage, ChatSnapshot, ChatStatus, DemoScenarioSummary, DemoSpeed, DemoState, Flagged, Mode, PipelineSnapshot, PlaceCluster, RaidEvent, RiskLevel, RiskState, Settings } from '../../server/src/types';
export type { ActionRecord, AiStatus, Category, ChatMessage, ChatSnapshot, ChatStatus, DemoScenarioSummary, DemoSpeed, DemoState, Flagged, Mode, PipelineSnapshot, PlaceCluster, RaidEvent, RiskLevel, RiskState, Settings };
export interface DashboardHandlers {
  onSnapshot: (snapshot: ChatSnapshot) => void;
  onMessage: (message: ChatMessage) => void;
  onStatus: (status: ChatStatus) => void;
  onReset: () => void;
  onConnection: (connected: boolean) => void;
  onDemoState: (state: DemoState) => void;
  onDemoCleared: () => void;
  onRaid: (raid: RaidEvent) => void;
  onFlagged: (flagged: Flagged) => void;
  onClusters: (clusters: PlaceCluster[]) => void;
  onRisk: (risk: RiskState) => void;
  onAction: (record: ActionRecord) => void;
  onMode: (mode: Mode) => void;
  onSettings: (settings: Settings) => void;
  onAiStatus: (status: AiStatus) => void;
  onPipelineReset: (snapshot: PipelineSnapshot) => void;
}
export function connectDashboard(handlers: DashboardHandlers) {
  let socket: WebSocket;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout>;
  let watchdog: ReturnType<typeof setTimeout>;
  let attempts = 0;
  function connect() {
    if (stopped) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.onopen = () => { attempts = 0; handlers.onConnection(true); };
    socket.onmessage = event => {
      clearTimeout(watchdog); watchdog = setTimeout(() => socket.close(), 40_000);
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'snapshot') handlers.onSnapshot(message.payload as ChatSnapshot);
        else if (message.type === 'chat.message') handlers.onMessage(message.payload as ChatMessage);
        else if (message.type === 'status') handlers.onStatus(message.payload as ChatStatus);
        else if (message.type === 'chat.reset') handlers.onReset();
        else if (message.type === 'demo.state') handlers.onDemoState(message.payload as DemoState);
        else if (message.type === 'demo.cleared') handlers.onDemoCleared();
        else if (message.type === 'raid') handlers.onRaid(message.payload as RaidEvent);
        else if (message.type === 'classification') handlers.onFlagged(message.payload as Flagged);
        else if (message.type === 'cluster.updated') handlers.onClusters(message.payload as PlaceCluster[]);
        else if (message.type === 'risk.updated') handlers.onRisk(message.payload as RiskState);
        else if (message.type === 'action.taken') handlers.onAction(message.payload as ActionRecord);
        else if (message.type === 'mode') handlers.onMode(message.payload as Mode);
        else if (message.type === 'settings') handlers.onSettings(message.payload as Settings);
        else if (message.type === 'ai.status') handlers.onAiStatus(message.payload as AiStatus);
        else if (message.type === 'pipeline.reset') handlers.onPipelineReset(message.payload as PipelineSnapshot);
      } catch { /* Ignore malformed frames; the next snapshot restores state. */ }
    };
    socket.onclose = () => {
      clearTimeout(watchdog);
      if (stopped) return;
      handlers.onConnection(false);
      retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempts++, 5)));
    };
    socket.onerror = () => socket.close();
  }
  connect();
  return () => { stopped = true; clearTimeout(retry); clearTimeout(watchdog); socket.close(); };
}
// Mutating routes need the local session cookie (fetched once on load) and a same-origin request.
export async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
