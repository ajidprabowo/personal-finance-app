import { CrudWorkbenchView } from '@/components/console/crud-workbench-view';
import { ConsoleShell } from '@/components/layout/console-shell';

export default function CrudVerificationPage() {
  return (
    <ConsoleShell sectionTitle="CRUD Verification">
      <CrudWorkbenchView />
    </ConsoleShell>
  );
}
