import { describe, expect, it } from 'vitest';
import {
  defaultSelection,
  groupRule,
  optionIds,
  selectionFromCartItem,
  toggleOption,
  validateSelection,
} from './customiser';
import { cartLine, milkGroup, shotsGroup, sizeGroup, toppingGroup } from './testing/catalogMocks';

const groups = [sizeGroup, milkGroup, shotsGroup, toppingGroup];

describe('customiser rules', () => {
  it('preselects defaults, and the first option of required groups without one', () => {
    const sel = defaultSelection(groups);
    expect(sel[sizeGroup.id]).toEqual([1]); // default size
    expect(sel[milkGroup.id]).toEqual([3]); // optional group with an explicit default
    expect(sel[shotsGroup.id]).toEqual([]); // optional, no default
    // required MULTIPLE group with min 1: starts with its first option so the product is orderable
    expect(sel[toppingGroup.id]).toEqual([8]);
  });

  it('skips unavailable options when preselecting', () => {
    const sel = defaultSelection([
      {
        ...sizeGroup,
        options: [
          { id: 1, name: 'Small', price_delta: '0.00', is_default: true, is_available: false },
          { id: 2, name: 'Large', price_delta: '0.75', is_available: true },
        ],
      },
    ]);
    expect(sel[sizeGroup.id]).toEqual([2]);
  });

  it('flattens option ids in group order', () => {
    expect(optionIds(groups, { 1: [2], 2: [], 3: [6, 5], 4: [9] })).toEqual([2, 6, 5, 9]);
  });

  it('enforces min and max with helpful messages', () => {
    expect(validateSelection(groups, { 1: [1], 2: [], 3: [], 4: [] })).toEqual([
      { groupId: 4, message: 'Choose an option for Topping.' },
    ]);
    expect(validateSelection(groups, { 1: [1], 2: [], 3: [5, 6, 7], 4: [8] })).toEqual([
      { groupId: 3, message: 'Choose at most 2 for Extra shots.' },
    ]);
    expect(validateSelection(groups, defaultSelection(groups))).toEqual([]);
  });

  it('toggles MULTIPLE options up to the maximum and never beyond', () => {
    let sel = { 1: [1], 2: [], 3: [] as number[], 4: [8] };
    sel = toggleOption(shotsGroup, sel, 5) as typeof sel;
    sel = toggleOption(shotsGroup, sel, 6) as typeof sel;
    sel = toggleOption(shotsGroup, sel, 7) as typeof sel; // over max: ignored
    expect(sel[3]).toEqual([5, 6]);
    sel = toggleOption(shotsGroup, sel, 5) as typeof sel;
    expect(sel[3]).toEqual([6]);
  });

  it('SINGLE groups replace the choice; only optional ones can be cleared', () => {
    const sel = { 1: [1], 2: [3] };
    expect(toggleOption(sizeGroup, sel, 2)[1]).toEqual([2]);
    expect(toggleOption(sizeGroup, sel, 1)[1]).toEqual([1]); // required: stays selected
    expect(toggleOption(milkGroup, sel, 3)[2]).toEqual([]); // optional: cleared
  });

  it('describes each rule in plain words', () => {
    expect(groupRule(sizeGroup)).toBe('Choose 1');
    expect(groupRule(milkGroup)).toBe('Optional · choose 1');
    expect(groupRule(shotsGroup)).toBe('Optional · up to 2');
    expect(groupRule(toppingGroup)).toBe('Choose 1 to 2');
  });

  it('rebuilds a selection from a cart line by group and option name', () => {
    const sel = selectionFromCartItem(groups, cartLine().options);
    expect(sel).toEqual({ 1: [2], 2: [4], 3: [5], 4: [] });
  });
});
