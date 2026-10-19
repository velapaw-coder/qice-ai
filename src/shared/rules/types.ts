export type Tier = "go" | "verify" | "reject";

export type ConditionLevel = "hard" | "soft";

export type RuleOp =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "in"
  | "not_in"
  | "contains_any"
  | "years_since_gte"
  | "years_since_lte"
  | "exists";

export interface RuleCondition {
  field: string;
  op: RuleOp;
  value?: unknown;
  level: ConditionLevel;
  text: string;
  verify?: string;
}

export interface PerHeadEstimate {
  type: "per_head_capped";
  count_field: string;
  candidate_field?: string | null;
  rate: number;
  cap_field?: string | null;
}

export interface SsRatioEstimate {
  type: "ss_ratio";
  count_field: string;
  candidate_field?: string | null;
  ratio: number;
  months: number;
  personal_field?: string;
  headcount_field?: string;
}

export type Estimate = PerHeadEstimate | SsRatioEstimate;

export interface PolicyRule {
  code: string;
  name: string;
  category: string;
  regions: string[];
  entity_types: string[];
  conditions: RuleCondition[];
  estimate?: Estimate | null;
  cap_tier?: "verify" | null;
  basis?: string;
  url?: string;
  show_when_rejected?: boolean;
  policy_version_id?: string;
}

export interface EvalItem {
  code: string;
  name: string;
  category: string;
  tier: Tier;
  conditions_text: string;
  verify_text: string;
  reason: string;
  basis?: string;
  url?: string;
  policy_version_id?: string;
  in_estimate: boolean;
  estimate_low: number;
  estimate_high: number;
  cap_tier?: "verify" | null;
}

export interface EvalResult {
  items: EvalItem[];
  estimate_low: number;
  estimate_high: number;
  region_uncovered: boolean;
}

export type Profile = Record<string, unknown>;
export type StaffMap = Record<string, number>;
