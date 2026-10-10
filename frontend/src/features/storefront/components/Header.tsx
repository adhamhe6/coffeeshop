import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Menu, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Dialog, DialogContent, IconButton, Logo } from '@/design';
import { AccountMenu } from '@/features/account/components/AccountMenu';
import { NotificationsBell } from '@/features/account/components/NotificationsBell';
import { CartButton } from '@/features/cart/components/CartButton';
import { BranchSelector } from '@/features/catalog/components/BranchSelector';
import { FavoritesLink } from '@/features/catalog/components/FavoritesLink';
import { isNavActive, PRIMARY_NAV } from '../nav';
import { MobileNav } from './MobileNav';
import { SearchBox } from './SearchBox';

function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

export function Header() {
  const scrolled = useScrolled();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b bg-surface/92 backdrop-blur-md transition-[border-color,box-shadow] duration-[var(--duration-base)]',
        scrolled ? 'border-border shadow-xs' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-[var(--header-h)] max-w-[92rem] items-center gap-3 px-[var(--gutter)] lg:gap-8">
        {/* Mobile: menu button */}
        <div className="flex flex-1 items-center lg:hidden">
          <IconButton
            label="Open menu"
            icon={<Menu aria-hidden="true" className="size-[1.375rem]" />}
            onClick={() => setNavOpen(true)}
            aria-haspopup="dialog"
          />
        </div>

        <Link
          to="/"
          aria-label="Lantern Coffee Roasters, home"
          className="rounded-md text-text lg:flex-none"
        >
          <Logo title="" className="h-9 w-auto lg:h-10" />
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV.map((item) => {
              const active = isNavActive(item, location.pathname, location.search);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative inline-flex h-10 items-center rounded-md px-3.5 text-[0.9375rem] font-medium text-text-muted transition-colors hover:text-text',
                      'after:absolute after:inset-x-3.5 after:bottom-1 after:h-0.5 after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-[var(--duration-base)] hover:after:scale-x-100',
                      active && 'text-text after:scale-x-100',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex flex-1 items-center justify-end gap-0.5 lg:flex-none">
          <BranchSelector variant="header" className="mr-1 hidden lg:inline-flex" />
          <SearchBox className="mr-2 hidden w-60 transition-[width] focus-within:w-80 lg:block" />
          <div className="lg:hidden">
            <IconButton
              label="Search"
              icon={<Search aria-hidden="true" className="size-[1.375rem]" />}
              onClick={() => setSearchOpen(true)}
              aria-haspopup="dialog"
            />
          </div>
          <div className="hidden sm:block">
            <FavoritesLink />
          </div>
          <div className="hidden lg:block">
            <NotificationsBell />
          </div>
          <div className="hidden lg:block">
            <AccountMenu />
          </div>
          <CartButton />
        </div>
      </div>

      <MobileNav open={navOpen} onOpenChange={setNavOpen} />

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent
          title="Search"
          hideTitle
          hideClose
          className="top-[12%] max-w-xl -translate-y-0 data-[state=open]:animate-pop-in"
        >
          <div className="flex items-center gap-2">
            <SearchBox className="flex-1" onNavigate={() => setSearchOpen(false)} />
            <Button variant="ghost" size="sm" onClick={() => setSearchOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
