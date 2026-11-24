import { SchemaMigrationsView } from '@/components/console/schema-migrations-view';
import { ConsoleShell } from '@/components/layout/console-shell';

export default function SchemaMigrationsPage() {
  return (
    <ConsoleShell sectionTitle="Schema & Migrations">
      <SchemaMigrationsView />
    </ConsoleShell>
  );
}
