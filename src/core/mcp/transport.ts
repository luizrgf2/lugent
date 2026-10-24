import type { JsonRpcMessage } from "./protocol"

export interface TransportHandlers {
  onMessage(msg: JsonRpcMessage): void
  onError(err: Error): void
  onClose(): void
}

export interface Transport {
  start(handlers: TransportHandlers): Promise<void>
  send(msg: JsonRpcMessage): Promise<void>
  close(): Promise<void>
  closeSync(): void   // process-exit path: never awaits
}
