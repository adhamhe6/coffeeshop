import type { CartItem, ModifierGroup, ModifierOption } from '@/lib/api/types';

/** Selected option ids per modifier group id. */
export type Selection = Record<number, number[]>;

const isChoosable = (o: ModifierOption) => o.is_available !== false;

/** Required groups start with their default (or first available option); optional ones only with explicit defaults. */
export function defaultSelection(groups: readonly ModifierGroup[]): Selection {
  const out: Selection = {};
  for (const g of groups) {
    const available = g.options.filter(isChoosable);
    let picked = available.filter((o) => o.is_default).map((o) => o.id);
    if (g.selection_type === 'SINGLE') picked = picked.slice(0, 1);
    else picked = picked.slice(0, g.max_select || picked.length);
    if (picked.length === 0 && g.is_required && available[0]) {
      picked = [available[0].id];
    }
    // Multiple groups that need a minimum get their first options so the product is orderable straight away.
    if (g.selection_type === 'MULTIPLE' && picked.length < g.min_select) {
      for (const o of available) {
        if (picked.length >= g.min_select) break;
        if (!picked.includes(o.id)) picked.push(o.id);
      }
    }
    out[g.id] = picked;
  }
  return out;
}

/** Flattened `option_ids` in group order (what the quote/cart endpoints expect). */
export function optionIds(groups: readonly ModifierGroup[], selection: Selection): number[] {
  return groups.flatMap((g) => selection[g.id] ?? []);
}

export interface GroupProblem {
  groupId: number;
  message: string;
}

/** Effective minimum for a group: required groups need at least one. */
export const minFor = (g: ModifierGroup) => Math.max(g.min_select, g.is_required ? 1 : 0);
export const maxFor = (g: ModifierGroup) =>
  g.selection_type === 'SINGLE' ? 1 : Math.max(g.max_select, 1);

/** Short rule shown under the group title ("Choose 1", "Choose up to 3", "Optional"). */
export function groupRule(g: ModifierGroup): string {
  const min = minFor(g);
  const max = maxFor(g);
  if (g.selection_type === 'SINGLE') return g.is_required ? 'Choose 1' : 'Optional · choose 1';
  if (min === 0) return `Optional · up to ${max}`;
  if (min === max) return `Choose ${min}`;
  return `Choose ${min} to ${max}`;
}

/** UX-side validation mirroring the server rules; the quote endpoint stays the authority. */
export function validateSelection(
  groups: readonly ModifierGroup[],
  selection: Selection,
): GroupProblem[] {
  const problems: GroupProblem[] = [];
  for (const g of groups) {
    const n = (selection[g.id] ?? []).length;
    const min = minFor(g);
    const max = maxFor(g);
    if (n < min) {
      problems.push({
        groupId: g.id,
        message:
          min === 1
            ? `Choose an option for ${g.display_name}.`
            : `Choose at least ${min} for ${g.display_name}.`,
      });
    } else if (n > max) {
      problems.push({
        groupId: g.id,
        message: `Choose at most ${max} for ${g.display_name}.`,
      });
    }
  }
  return problems;
}

/** Toggle one option respecting SINGLE/MULTIPLE semantics and the group's maximum. */
export function toggleOption(g: ModifierGroup, selection: Selection, optionId: number): Selection {
  const current = selection[g.id] ?? [];
  if (g.selection_type === 'SINGLE') {
    // Optional single groups can be cleared by choosing the selected option again.
    const next = current.includes(optionId) ? (g.is_required ? current : []) : [optionId];
    return { ...selection, [g.id]: next };
  }
  if (current.includes(optionId))
    return { ...selection, [g.id]: current.filter((id) => id !== optionId) };
  if (current.length >= maxFor(g)) return selection;
  return { ...selection, [g.id]: [...current, optionId] };
}

export function setSingle(g: ModifierGroup, selection: Selection, optionId: number | null) {
  return { ...selection, [g.id]: optionId === null ? [] : [optionId] };
}

/**
 * Rebuild a selection from a cart line. Cart lines store option snapshots (`group` + `name`), not ids, so options are
 * matched by group display name and option name. Anything that no longer exists is dropped (the quote will say so).
 */
export function selectionFromCartItem(
  groups: readonly ModifierGroup[],
  options: CartItem['options'],
): Selection {
  const out: Selection = {};
  for (const g of groups) {
    out[g.id] = g.options
      .filter((o) => options.some((s) => s.group === g.display_name && s.name === o.name))
      .map((o) => o.id);
  }
  return out;
}
