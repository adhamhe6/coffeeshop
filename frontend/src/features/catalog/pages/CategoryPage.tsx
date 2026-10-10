import { useParams } from 'react-router';
import { CatalogBrowse } from '../CatalogBrowse';

/** `/menu/:category`: category intro banner + filterable grid. */
export default function CategoryPage() {
  const { category } = useParams();
  return <CatalogBrowse key={category} mode="category" categorySlug={category} />;
}
