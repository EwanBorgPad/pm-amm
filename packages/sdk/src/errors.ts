/**
 * Map a thrown Anchor error to the program's named error, using the error
 * table baked into the IDL. Cheap, table-driven, optional to use.
 */
import idl from "./idl/pm_amm.json";

export interface PmAmmError {
  code: number;
  name: string;
  msg?: string;
}

const ERROR_TABLE: Map<number, PmAmmError> = new Map(
  ((idl as { errors?: PmAmmError[] }).errors ?? []).map((e) => [e.code, e]),
);

/** The full IDL error list (code → name / message). */
export const PM_AMM_ERRORS: ReadonlyMap<number, PmAmmError> = ERROR_TABLE;

/**
 * Extract a `PmAmmError` from a thrown value. Anchor surfaces custom errors as
 * `custom program error: 0x<hex>` or `Custom(<dec>)` inside the message; we
 * also match the error *name* directly (the program emits it in logs). Returns
 * null if no known program error can be identified.
 */
export function mapAnchorError(err: unknown): PmAmmError | null {
  const msg = err instanceof Error ? err.message : String(err);

  // 1. Hex custom code: "custom program error: 0x1771"
  const hex = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hex) {
    const code = parseInt(hex[1], 16);
    const found = ERROR_TABLE.get(code);
    if (found) return found;
  }

  // 2. Decimal custom code: "Custom(6001)"
  const dec = msg.match(/Custom\((\d+)\)/);
  if (dec) {
    const found = ERROR_TABLE.get(parseInt(dec[1], 10));
    if (found) return found;
  }

  // 3. Error name appearing verbatim in the message / logs.
  for (const e of ERROR_TABLE.values()) {
    if (msg.includes(e.name)) return e;
  }

  return null;
}
