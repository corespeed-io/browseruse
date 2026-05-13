/**
 * JSON-RPC 2.0 envelope types.
 */

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  const m = msg as any;
  return m?.jsonrpc === '2.0' && typeof m.method === 'string' && m.id !== undefined;
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  const m = msg as any;
  return m?.jsonrpc === '2.0' && typeof m.method === 'string' && m.id === undefined;
}

export function isResponse(msg: unknown): msg is JsonRpcResponse {
  const m = msg as any;
  return m?.jsonrpc === '2.0' && (m.result !== undefined || m.error !== undefined);
}

export function makeSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function makeError(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export function makeRequest(id: JsonRpcId, method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

export function makeNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  return { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
}
