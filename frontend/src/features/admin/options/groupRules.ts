import type { AdminModifierOption, SelectionType } from '@/lib/api/adminCatalog';

/**
 * Selection rules for a modifier group, mirroring the server (`AdminModifierGroupSerializer.validate`):
 *  - choose-one groups allow exactly one selection (max 1);
 *  - a required group needs min >= 1, an optional group has min 0;
 *  - min cannot exceed max; max is at least 1;
 *  - at most `max` active options may be pre-selected (default).
 * The server stays the authority; this gives instant feedback while editing.
 */
export interface GroupRules {
  selection_type: SelectionType;
  is_required: boolean;
  min_select: number;
  max_select: number;
}

export interface GroupRuleErrors {
  min_select?: string;
  max_select?: string;
}

export function validateGroupRules(r: GroupRules): GroupRuleErrors {
  const errors: GroupRuleErrors = {};
  if (!Number.isInteger(r.max_select) || r.max_select < 1) {
    errors.max_select = 'Must be at least 1.';
  } else if (r.selection_type === 'SINGLE' && r.max_select !== 1) {
    errors.max_select = 'A choose-one group allows exactly one selection.';
  }
  if (!Number.isInteger(r.min_select) || r.min_select < 0) {
    errors.min_select = 'Cannot be negative.';
  } else if (!errors.max_select && r.min_select > r.max_select) {
    errors.min_select = 'Minimum cannot exceed the maximum.';
  } else if (r.is_required && r.min_select < 1) {
    errors.min_select = 'A required group needs a minimum of at least 1.';
  } else if (!r.is_required && r.min_select > 0) {
    errors.min_select = 'Only required groups can have a minimum above 0.';
  }
  return errors;
}

/** Apply the implied values when the type or required flag changes. */
export function normaliseGroupRules(r: GroupRules): GroupRules {
  if (r.selection_type === 'SINGLE') {
    return { ...r, max_select: 1, min_select: r.is_required ? 1 : 0 };
  }
  return {
    ...r,
    min_select: r.is_required ? Math.max(1, r.min_select) : 0,
    max_select: Math.max(1, r.max_select),
  };
}

/** Customer-facing instruction, e.g. "Choose 1", "Choose up to 3", "Choose 1 to 2". */
export function selectionHint(g: GroupRules): string {
  if (g.selection_type === 'SINGLE') return g.is_required ? 'Choose 1' : 'Choose up to 1';
  if (g.min_select > 0 && g.min_select === g.max_select) return `Choose ${g.max_select}`;
  if (g.min_select > 0) return `Choose ${g.min_select} to ${g.max_select}`;
  return `Choose up to ${g.max_select}`;
}

/** More active defaults than the group allows? Returns the server's message, else null. */
export function defaultsProblem(
  options: Pick<AdminModifierOption, 'is_default' | 'is_active'>[],
  maxSelect: number,
): string | null {
  const defaults = options.filter((o) => o.is_default && o.is_active).length;
  return defaults > maxSelect ? `At most ${maxSelect} option(s) can be the default.` : null;
}
