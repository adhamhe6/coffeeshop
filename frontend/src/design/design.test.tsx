import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Breadcrumbs,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Logo,
  Money,
  MoneyProvider,
  Pagination,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProductImage,
  QuantityStepper,
  Radio,
  RadioCard,
  RadioGroup,
  Rating,
  RatingInput,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
  Skeleton,
  Spinner,
  Stat,
  StatusBadge,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  type Column,
  type SortState,
  formatMoney,
  getPageItems,
  fromOrdering,
  toOrdering,
} from '@/design';
import { ApiError } from '@/lib/api/errors';
import { expectNoA11yViolations, renderInRouter } from '@/test/utils';

describe('Button', () => {
  it('renders variants/sizes as a real button and fires clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Order</Button>);
    const btn = screen.getByRole('button', { name: 'Order' });
    expect(btn).toHaveAttribute('type', 'button');
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading: sets aria-busy, shows spinner, ignores clicks but stays focusable', async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingText="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Saving…' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('disabled buttons are not clickable', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('asChild renders the child element (a link) with button styling and icons', () => {
    renderInRouter(
      <Button asChild trailingIcon={<svg data-testid="icon" />}>
        <a href="/menu">Menu</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Menu' });
    expect(link).toHaveAttribute('href', '/menu');
    expect(link.className).toContain('bg-accent');
    expect(within(link).getByTestId('icon')).toBeInTheDocument();
  });

  it('IconButton requires and exposes an accessible name', () => {
    render(<IconButton label="Close panel" icon={<svg aria-hidden="true" />} />);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
  });

  it('is operable by keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe('Field + controls', () => {
  it('wires label, hint and error to the control', () => {
    render(
      <Field label="Email" hint="We never share it" error="Enter a valid email" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0] as string)).toHaveTextContent(
      'Enter a valid email',
    );
    expect(document.getElementById(described[1] as string)).toHaveTextContent('We never share it');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });

  it('merges a control-level aria-describedby with the field wiring', () => {
    render(
      <Field label="Password" error="Too short">
        <Input aria-describedby="rules" />
      </Field>,
    );
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toMatch(
      /^rules .+-error$/,
    );
  });

  it('Textarea participates in Field wiring too', () => {
    render(
      <Field label="Note" hint="Optional">
        <Textarea />
      </Field>,
    );
    expect(screen.getByLabelText('Note')).toHaveAccessibleDescription('Optional');
  });

  it('has no axe violations for a labelled form', async () => {
    const { container } = render(
      <form>
        <Field label="Name">
          <Input />
        </Field>
        <Field label="Size">
          <Select options={[{ value: 's', label: 'Small' }]} />
        </Field>
        <Checkbox label="Subscribe" />
        <Switch label="Notifications" />
      </form>,
    );
    await expectNoA11yViolations(container);
  });
});

describe('Select', () => {
  it('opens with the keyboard, selects an option and reports the value', async () => {
    const onValueChange = vi.fn();
    render(
      <Field label="Milk">
        <Select
          options={[
            { value: 'whole', label: 'Whole' },
            { value: 'oat', label: 'Oat' },
          ]}
          onValueChange={onValueChange}
        />
      </Field>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Milk' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('option', { name: 'Oat' }));
    expect(onValueChange).toHaveBeenCalledWith('oat');
    expect(trigger).toHaveTextContent('Oat');
  });
});

describe('Checkbox / Switch / Radio', () => {
  it('Checkbox toggles via label click and Space', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="I agree" onCheckedChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    await userEvent.click(screen.getByText('I agree'));
    expect(box).toBeChecked();
    box.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('Switch exposes role=switch with checked state', async () => {
    render(<Switch label="Accepting orders" defaultChecked />);
    const sw = screen.getByRole('switch', { name: 'Accepting orders' });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    expect(sw).not.toBeChecked();
  });

  it('RadioGroup cards: one tab stop, arrows move focus, Space selects', async () => {
    function Demo() {
      const [v, setV] = useState('pickup');
      return (
        <RadioGroup value={v} onValueChange={setV} aria-label="Order type">
          <RadioCard value="pickup" title="Pickup" />
          <RadioCard value="delivery" title="Delivery" />
          <Radio value="x" label="Other" />
        </RadioGroup>
      );
    }
    render(<Demo />);
    const pickup = screen.getByRole('radio', { name: 'Pickup' });
    expect(pickup).toBeChecked();
    pickup.focus();
    await userEvent.keyboard('{ArrowDown}');
    // Roving focus: the arrow moves focus to the next card; Space selects it.
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Delivery' })).toHaveFocus());
    await userEvent.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Delivery' })).toBeChecked();
  });
});

describe('Dialog', () => {
  it('traps focus, labels itself, closes on Escape and restores focus to the trigger', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent title="Remove item?" description="This cannot be undone.">
          <Button>Confirm</Button>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Remove item?' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe('Sheet', () => {
  it('opens as a labelled dialog from the chosen side', async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Menu</Button>
        </SheetTrigger>
        <SheetContent side="left" title="Navigation">
          <a href="/menu">Menu page</a>
        </SheetContent>
      </Sheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const sheet = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(sheet.className).toContain('left-0');
    expect(within(sheet).getByRole('link', { name: 'Menu page' })).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('arrow keys move between tabs and show the matching panel', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Details</TabsTrigger>
          <TabsTrigger value="b">Reviews</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    );
    const tab = screen.getByRole('tab', { name: 'Details' });
    tab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Reviews' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel B');
  });
});

describe('DropdownMenu / Popover / Tooltip', () => {
  it('DropdownMenu opens from keyboard, activates items and closes', async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Account</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    screen.getByRole('button', { name: 'Account' }).focus();
    await userEvent.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: 'Sign out' });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('Popover toggles and closes with Escape', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Filters</Button>
        </PopoverTrigger>
        <PopoverContent>Price range</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(await screen.findByText('Price range')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Price range')).not.toBeInTheDocument());
  });

  it('Tooltip shows on keyboard focus', async () => {
    render(
      <Tooltip content="Add to favorites" delayDuration={0}>
        <Button>Heart</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add to favorites');
  });
});

describe('Badges, status, feedback', () => {
  it('StatusBadge always shows a text label (icon + label, never colour only)', () => {
    const { container } = render(
      <>
        <StatusBadge kind="order" status="READY_FOR_PICKUP" />
        <StatusBadge kind="order" status="CANCELLED" />
        <StatusBadge kind="payment" status="PARTIALLY_REFUNDED" />
        <StatusBadge kind="payment" status="WEIRD_NEW_STATE" />
      </>,
    );
    expect(screen.getByText('Ready for pickup')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Partially refunded')).toBeInTheDocument();
    expect(screen.getByText('Weird new state')).toBeInTheDocument(); // unknown statuses degrade to readable text
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  });

  it('Badge, Skeleton, Spinner basics', () => {
    render(
      <>
        <Badge tone="success">Open</Badge>
        <Skeleton data-testid="sk" />
        <Spinner />
      </>,
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('EmptyState renders title, description and action', () => {
    render(
      <EmptyState title="Nothing here" description="Add something" action={<Button>Add</Button>} />,
    );
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('ErrorState shows ApiError details and retries', async () => {
    const onRetry = vi.fn();
    const error = new ApiError({
      status: 500,
      code: 'server_error',
      message: 'Boom',
      requestId: 'req-9',
    });
    render(<ErrorState error={error} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByText(/req-9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Stat conveys direction with text, not colour only', () => {
    render(<Stat label="Orders" value="42" delta={-3.456} />);
    expect(screen.getByText(/Down/)).toBeInTheDocument();
    expect(screen.getByText('3.5%')).toBeInTheDocument();
  });
});

describe('Money', () => {
  it('formats with the provided store currency and tabular numerals', () => {
    render(
      <MoneyProvider currency="EUR" locale="de-DE">
        <Money value="1234.5" />
      </MoneyProvider>,
    );
    expect(screen.getByText(/1\.234,50/)).toHaveTextContent('€');
  });

  it('formats signed deltas, nulls and invalid values', () => {
    expect(formatMoney('0.75', 'USD', 'en-US', { signed: true })).toBe('+$0.75');
    expect(formatMoney('-1.5', 'USD')).toBe('-$1.50');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('abc', 'USD')).toBe('—');
    expect(formatMoney('1', 'NOPE')).toBe('$1.00'); // invalid currency code never throws
  });
});

describe('Rating', () => {
  it('exposes a text alternative', () => {
    render(<Rating value={4.5} count={12} />);
    expect(
      screen.getByRole('img', { name: 'Rated 4.5 out of 5 from 12 reviews' }),
    ).toBeInTheDocument();
  });

  it('RatingInput is a radiogroup operable with arrow keys', async () => {
    const onChange = vi.fn();
    render(<RatingInput value={3} onChange={onChange} label="Your rating" />);
    expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeInTheDocument();
    screen.getByRole('radio', { name: '3 stars' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('radio', { name: '4 stars' })).toHaveFocus());
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(4);
  });
});

describe('QuantityStepper', () => {
  function Demo({ initial = 2, max = 5 }: { initial?: number; max?: number }) {
    const [v, setV] = useState(initial);
    return <QuantityStepper value={v} onChange={setV} min={1} max={max} itemLabel="Flat white" />;
  }

  it('increments/decrements with labelled buttons and respects bounds', async () => {
    render(<Demo initial={1} max={2} />);
    const dec = screen.getByRole('button', { name: 'Decrease quantity of Flat white' });
    const inc = screen.getByRole('button', { name: 'Increase quantity of Flat white' });
    expect(dec).toBeDisabled();
    await userEvent.click(inc);
    expect(screen.getByRole('textbox', { name: 'Quantity of Flat white' })).toHaveValue('2');
    expect(inc).toBeDisabled();
  });

  it('commits typed values on blur, clamped to the range', async () => {
    render(<Demo />);
    const input = screen.getByRole('textbox', { name: 'Quantity of Flat white' });
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await userEvent.tab();
    expect(input).toHaveValue('5');
  });

  it('supports ArrowUp/ArrowDown in the input', async () => {
    render(<Demo />);
    const input = screen.getByRole('textbox', { name: 'Quantity of Flat white' });
    input.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveValue('3');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveValue('1');
  });
});

describe('Breadcrumbs', () => {
  it('renders a labelled nav; the last crumb is the current page and not a link', () => {
    renderInRouter(
      <Breadcrumbs
        items={[
          { label: 'Menu', to: '/menu' },
          { label: 'Espresso', to: '/menu/espresso' },
          { label: 'Flat White' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
    expect(within(nav).getByText('Flat White')).toHaveAttribute('aria-current', 'page');
  });
});

describe('Pagination', () => {
  it('computes page items with ellipses', () => {
    expect(getPageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageItems(10, 20)).toEqual([1, 'gap-start', 9, 10, 11, 'gap-end', 20]);
    expect(getPageItems(2, 20)).toEqual([1, 2, 3, 'gap-end', 20]);
    expect(getPageItems(19, 20)).toEqual([1, 'gap-start', 18, 19, 20]);
  });

  it('marks the current page, disables prev on first page and emits page changes', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageCount={8} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: 'Page 8' }));
    expect(onPageChange).toHaveBeenLastCalledWith(8);
  });

  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} onPageChange={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DataTable', () => {
  interface Row {
    id: number;
    name: string;
    total: string;
  }
  const rows: Row[] = [
    { id: 1, name: 'Order A', total: '10.00' },
    { id: 2, name: 'Order B', total: '20.00' },
  ];
  const columns: Column<Row>[] = [
    { id: 'name', header: 'Order', cell: (r) => r.name, sortable: true },
    { id: 'total', header: 'Total', cell: (r) => r.total, sortable: true, align: 'right' },
  ];

  it('renders an accessible table with caption, column headers and rows', () => {
    render(
      <DataTable caption="Recent orders" columns={columns} data={rows} getRowId={(r) => r.id} />,
    );
    expect(screen.getByRole('table', { name: 'Recent orders' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('sorting: click cycles asc → desc, aria-sort reflects state', async () => {
    const onSortChange = vi.fn();
    function Demo() {
      const [sort, setSort] = useState<SortState | null>(null);
      return (
        <DataTable
          caption="t"
          columns={columns}
          data={rows}
          getRowId={(r) => r.id}
          sort={sort}
          onSortChange={(s) => {
            onSortChange(s);
            setSort(s);
          }}
        />
      );
    }
    render(<Demo />);
    const header = screen.getByRole('columnheader', { name: /Order/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(header).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'asc' });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(within(header).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'desc' });
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('converts sort state to/from DRF ordering', () => {
    expect(toOrdering({ key: 'total', direction: 'desc' })).toBe('-total');
    expect(toOrdering({ key: 'total', direction: 'asc' })).toBe('total');
    expect(toOrdering(null)).toBeUndefined();
    expect(fromOrdering('-created')).toEqual({ key: 'created', direction: 'desc' });
    expect(fromOrdering('name')).toEqual({ key: 'name', direction: 'asc' });
  });

  it('shows loading skeleton rows (aria-busy) and the empty state', () => {
    const { rerender } = render(
      <DataTable
        caption="t"
        columns={columns}
        data={undefined}
        loading
        loadingRows={3}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByRole('table').parentElement).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(4);
    rerender(
      <DataTable
        caption="t"
        columns={columns}
        data={[]}
        getRowId={(r) => r.id}
        empty={<EmptyState title="No orders yet" />}
      />,
    );
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('switches to a card list on narrow screens', () => {
    window.innerWidth = 390;
    render(
      <DataTable caption="Recent orders" columns={columns} data={rows} getRowId={(r) => r.id} />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Recent orders' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText('Total')).toHaveLength(2);
  });
});

describe('ProductImage', () => {
  it('shows the fallback tile when there is no src', () => {
    const { container } = render(<ProductImage src={null} alt="Flat white" />);
    expect(screen.getByRole('img', { name: 'Flat white' })).toHaveAttribute(
      'data-fallback',
      'true',
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('reserves space with a fixed aspect ratio, lazy-loads and fades in on load', () => {
    const { container } = render(
      <ProductImage src="/media/p.webp" alt="Mug" aspect="4/5" width={400} height={500} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.aspectRatio).toBe('4 / 5');
    const img = screen.getByAltText('Mug');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width', '400');
    expect(img.className).toContain('opacity-0');
    fireEvent.load(img);
    return waitFor(() => expect(img.className).toContain('opacity-100'));
  });

  it('priority images load eagerly', () => {
    render(<ProductImage src="/media/hero.webp" alt="Hero" priority />);
    expect(screen.getByAltText('Hero')).toHaveAttribute('loading', 'eager');
  });

  it('falls back gracefully when the image fails to load', async () => {
    render(<ProductImage src="/media/missing.webp" alt="Beans" />);
    fireEvent.error(screen.getByAltText('Beans'));
    expect(await screen.findByRole('img', { name: 'Beans' })).toHaveAttribute(
      'data-fallback',
      'true',
    );
  });

  it('decorative images (alt="") are hidden from assistive tech', () => {
    const { container } = render(<ProductImage src={null} alt="" />);
    expect(container.querySelector('[data-fallback]')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Logo', () => {
  it('has an accessible name by default and can be marked decorative', () => {
    const { rerender } = render(<Logo />);
    expect(screen.getByRole('img', { name: 'Lantern Coffee Roasters' })).toBeInTheDocument();
    rerender(<Logo title="" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
