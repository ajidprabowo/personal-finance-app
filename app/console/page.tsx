import { OverviewHealthView } from '@/components/console/overview-health-view';
import { ConsoleShell } from '@/components/layout/console-shell';

export default function Stage1ConsolePage() {
  return (
    <ConsoleShell sectionTitle="Overview & Health">
      <OverviewHealthView />
    </ConsoleShell>
  );
}
