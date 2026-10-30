import { EventEmitter } from 'node:events';
import type { ActionRecord, AiStatus, ChatMessage, ChatStatus, DemoState, Flagged, Mode, PipelineSnapshot, PlaceCluster, RaidEvent, RiskLevel, RiskState, Settings } from './types.js';
interface Events {
  'chat.message': ChatMessage; status: ChatStatus; 'chat.reset': null; raid: RaidEvent; 'demo.state': DemoState; 'demo.cleared': null;
  classification: Flagged; 'cluster.updated': PlaceCluster[]; 'cluster.swarm': PlaceCluster; 'risk.updated': RiskState;
  'risk.level_changed': { from: RiskLevel; to: RiskLevel }; 'action.taken': ActionRecord; mode: Mode; settings: Settings; 'ai.status': AiStatus; 'pipeline.reset': PipelineSnapshot;
}
export class Bus {
  private emitter = new EventEmitter();
  emit<K extends keyof Events>(event: K, payload: Events[K]) { this.emitter.emit(event, payload); }
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }
}
