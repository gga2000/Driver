// The masked-call bridge lives in shared/ so الرجعة (garage mode "اتصل") and خطوط (guardian call) use
// the same one without importing the chat module (which would close an import cycle through notify).
export * from '../../shared/call-bridge.js';
