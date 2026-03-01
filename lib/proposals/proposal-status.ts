/**
 * Proposal status, type utilities and voting threshold constants
 * Aligned with Intersect Gov Tool / syncgovhub.com reference
 */

export type ProposalDisplayStatus =
  | "Active"
  | "Enacted"
  | "Expired"
  | "Ratified"
  | "Passed"
  | "NotPassed"
  | "Dropped"
  | "Unknown";

export type ProposalDisplayType =
  | "TreasuryWithdrawal"
  | "ParameterChangeGovernance"
  | "ParameterChangeNetwork"
  | "ParameterChangeEconomic"
  | "ParameterChangeTechnical"
  | "InfoAction"
  | "HardForkInitiation"
  | "NoConfidence"
  | "UpdateCommittee"
  | "NewConstitution"
  | "Unknown";

/** Map raw status strings → canonical display status */
export function resolveDisplayStatus(raw: string | undefined | null): ProposalDisplayStatus {
  if (!raw) return "Unknown";
  const v = raw.toLowerCase().trim();

  if (v.includes("enacted")) return "Enacted";
  if (v.includes("ratified")) return "Ratified";
  if (v.includes("expired")) return "Expired";
  if (v.includes("dropped")) return "Dropped";
  if (v.includes("active") || v.includes("voting") || v.includes("open")) return "Active";
  if (
    v.includes("passed") ||
    v.includes("approved") ||
    v.includes("funded") ||
    v.includes("completed")
  )
    return "Passed";
  if (v.includes("failed") || v.includes("rejected") || v.includes("notpassed")) return "NotPassed";
  return "Unknown";
}

/** CSS class suffix for status badges */
export function statusBadgeClass(status: ProposalDisplayStatus): string {
  const map: Record<ProposalDisplayStatus, string> = {
    Active: "status-active",
    Enacted: "status-enacted",
    Ratified: "status-ratified",
    Passed: "status-passed",
    Expired: "status-expired",
    NotPassed: "status-failed",
    Dropped: "status-dropped",
    Unknown: "status-unknown",
  };
  return map[status] ?? "status-unknown";
}

/** Map raw action/type strings → canonical display type */
export function resolveProposalType(raw: string | undefined | null): ProposalDisplayType {
  if (!raw) return "Unknown";
  const v = raw.toLowerCase().replace(/[_\s-]/g, "");

  if (v.includes("treasurywithdrawal") || v.includes("treasury")) return "TreasuryWithdrawal";
  if (v.includes("hardforkinitiation") || v.includes("hardfork")) return "HardForkInitiation";
  if (v.includes("noconfidence")) return "NoConfidence";
  if (v.includes("updatecommittee") || v.includes("committeeupdate")) return "UpdateCommittee";
  if (v.includes("newconstitution") || v.includes("constitution")) return "NewConstitution";
  if (v.includes("infoaction") || v.includes("info")) return "InfoAction";

  // Parameter change sub-types
  if (v.includes("parameterchange") || v.includes("protocalparam") || v.includes("ppchange")) {
    // Governance subtype: committee sizes, thresholds, constitution
    if (
      v.includes("governance") ||
      v.includes("committee") ||
      v.includes("drep") ||
      v.includes("threshold")
    )
      return "ParameterChangeGovernance";
    // Network subtype: block size, mem units, tx size
    if (
      v.includes("network") ||
      v.includes("block") ||
      v.includes("memory") ||
      v.includes("transaction") ||
      v.includes("mem")
    )
      return "ParameterChangeNetwork";
    // Economic subtype: min fee, treasury, reserves
    if (
      v.includes("economic") ||
      v.includes("fee") ||
      v.includes("treasury") ||
      v.includes("monetary")
    )
      return "ParameterChangeEconomic";
    // Technical subtype: script execution
    if (v.includes("technical") || v.includes("plutus") || v.includes("script"))
      return "ParameterChangeTechnical";
    return "ParameterChangeNetwork"; // default parameter change
  }

  return "Unknown";
}

/**
 * Whether SPO voting is allowed for this proposal type.
 * Reference: TreasuryWithdrawal and ParameterChange(Governance/Economic/Technical) do NOT allow SPO votes.
 * InfoAction, HardForkInitiation, NoConfidence, UpdateCommittee, NewConstitution → SPO allowed.
 */
export function spoVotingAllowed(type: ProposalDisplayType): boolean {
  const noSpo: ProposalDisplayType[] = [
    "TreasuryWithdrawal",
    "ParameterChangeGovernance",
    "ParameterChangeEconomic",
    "ParameterChangeTechnical",
    "NewConstitution",
    "UpdateCommittee",
  ];
  return !noSpo.includes(type);
}

/** Voting thresholds per role and proposal type (fraction 0-1) */
export interface VotingThresholds {
  drep: number | null;   // null = not applicable
  spo: number | null;
  cc: number | null;
}

export function getVotingThresholds(type: ProposalDisplayType): VotingThresholds {
  switch (type) {
    case "TreasuryWithdrawal":
      return { drep: 0.67, spo: null, cc: 0.67 };
    case "ParameterChangeGovernance":
      return { drep: 0.75, spo: null, cc: 0.67 };
    case "ParameterChangeNetwork":
      return { drep: 0.51, spo: 0.51, cc: 0.60 };
    case "ParameterChangeEconomic":
      return { drep: 0.67, spo: null, cc: 0.67 };
    case "ParameterChangeTechnical":
      return { drep: 0.67, spo: null, cc: 0.67 };
    case "HardForkInitiation":
      return { drep: 0.60, spo: 0.51, cc: 0.60 };
    case "NoConfidence":
      return { drep: 0.51, spo: 0.51, cc: null };
    case "UpdateCommittee":
      return { drep: 0.67, spo: null, cc: null };
    case "NewConstitution":
      return { drep: 0.75, spo: null, cc: 0.67 };
    case "InfoAction":
      return { drep: 0.67, spo: 0.51, cc: 0.67 };
    default:
      return { drep: 0.67, spo: 0.51, cc: 0.67 };
  }
}

/** ADA formatting: compact with lovelace→ADA conversion */
export function adaCompact(lovelace: number | undefined | null): string {
  if (!lovelace) return "0 ₳";
  const ada = lovelace / 1_000_000;
  if (ada >= 1_000_000_000) return `${(ada / 1_000_000_000).toFixed(2)}B ₳`;
  if (ada >= 1_000_000) return `${(ada / 1_000_000).toFixed(2)}M ₳`;
  if (ada >= 1_000) return `${(ada / 1_000).toFixed(2)}K ₳`;
  return `${ada.toFixed(2)} ₳`;
}