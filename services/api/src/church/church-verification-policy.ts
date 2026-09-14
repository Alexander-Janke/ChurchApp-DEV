import { churchVerificationStates } from "./church-policy.js";

export type ChurchVerificationState = (typeof churchVerificationStates)[number];
type TransitionAuthority = "request" | "review";
// Domain classification, NEVER proof that a caller holds the named authority.
const transitions = Object.freeze([
  ["unverified", "pending", "request"],
  ["pending", "verified", "review"],
  ["pending", "rejected", "review"],
  ["rejected", "pending", "request"],
  ["verified", "revoked", "review"],
  ["revoked", "pending", "request"],
] as const);

export function parseChurchVerificationState(
  value: unknown,
): ChurchVerificationState {
  if (
    typeof value !== "string" ||
    !churchVerificationStates.some((state) => state === value)
  )
    throw new Error("Invalid church verification state");
  return value as ChurchVerificationState;
}
export type ChurchVerificationDecision =
  | {
      outcome: "unchanged" | "invalid_transition";
      from: ChurchVerificationState;
      to: ChurchVerificationState;
    }
  | {
      outcome: "transition";
      from: ChurchVerificationState;
      to: ChurchVerificationState;
      authority: TransitionAuthority;
    };

// Review decisions are pure domain policy only. No platform entitlement or
// cross-tenant review persistence is provided by this component.
export function evaluateChurchVerificationTransition(
  current: unknown,
  requested: unknown,
): ChurchVerificationDecision {
  const from = parseChurchVerificationState(current);
  const to = parseChurchVerificationState(requested);
  if (from === to) return { outcome: "unchanged", from, to };
  const transition = transitions.find(
    ([source, target]) => source === from && target === to,
  );
  if (!transition) return { outcome: "invalid_transition", from, to };
  return { outcome: "transition", from, to, authority: transition[2] };
}

export type VerificationRequestResult =
  | { outcome: "changed" | "unchanged"; state: "pending" }
  | { outcome: "invalid_transition"; state: ChurchVerificationState }
  | { outcome: "not_found" | "stale" };
