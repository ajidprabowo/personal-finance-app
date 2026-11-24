import { BackupRestoreView } from '@/components/console/backup-restore-view';
import { ConsoleShell } from '@/components/layout/console-shell';

export default function BackupRestorePage() {
  return (
    <ConsoleShell sectionTitle="Backup & Restore">
      <BackupRestoreView />
    </ConsoleShell>
  );
}
