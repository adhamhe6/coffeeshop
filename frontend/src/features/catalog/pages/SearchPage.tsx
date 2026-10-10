import { CatalogBrowse } from '../CatalogBrowse';

/** `/search?q=`: relevance-ordered results (the API is typo tolerant), facets, and a helpful no-results state. */
export default function SearchPage() {
  return <CatalogBrowse mode="search" />;
}
