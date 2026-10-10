import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  filtersToSearch,
  parseFilters,
  toApiParams,
  withFilters,
} from './filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('menu filters ↔ URL', () => {
  it('round-trips every filter through the query string', () => {
    const qs =
      '?q=latte&category=milk-coffee&type=BEANS&tag=vegan&min_price=3&max_price=12.50&seasonal=true&bestseller=true&new=true&ordering=-price&page=3';
    const filters = parse(qs);
    expect(filters).toMatchObject({
      q: 'latte',
      category: 'milk-coffee',
      type: 'BEANS',
      tag: 'vegan',
      minPrice: '3',
      maxPrice: '12.50',
      seasonal: true,
      bestseller: true,
      isNew: true,
      ordering: '-price',
      page: 3,
    });
    expect(new URLSearchParams(filtersToSearch(filters))).toEqual(new URLSearchParams(qs));
  });

  it('omits defaults so /menu stays clean', () => {
    expect(filtersToSearch(EMPTY_FILTERS)).toBe('');
  });

  it('ignores malformed values the API would reject', () => {
    const f = parse('?type=NOPE&ordering=hacker&min_price=abc&page=-4&tag=a b&seasonal=maybe');
    expect(f).toMatchObject({
      type: '',
      ordering: '',
      minPrice: '',
      page: 1,
      tag: '',
      seasonal: false,
    });
  });

  it('changing any filter resets paging, paging keeps the filters', () => {
    const base = parse('?type=FOOD&page=4');
    expect(withFilters(base, { tag: 'vegan' }).page).toBe(1);
    expect(withFilters(base, { page: 5 })).toMatchObject({ page: 5, type: 'FOOD' });
  });

  it('counts only narrowing filters', () => {
    expect(activeFilterCount(parse('?q=x&ordering=price&page=2'))).toBe(0);
    expect(activeFilterCount(parse('?type=FOOD&seasonal=true&min_price=2'))).toBe(3);
  });

  it('builds API params: category from the route, branch, page size', () => {
    const params = toApiParams(parse('?type=BEANS&min_price=5&page=2'), {
      category: 'coffee-beans',
      branch: 'riverside',
    });
    expect(params).toEqual({
      category: 'coffee-beans',
      type: 'BEANS',
      min_price: '5',
      branch: 'riverside',
      page_size: 24,
      page: 2,
    });
  });
});
