export const HERDR_PROTOCOL_MIN = 19;
export const HERDR_PROTOCOL_MAX = 20;

export function herdrProtocolCompatibilityMessage(protocol: number): string | undefined {
  if (protocol >= HERDR_PROTOCOL_MIN && protocol <= HERDR_PROTOCOL_MAX) return undefined;
  return `Unsupported Herdr protocol ${protocol}; this Control release supports ${HERDR_PROTOCOL_MIN}-${HERDR_PROTOCOL_MAX}`;
}
