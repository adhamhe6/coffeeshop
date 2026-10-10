import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, validateImageFile } from './imageFile';
import { moveItem } from './reorder';
import { runBulk } from '../products/bulk';

const file = (name: string, type: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type });

describe('validateImageFile', () => {
  it('accepts JPEG, PNG and WebP within the size limit', () => {
    expect(validateImageFile(file('a.jpg', 'image/jpeg'))).toBeNull();
    expect(validateImageFile(file('a.png', 'image/png'))).toBeNull();
    expect(validateImageFile(file('a.webp', 'image/webp'))).toBeNull();
  });
  it('rejects other types, empty files and oversized files', () => {
    expect(validateImageFile(file('a.gif', 'image/gif'))).toMatch(/Unsupported file type/);
    expect(validateImageFile(file('a.pdf', 'application/pdf'))).toMatch(/Unsupported/);
    expect(validateImageFile(file('a.png', 'image/png', 0))).toMatch(/empty/);
    expect(validateImageFile(file('big.png', 'image/png', IMAGE_MAX_BYTES + 1))).toMatch(
      /too large.*maximum is 5 MB/,
    );
  });
  it('falls back to the extension when the browser gives no type', () => {
    expect(validateImageFile(file('photo.JPG', ''))).toBeNull();
    expect(validateImageFile(file('notes.txt', ''))).toMatch(/Unsupported/);
  });
});

describe('moveItem', () => {
  it('moves and clamps without mutating', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(list, 9, 0)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('runBulk', () => {
  const items = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}` }));

  it('runs in order, continues after a failure and reports each result', async () => {
    const order: number[] = [];
    const progress: number[] = [];
    const { results, stopped } = await runBulk(
      items,
      async (i) => {
        order.push(i.id);
        if (i.id === 2) throw new Error('boom');
      },
      { describeError: (e) => (e as Error).message, onProgress: (done) => progress.push(done) },
    );
    expect(order).toEqual([1, 2, 3, 4]);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(stopped).toBe(false);
    expect(results.map((r) => r.ok)).toEqual([true, false, true, true]);
    expect(results[1]?.error).toBe('boom');
  });

  it('stops between items when asked', async () => {
    let stop = false;
    const { results, stopped } = await runBulk(
      items,
      async (i) => {
        if (i.id === 2) stop = true;
      },
      { describeError: String, shouldStop: () => stop },
    );
    expect(results).toHaveLength(2);
    expect(stopped).toBe(true);
  });
});
