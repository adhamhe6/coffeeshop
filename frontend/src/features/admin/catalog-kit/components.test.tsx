import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ImageUploader } from './ImageUploader';
import { SortableList } from './SortableList';

const png = (name = 'a.png', size = 200) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

describe('ImageUploader', () => {
  it('refuses unsupported types and oversized files without calling onSelect', async () => {
    const onSelect = vi.fn();
    render(<ImageUploader label="Main image" src={null} onSelect={onSelect} />);
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    // `userEvent.upload` honours `accept`, so dispatch the change directly to exercise our own checks.
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' });
    await userEvent.upload(input, gif, { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported file type');
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await userEvent.upload(input, big);
    expect(await screen.findByRole('alert')).toHaveTextContent(/too large.*5 MB/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('passes a valid file to onSelect and clears any earlier error', async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ImageUploader label="Main image" src={null} onSelect={onSelect} />);
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await userEvent.upload(input, new File(['x'], 'a.gif', { type: 'image/gif' }), {
      applyAccept: false,
    });
    await screen.findByRole('alert');
    const file = png();
    await userEvent.upload(input, file);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(file));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("shows the server's message when the upload is rejected", async () => {
    const onSelect = vi.fn().mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'invalid_image',
        message: 'The file is not a valid image. Upload a JPEG, PNG or WebP file.',
        fields: { image: ['The file is not a valid image. Upload a JPEG, PNG or WebP file.'] },
      }),
    );
    render(
      <ImageUploader
        label="Main image"
        src="/media/x.webp"
        onSelect={onSelect}
        onRemove={vi.fn()}
      />,
    );
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, png());
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid image');
  });
});

function Harness({ onChange }: { onChange?: (ids: string[]) => void }) {
  const [items, setItems] = useState(['Espresso', 'Latte', 'Mocha']);
  return (
    <SortableList
      label="Menu"
      items={items}
      getId={(i) => i}
      getLabel={(i) => i}
      renderItem={(i) => <span>{i}</span>}
      onReorder={(next) => {
        setItems(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SortableList', () => {
  it('moves items with the keyboard-accessible buttons, announces the move and keeps focus on the moved row', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Move Espresso up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Mocha down' })).toBeDisabled();

    const down = screen.getByRole('button', { name: 'Move Espresso down' });
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['Latte', 'Espresso', 'Mocha']);
    expect(screen.getByRole('status')).toHaveTextContent('Espresso moved to position 2 of 3.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move Espresso down' })).toHaveFocus(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Move Espresso down' }));
    expect(onChange).toHaveBeenLastCalledWith(['Latte', 'Mocha', 'Espresso']);
    // at the bottom the "down" button is disabled, so focus falls back to "up"
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move Espresso up' })).toHaveFocus(),
    );
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Latte');
  });
});
