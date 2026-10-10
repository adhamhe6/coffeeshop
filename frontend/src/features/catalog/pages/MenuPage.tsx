import { CatalogBrowse } from '../CatalogBrowse';

/** `/menu`: sectioned overview, or a filtered/sorted/paged grid when any filter, sort or page is in the URL. */
export default function MenuPage() {
  return <CatalogBrowse mode="menu" />;
}
