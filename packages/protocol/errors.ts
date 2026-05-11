/**
 * JSON-RPC 2.0 error codes.
 *
 * Standard codes: -32700 to -32600.
 * Application codes: -32000 to -32099 (server error range).
 */

export const ErrorCodes = {
  // Standard JSON-RPC 2.0 errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Application-specific errors
  NOT_CONNECTED: -32000,
  EXTENSION_NOT_CONNECTED: -32001,
  EXTENSION_TIMEOUT: -32002,
  TAB_NOT_FOUND: -32003,
  ELEMENT_NOT_FOUND: -32004,
  EVAL_ERROR: -32005,
  CDP_ERROR: -32006,
  DEBUGGER_ATTACH_FAILED: -32007,
  DEBUGGER_DETACHED: -32008,
  NATIVE_HOST_ERROR: -32009,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
