import type { ReactNode } from 'react';
import type { ComponentType } from 'react';
import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import RootLayout from './RootLayout';
import { RequireAuth, RequireCapability, RequireStaff } from './guards';
import { ADMIN_CAPABILITY_BY_PATH } from '@/features/admin/nav';
import ErrorPage from '@/features/storefront/pages/ErrorPage';
import StorefrontLayout from './layouts/StorefrontLayout';

/** `lazy` helper: route modules default-export their page component, so each route is its own chunk. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({
  Component: (await load()).default,
});

const guardedPage =
  (load: () => Promise<{ default: ComponentType }>, guard: (el: ReactNode) => ReactNode) =>
  async () => {
    const Page = (await load()).default;
    return { element: guard(<Page />) };
  };

const customer = (load: () => Promise<{ default: ComponentType }>) =>
  guardedPage(load, (el) => <RequireAuth>{el}</RequireAuth>);

const adminPage = (path: string, load: () => Promise<{ default: ComponentType }>) =>
  guardedPage(load, (el) => (
    <RequireCapability capability={ADMIN_CAPABILITY_BY_PATH[path] ?? 'dashboard.view'}>
      {el}
    </RequireCapability>
  ));

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      {
        element: <StorefrontLayout />,
        children: [
          {
            errorElement: <ErrorPage />,
            children: [
              { index: true, lazy: page(() => import('@/features/storefront/pages/HomePage')) },
              { path: 'menu', lazy: page(() => import('@/features/catalog/pages/MenuPage')) },
              {
                path: 'menu/:category',
                lazy: page(() => import('@/features/catalog/pages/CategoryPage')),
              },
              { path: 'p/:slug', lazy: page(() => import('@/features/catalog/pages/ProductPage')) },
              { path: 'search', lazy: page(() => import('@/features/catalog/pages/SearchPage')) },
              {
                path: 'favorites',
                lazy: page(() => import('@/features/catalog/pages/FavoritesPage')),
              },
              { path: 'cart', lazy: page(() => import('@/features/cart/pages/CartPage')) },
              {
                path: 'checkout',
                lazy: page(() => import('@/features/checkout/pages/CheckoutPage')),
              },
              {
                path: 'pay/demo/:reference',
                lazy: page(() => import('@/features/checkout/pages/DemoPaymentPage')),
              },
              {
                path: 'orders/:number/confirmation',
                lazy: customer(() => import('@/features/orders/pages/OrderConfirmationPage')),
              },
              {
                path: 'orders/:number',
                lazy: customer(() => import('@/features/orders/pages/OrderTrackingPage')),
              },
              {
                path: 'account',
                lazy: customer(() => import('@/features/account/pages/ProfilePage')),
              },
              {
                path: 'account/addresses',
                lazy: customer(() => import('@/features/account/pages/AddressesPage')),
              },
              {
                path: 'account/orders',
                lazy: customer(() => import('@/features/account/pages/OrdersPage')),
              },
              {
                path: 'verify-email',
                lazy: page(() => import('@/features/account/pages/VerifyEmailPage')),
              },
              {
                path: 'account/notifications',
                lazy: customer(() => import('@/features/account/pages/NotificationsPage')),
              },
              { path: 'login', lazy: page(() => import('@/features/account/pages/LoginPage')) },
              {
                path: 'register',
                lazy: page(() => import('@/features/account/pages/RegisterPage')),
              },
              {
                path: 'forgot-password',
                lazy: page(() => import('@/features/account/pages/ForgotPasswordPage')),
              },
              {
                path: 'reset-password',
                lazy: page(() => import('@/features/account/pages/ResetPasswordPage')),
              },
              {
                path: 'locations',
                lazy: page(() => import('@/features/storefront/pages/LocationsPage')),
              },
              { path: 'about', lazy: page(() => import('@/features/storefront/pages/AboutPage')) },
              {
                path: 'contact',
                lazy: page(() => import('@/features/storefront/pages/ContactPage')),
              },
              { path: 'faq', lazy: page(() => import('@/features/storefront/pages/FaqPage')) },
              {
                path: 'privacy',
                lazy: page(() => import('@/features/storefront/pages/PrivacyPage')),
              },
              { path: 'terms', lazy: page(() => import('@/features/storefront/pages/TermsPage')) },
              {
                path: 'refund-policy',
                lazy: page(() => import('@/features/storefront/pages/RefundPolicyPage')),
              },
              { path: '*', lazy: page(() => import('@/features/storefront/pages/NotFoundPage')) },
            ],
          },
        ],
      },
      {
        // The whole admin area (layout + pages) is lazy: customers never download it.
        path: 'admin',
        errorElement: <ErrorPage />,
        lazy: async () => {
          const { default: AdminLayout } = await import('./layouts/AdminLayout');
          return {
            element: (
              <RequireStaff>
                <AdminLayout />
              </RequireStaff>
            ),
          };
        },
        children: [
          {
            index: true,
            lazy: adminPage('/admin', () => import('@/features/admin/overview/pages/OverviewPage')),
          },
          {
            path: 'orders',
            lazy: adminPage(
              '/admin/orders',
              () => import('@/features/admin/orders/pages/OrdersQueuePage'),
            ),
          },
          {
            path: 'orders/:number',
            lazy: adminPage(
              '/admin/orders',
              () => import('@/features/admin/orders/pages/OrderDetailPage'),
            ),
          },
          {
            path: 'products',
            lazy: adminPage(
              '/admin/products',
              () => import('@/features/admin/products/pages/ProductsListPage'),
            ),
          },
          {
            path: 'products/new',
            lazy: adminPage(
              '/admin/products',
              () => import('@/features/admin/products/pages/ProductEditorPage'),
            ),
          },
          {
            path: 'products/:id',
            lazy: adminPage(
              '/admin/products',
              () => import('@/features/admin/products/pages/ProductEditorPage'),
            ),
          },
          {
            path: 'categories',
            lazy: adminPage(
              '/admin/categories',
              () => import('@/features/admin/categories/pages/CategoriesPage'),
            ),
          },
          {
            path: 'options',
            lazy: adminPage(
              '/admin/options',
              () => import('@/features/admin/options/pages/OptionsPage'),
            ),
          },
          {
            path: 'collections',
            lazy: adminPage(
              '/admin/collections',
              () => import('@/features/admin/collections/pages/CollectionsPage'),
            ),
          },
          {
            path: 'inventory',
            lazy: adminPage(
              '/admin/inventory',
              () => import('@/features/admin/inventory/pages/InventoryPage'),
            ),
          },
          {
            path: 'branches',
            lazy: adminPage(
              '/admin/branches',
              () => import('@/features/admin/branches/pages/BranchesPage'),
            ),
          },
          {
            path: 'customers',
            lazy: adminPage(
              '/admin/customers',
              () => import('@/features/admin/customers/pages/CustomersPage'),
            ),
          },
          {
            path: 'customers/:id',
            lazy: adminPage(
              '/admin/customers',
              () => import('@/features/admin/customers/pages/CustomerDetailPage'),
            ),
          },
          {
            path: 'coupons',
            lazy: adminPage(
              '/admin/coupons',
              () => import('@/features/admin/coupons/pages/CouponsPage'),
            ),
          },
          {
            path: 'coupons/new',
            lazy: adminPage(
              '/admin/coupons',
              () => import('@/features/admin/coupons/pages/CouponEditorPage'),
            ),
          },
          {
            path: 'coupons/:id',
            lazy: adminPage(
              '/admin/coupons',
              () => import('@/features/admin/coupons/pages/CouponEditorPage'),
            ),
          },
          {
            path: 'reviews',
            lazy: adminPage(
              '/admin/reviews',
              () => import('@/features/admin/reviews/pages/ReviewsPage'),
            ),
          },
          {
            path: 'payments',
            lazy: adminPage(
              '/admin/payments',
              () => import('@/features/admin/payments/pages/PaymentsPage'),
            ),
          },
          {
            path: 'staff',
            lazy: adminPage('/admin/staff', () => import('@/features/admin/staff/pages/StaffPage')),
          },
          {
            path: 'reports',
            lazy: adminPage(
              '/admin/reports',
              () => import('@/features/admin/reports/pages/ReportsPage'),
            ),
          },
          {
            path: 'content',
            lazy: adminPage(
              '/admin/content',
              () => import('@/features/admin/content/pages/ContentAdminPage'),
            ),
          },
          {
            path: 'social',
            lazy: adminPage(
              '/admin/social',
              () => import('@/features/admin/social/pages/SocialPage'),
            ),
          },
          {
            path: 'settings',
            lazy: adminPage(
              '/admin/settings',
              () => import('@/features/admin/settings/pages/SettingsPage'),
            ),
          },
          {
            path: 'audit-log',
            lazy: adminPage(
              '/admin/audit-log',
              () => import('@/features/admin/audit-log/pages/AuditLogPage'),
            ),
          },
          { path: '*', lazy: page(() => import('@/features/storefront/pages/NotFoundPage')) },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
