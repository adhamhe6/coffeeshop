import { Outlet } from 'react-router';
import { CartSheetProvider } from '@/features/cart/components/CartSheet';
import { AnnouncementBar } from '@/features/storefront/components/AnnouncementBar';
import { Footer } from '@/features/storefront/components/Footer';
import { Header } from '@/features/storefront/components/Header';

/** Public shell: skip link, announcement bar, sticky header, routed content, footer. */
export default function StorefrontLayout() {
  return (
    <CartSheetProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-espresso px-4 py-2.5 text-sm font-medium text-cream focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to main content
        </a>
        <AnnouncementBar />
        <Header />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <Outlet />
        </main>
        <Footer />
      </div>
    </CartSheetProvider>
  );
}
