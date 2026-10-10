import { useParams } from 'react-router';
import { useAuth } from '@/app/auth';
import { Button, EmptyState, ErrorState, Skeleton } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import {
  useAdminCategories,
  useAdminCollections,
  useAdminGroups,
  useAdminProduct,
  useAdminTags,
} from '@/lib/api/adminCatalog';
import { isApiError } from '@/lib/api/errors';
import { Link } from 'react-router';
import { ProductEditor } from '../components/ProductEditor';

function EditorSkeleton() {
  return (
    <div className="grid max-w-4xl gap-4" aria-busy="true" aria-label="Loading product">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** `/admin/products/new` and `/admin/products/:id`. */
export default function AdminProductEditorPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const { hasCapability } = useAuth();
  const canManage = hasCapability('catalog.manage');
  useSeo({ title: isNew ? 'New product · Admin' : 'Edit product · Admin', noindex: true });

  const product = useAdminProduct(isNew ? undefined : id);
  const categories = useAdminCategories();
  const groups = useAdminGroups();
  const collections = useAdminCollections();
  const tags = useAdminTags();

  if (isNew && !canManage) {
    return (
      <EmptyState
        as="h1"
        title="You cannot create products"
        description="Your role can view the catalogue but not change it."
        action={
          <Button asChild variant="secondary">
            <Link to="/admin/products">Back to products</Link>
          </Button>
        }
      />
    );
  }

  if (!isNew && product.isError) {
    const notFound = isApiError(product.error) && product.error.status === 404;
    return notFound ? (
      <EmptyState
        as="h1"
        title="Product not found"
        description="It may have been deleted, or you may not have access to it."
        action={
          <Button asChild variant="secondary">
            <Link to="/admin/products">Back to products</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={product.error} onRetry={() => void product.refetch()} />
    );
  }

  const failed = [categories, groups, collections, tags].find((q) => q.isError);
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;

  const loading =
    (!isNew && product.isPending) ||
    categories.isPending ||
    groups.isPending ||
    collections.isPending ||
    tags.isPending;
  if (loading || !categories.data || !groups.data || !collections.data || !tags.data) {
    return <EditorSkeleton />;
  }
  if (!isNew && !product.data) return <EditorSkeleton />;

  const productId = product.data?.id;
  const collectionIds = productId
    ? collections.data.filter((c) => c.product_ids.includes(productId)).map((c) => c.id)
    : [];

  return (
    <ProductEditor
      key={productId ?? 'new'}
      product={product.data}
      collectionIds={collectionIds}
      categories={categories.data}
      groups={groups.data}
      collections={collections.data}
      tags={tags.data}
      readOnly={!canManage}
      canViewInventory={hasCapability('inventory.view')}
    />
  );
}
