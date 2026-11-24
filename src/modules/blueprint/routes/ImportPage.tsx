import { PageHeader } from '@/components/ui';
import { requireMember } from '@/lib/auth/session';
import { applyBlueprintAction, previewBlueprintAction } from '../actions';
import { ImportBlueprint } from '../ImportBlueprint';

export default async function BlueprintImportPage() {
  await requireMember();
  return (
    <>
      <PageHeader title="Import the blueprint" subtitle="Ticks are matched by section and task text, so re-importing an edited file keeps them." />
      <ImportBlueprint preview={previewBlueprintAction} apply={applyBlueprintAction} />
    </>
  );
}
