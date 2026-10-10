import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { AnnouncementsPanel } from '../components/AnnouncementsPanel';
import { BlocksPanel } from '../components/BlocksPanel';
import { NewsletterPanel } from '../components/NewsletterPanel';
import { PagesPanel } from '../components/PagesPanel';

const TABS = ['pages', 'blocks', 'announcements', 'newsletter'] as const;
type TabKey = (typeof TABS)[number];

/** `/admin/content` — website pages, homepage blocks, the announcement bar and the newsletter list. */
export default function ContentAdminPage() {
  useSeo({ title: 'Website content', noindex: true });
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab');
  const tab: TabKey = (TABS as readonly string[]).includes(raw ?? '') ? (raw as TabKey) : 'pages';

  return (
    <div>
      <AdminPageHeader
        title="Website content"
        description="Edit the words and pictures visitors see. Changes go live as soon as you save."
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSp(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('tab', v);
              next.delete('page');
              next.delete('search');
              next.delete('is_active');
              next.delete('ordering');
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList aria-label="Content sections">
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="blocks">Homepage blocks</TabsTrigger>
          <TabsTrigger value="announcements">Announcement bar</TabsTrigger>
          <TabsTrigger value="newsletter">Newsletter</TabsTrigger>
        </TabsList>
        <TabsContent value="pages">
          <PagesPanel />
        </TabsContent>
        <TabsContent value="blocks">
          <BlocksPanel />
        </TabsContent>
        <TabsContent value="announcements">
          <AnnouncementsPanel />
        </TabsContent>
        <TabsContent value="newsletter">
          <NewsletterPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
